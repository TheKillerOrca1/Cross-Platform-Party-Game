// ============================================================================
// GAME SERVER
// ----------------------------------------------------------------------------
// This is the ONE authority that every device (PC, phone, VR headset, console
// browser) connects to. It does two jobs:
//   1. Serves the client files (HTML/JS) via a plain web server (Express),
//      so any browser that visits http://<your-ip>:3000 gets the game page.
//   2. Keeps a live, real-time connection to every connected browser via
//      Socket.io, so when one player moves, everyone else finds out
//      almost instantly (this is what makes it "multiplayer").
//
// Nothing here is specific to any single player's device - the server just
// tracks where every player is and relays that info to everyone else.
// ============================================================================

const path = require('path');
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
// A plain Node http server is required because Socket.io needs to attach
// itself to the same server as Express (they share one network port).
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

// Serve everything in /public as static files (index.html, client.js, etc.)
// e.g. a request for "/client.js" is answered with "public/client.js".
app.use(express.static(path.join(__dirname, '..', 'public')));

// ----------------------------------------------------------------------------
// PLAYER STATE
// ----------------------------------------------------------------------------
// The server is the "source of truth" for where every player is, and now
// also for combat: health and alive/dead state. Each entry looks like:
//   { x, z, rotationY, color, health, alive }
const players = {};

const MAX_HEALTH = 100;

// Team-tinted palettes so allegiance is readable at a glance: red team
// players get warm colors, blue team players cool ones. Cycled per-team
// so two teammates still look distinct from each other.
const TEAM_COLORS = {
  red: ['#e74c3c', '#e67e22', '#f1c40f', '#ff69b4'],
  blue: ['#3498db', '#1abc9c', '#9b59b6', '#2ecc71'],
};
const nextColorIndexByTeam = { red: 0, blue: 0 };

function pickNextColor(team) {
  const palette = TEAM_COLORS[team];
  const color = palette[nextColorIndexByTeam[team] % palette.length];
  nextColorIndexByTeam[team] += 1;
  return color;
}

// Auto-balance: joiners who didn't pick a side go to the smaller team.
function pickAutoTeam() {
  let red = 0;
  let blue = 0;
  Object.values(players).forEach((p) => {
    if (p.team === 'red') red++;
    else blue++;
  });
  return red <= blue ? 'red' : 'blue';
}

// Teams spawn on opposite sides of the map (red west, blue east), with
// some jitter so simultaneous joiners don't stack. Shared by both the
// very first join AND every respawn - a respawn in this prototype is a
// full fresh connection (the client disconnects its old socket and opens
// a new one once the player picks a mode on the death screen - see
// client.js), so this one spawn path covers both cases.
const MAP_HALF = 35; // mirrors the client's 70x70 ground
function randomSpawnPosition(team) {
  const sideX = team === 'red' ? -(MAP_HALF - 8) : (MAP_HALF - 8);
  return {
    x: sideX + (Math.random() - 0.5) * 6,
    z: (Math.random() - 0.5) * 16,
  };
}

// Applies damage to a player, clamping at 0 and flipping them dead the
// moment they cross it. Returns the resulting health, or null if the
// target doesn't exist, is already dead, or has test mode on (the
// in-game menu's "can't die" toggle - enforced here so it actually
// works, since damage originates from OTHER clients' hit reports).
function applyDamage(targetId, amount) {
  const player = players[targetId];
  if (!player || !player.alive || player.testMode) return null;

  player.health = Math.max(0, player.health - amount);
  if (player.health <= 0) {
    player.alive = false;
    io.emit('playerDied', { id: targetId });
  }
  return player.health;
}

// ----------------------------------------------------------------------------
// SOCKET.IO CONNECTION HANDLING
// ----------------------------------------------------------------------------
// This callback fires once per browser tab / device that connects.
// "socket" is that one connection - we can send messages to just this
// client (socket.emit) or to everyone else (socket.broadcast.emit) or to
// literally everyone including this client (io.emit).
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // "Avatarless" players (the Swarm Command mode) have NO walking capsule -
  // they're represented entirely by their minions. Other clients need to
  // know this so they DON'T render a stationary ghost capsule for them, and
  // so projectiles don't try to "hit" an invisible body. The client tells
  // us at connect time via a handshake query param (race-free: it's known
  // before we emit the very first playerJoined). The server stays otherwise
  // mode-agnostic - this one boolean is all it needs.
  const avatarless = socket.handshake.query && socket.handshake.query.minionsOnly === '1';

  // Team comes from the join screen's picker; anything unrecognized
  // (including the default "auto") gets balanced onto the smaller team.
  const requestedTeam = socket.handshake.query && socket.handshake.query.team;
  const team = requestedTeam === 'red' || requestedTeam === 'blue' ? requestedTeam : pickAutoTeam();

  const spawn = randomSpawnPosition(team);

  players[socket.id] = {
    x: spawn.x,
    z: spawn.z,
    rotationY: 0,
    team,
    color: pickNextColor(team),
    health: MAX_HEALTH,
    alive: true,
    avatarless,
  };

  // Tell the NEW player who they are and who else is already in the game.
  // This is how a fresh browser tab catches up on the current game state.
  socket.emit('init', {
    id: socket.id,
    players,
  });

  // Tell everyone ELSE that a new player has joined, so they can create
  // a capsule for them.
  socket.broadcast.emit('playerJoined', {
    id: socket.id,
    player: players[socket.id],
  });

  // Fired whenever this client's WASD movement updates its position.
  // We trust the client's reported position for this prototype (no
  // server-side movement validation yet - fine for a local playtest).
  socket.on('move', (data) => {
    const player = players[socket.id];
    if (!player || !player.alive) return;

    player.x = data.x;
    player.z = data.z;
    player.rotationY = data.rotationY;

    // Relay the new position to every OTHER connected client.
    // socket.broadcast.emit sends to everyone except the sender, since
    // the sender already knows its own position.
    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      x: player.x,
      z: player.z,
      rotationY: player.rotationY,
    });
  });

  // Fired when this client fires a projectile. We relay it to everyone
  // ELSE so their browsers can render the shot flying through the air.
  // The shooter already rendered their own copy locally the instant they
  // clicked, for zero-latency feedback.
  //
  // Note: we pull the color from our own server-side record rather than
  // trusting whatever the client sends, since color is tied to player
  // identity and shouldn't be spoofable even in a friendly playtest.
  socket.on('fire', (data) => {
    const player = players[socket.id];
    if (!player || !player.alive) return;

    socket.broadcast.emit('projectileFired', {
      ownerId: socket.id,
      x: data.x,
      y: data.y,
      z: data.z,
      dirX: data.dirX,
      dirZ: data.dirZ,
      color: player.color,
    });
  });

  // Fired when this client's own projectile (or, later, a minion) touches
  // another player (the shooter's browser does that hit-detection - see
  // client.js). `damage` varies by source - a player's own shots hit
  // harder than other sources will (see PLAYER_PROJECTILE_DAMAGE in
  // client.js) - so we apply it here to keep health server-authoritative,
  // then relay the result to EVERYONE (io.emit, including the shooter) so
  // all connected browsers show the same health/hit reaction at once.
  socket.on('hit', (data) => {
    // No friendly fire: a hit reported against a teammate simply doesn't
    // count. Enforced here (not just client-side) so every damage path -
    // projectiles and minion zaps alike - respects it automatically.
    const shooter = players[socket.id];
    const target = players[data.targetId];
    if (shooter && target && shooter.team === target.team) return;

    const damage = typeof data.damage === 'number' ? data.damage : 10;
    const newHealth = applyDamage(data.targetId, damage);
    if (newHealth === null) return; // target missing or already dead - nothing to relay

    io.emit('playerHit', { id: data.targetId, health: newHealth });
  });

  // ----------------------------------------------------------------------
  // MINIONS (Squad / Solo FPS / Solo TPS / Swarm modes)
  // ----------------------------------------------------------------------
  // Minions are NOT tracked as server state the way players are - the
  // server just relays them, exactly like it relays player position. Each
  // owning client is the "source of truth" for its own minions' health and
  // alive/dead state (consistent with this prototype's existing
  // client-authoritative-hit-detection trust model).

  // Periodic broadcast of this player's minions (position + alive + health)
  // so other clients can render and shoot at them. Throttled client-side.
  // We inject the owner's color from our own record (same reason as 'fire'
  // above - color is identity, shouldn't be client-spoofable), which also
  // conveniently lets Swarm players - who have no avatar to read a color
  // from on other clients - still get correctly-tinted minions.
  socket.on('minionsUpdate', (data) => {
    const player = players[socket.id];
    if (!player) return;

    socket.broadcast.emit('minionsUpdate', {
      id: socket.id,
      color: player.color,
      team: player.team, // receivers use this to exempt teammates' minions from targeting
      minions: data.minions,
    });
  });

  // A minion got hit by someone's shot. Relayed to EVERYONE (io.emit,
  // including the shooter) so the OWNING client - authoritative for its
  // own minions' health - definitely receives it and can apply the
  // damage, while everyone else shows a cosmetic reaction. Test mode
  // shields a player's minions along with the player themself.
  socket.on('minionHit', (data) => {
    const owner = players[data.ownerId];
    if (owner && owner.testMode) return;

    // No friendly fire against teammates' minions either.
    const shooter = players[socket.id];
    if (shooter && owner && shooter.team === owner.team) return;

    io.emit('minionHit', {
      ownerId: data.ownerId,
      minionIndex: data.minionIndex,
      damage: data.damage,
    });
  });

  // The in-game testing menu's "can't die" toggle. Kept as plain server
  // state so damage from OTHER clients' hit reports can be skipped at the
  // one place health actually changes (applyDamage above).
  socket.on('setTestMode', (data) => {
    const player = players[socket.id];
    if (!player) return;
    player.testMode = !!data.enabled;
  });

  // Fired automatically when a tab is closed / loses connection.
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', { id: socket.id });
  });
});

// ----------------------------------------------------------------------------
// STARTUP ERROR HANDLING
// ----------------------------------------------------------------------------
// Without this, a failure to start (most commonly: something else is already
// using this port) crashes with a raw, scary-looking stack trace like
// "Error: listen EADDRINUSE: address already in use 0.0.0.0:3000". That's
// exactly what happens if you run "npm start" a second time while an earlier
// one is still running in another terminal window - the old one is still
// holding the port, so the new one has nowhere to listen and crashes instead
// of explaining what went wrong.
httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nCould not start: port ${PORT} is already in use.`);
    console.error(`This usually means the server is already running in another terminal`);
    console.error(`window (maybe from an earlier "npm start" you forgot to close), or`);
    console.error(`another program is using this port.`);
    console.error(`\nFix it by doing ONE of these:`);
    console.error(`  1. Find and close the other terminal window that's already running this server.`);
    console.error(`  2. Or start this one on a different port instead, e.g. in PowerShell:`);
    console.error(`       $env:PORT=3001; npm start`);
    console.error(`     then open http://localhost:3001\n`);
    process.exit(1);
  }

  console.error('\nServer failed to start:', err);
  process.exit(1);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Game server running!`);
  console.log(`  On this PC:      http://localhost:${PORT}`);
  console.log(`  On other devices on the same Wi-Fi: http://<this-PC's-LAN-IP>:${PORT}`);
});
