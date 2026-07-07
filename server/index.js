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
// The server is the "source of truth" for where every player is. Each entry
// looks like: { x, z, rotationY, color }
// We only track position on the flat ground (x, z) plus a facing rotation -
// no need for height (y) yet since everyone is walking on a flat plane.
const players = {};

// A small palette so each new player gets a distinct, readable color.
// We just cycle through this list as players join.
const PLAYER_COLORS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f1c40f', // yellow
  '#9b59b6', // purple
  '#e67e22', // orange
  '#1abc9c', // teal
  '#ff69b4', // pink
];
let nextColorIndex = 0;

function pickNextColor() {
  const color = PLAYER_COLORS[nextColorIndex % PLAYER_COLORS.length];
  nextColorIndex += 1;
  return color;
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

  // Spawn the new player at a random-ish position near the center so
  // multiple players joining at once don't all stack on top of each other.
  const spawnX = (Math.random() - 0.5) * 6;
  const spawnZ = (Math.random() - 0.5) * 6;

  players[socket.id] = {
    x: spawnX,
    z: spawnZ,
    rotationY: 0,
    color: pickNextColor(),
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
    if (!player) return;

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
    if (!player) return;

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

  // Fired when this client's own projectile touches another player (the
  // shooter's browser does that hit-detection - see client.js). We just
  // relay the result to EVERYONE (io.emit, including the shooter) so all
  // connected browsers show the same hit reaction at the same time.
  socket.on('hit', (data) => {
    if (!players[data.targetId]) return; // target may have already disconnected
    io.emit('playerHit', { id: data.targetId });
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
