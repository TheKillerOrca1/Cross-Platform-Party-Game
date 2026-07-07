// ============================================================================
// GAME CLIENT (runs in every player's browser)
// ----------------------------------------------------------------------------
// This file does four things:
//   1. Sets up a Babylon.js 3D scene: a ground plane, a light, a camera,
//      and a colored capsule mesh (with a small "nose" showing which way
//      it's facing) for every connected player.
//   2. Reads WASD keyboard input and moves YOUR capsule around.
//   3. Aims YOUR capsule toward the mouse cursor, and fires a projectile
//      on left-click that flashes other players white if it hits them.
//   4. Talks to the server over Socket.io so everyone sees everyone else
//      move, shoot, and get hit in real time.
//
// Key idea for multiplayer sync: the server is the source of truth. We
// tell the server where we are, and the server tells every OTHER browser.
// We never trust another player's browser directly - it's always relayed
// through the server.
// ============================================================================

// ---- Babylon.js boilerplate: get the canvas and start the render engine ----
const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true);
const hud = document.getElementById('hud');

// Movement speed in world units per second (a "unit" is roughly a meter).
const MOVE_SPEED = 4;
// How often (ms) we send our position to the server. 20 times/sec is
// plenty smooth for a prototype without flooding the network.
const NETWORK_SEND_INTERVAL_MS = 50;
// How quickly remote players' capsules glide toward their latest known
// position. Higher = snappier but jerkier; lower = smoother but laggier.
const REMOTE_LERP_SPEED = 10;
// How quickly the camera glides to keep following the local player. This is
// deliberately NOT instant (see the camera-follow code in the render loop
// below for why): a small amount of lag means your own capsule visibly
// shifts within the frame as you move, instead of staying dead-center every
// single frame, which is what actually gives you the *feeling* of moving.
const CAMERA_LERP_SPEED = 6;

// --- Combat tuning ---
const PROJECTILE_SPEED = 15;        // world units per second
const PROJECTILE_MAX_DISTANCE = 30; // despawn after traveling this far
const HIT_RADIUS = 0.9;             // how close a projectile must get to count as a hit
const FIRE_COOLDOWN_MS = 250;       // minimum time between shots (prevents spamming the network)
const HIT_FLASH_DURATION_MS = 180;  // how long a player stays flashed white after being hit

// ----------------------------------------------------------------------------
// SCENE SETUP
// ----------------------------------------------------------------------------
// Draws a simple, high-contrast grid onto a square texture and tiles it
// across the ground. Without any visual markings, a flat single-color
// ground gives you ZERO visual feedback that you're moving at all (your
// own capsule stays centered on screen the whole time - see the camera
// comment below) - it just looks broken/frozen even though position
// updates are happening correctly under the hood. The grid lines are what
// actually let your eye register "I am moving" as they scroll past.
function createGroundGridTexture(scene) {
  // A checkerboard, not thin grid LINES. Thin lines tiled many times across
  // a surface get lost to texture minification (each repeat is only a
  // couple of pixels on screen once tiled 25x, so a 1-2px-wide line falls
  // between sampled texels and effectively disappears - this was tried
  // first and was invisible in testing). Solid alternating blocks survive
  // that downsampling reliably, so the grid stays visible at any distance.
  const size = 256;
  const half = size / 2;
  const texture = new BABYLON.DynamicTexture('groundGridTex', { width: size, height: size }, scene, true);
  // DynamicTexture defaults to CLAMP addressing, not WRAP - without this,
  // setting uScale/vScale below to tile the texture across the ground
  // does nothing visible: UV coordinates past 1 just clamp to a single
  // edge pixel instead of repeating, so the whole ground samples one
  // constant color instead of a repeating checker (this is exactly what
  // happened when first testing this - the ground rendered as a single
  // flat color even though the checker was correctly drawn into the
  // texture, because it was never actually tiling).
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  const ctx = texture.getContext();
  // Brighter and higher-contrast than the original flat ground color -
  // the first attempt at these colors was too close to the background
  // clear color and too close to each other, so the checker pattern was
  // essentially invisible even though it was drawing correctly.
  ctx.fillStyle = '#243024';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#3d4f3d';
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);
  texture.update();
  return texture;
}

function createScene() {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color3(0.05, 0.05, 0.08);

  // Soft, all-around light so capsules are visible from every angle.
  const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  // A flat ground plane players walk around on, tiled with a grid so
  // movement is visually readable (see createGroundGridTexture above).
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 50, height: 50 }, scene);
  const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
  const gridTexture = createGroundGridTexture(scene);
  // Each texture repeat contains a 2x2 checker, so uScale=13 gives ~26
  // checker cells across the 50-unit ground - roughly 1.9 world units per
  // cell, a readable scale next to a 0.4-radius capsule.
  gridTexture.uScale = 13;
  gridTexture.vScale = 13;
  groundMat.diffuseTexture = gridTexture;
  groundMat.specularColor = new BABYLON.Color3(0, 0, 0); // matte - no shiny highlight distracting from the grid
  ground.material = groundMat;

  // A camera that follows behind/above the local player. ArcRotateCamera is
  // Babylon's "orbit around a target point" camera - here the target
  // smoothly glides toward the local player's capsule every frame (see the
  // camera-follow code in the render loop below).
  //
  // Angle: a fairly steep, elevated "twin-stick shooter" angle (rather than
  // a flatter over-the-shoulder view) so you can clearly read your position
  // relative to other players and incoming shots - this matches the
  // "Brawl Stars meets Overwatch" reference look from the art direction doc,
  // which uses a similar semi-top-down camera for exactly this readability
  // reason. We deliberately do NOT tie the camera's rotation to the local
  // player's facing (see mouse-aim below) - a camera that spins every time
  // you turn to aim would be disorienting, and a fixed viewing direction is
  // the standard, comfortable convention for this control scheme.
  //
  // Note: unlike Step 1, we do NOT call camera.attachControl() here. Left
  // mouse button is now the fire button and mouse position controls your
  // aim, so we don't want mouse drags also spinning the camera around -
  // that would fight with aiming. The camera angle is fixed for now.
  const camera = new BABYLON.ArcRotateCamera(
    'camera',
    -Math.PI / 2,   // alpha: horizontal angle (camera sits on the -Z side, looking toward +Z)
    Math.PI / 4,    // beta: vertical angle - 45 degrees above the horizon, a clean top-down-leaning view
    10,             // radius: distance from target
    new BABYLON.Vector3(0, 1, 0),
    scene
  );

  return { scene, camera };
}

const { scene, camera } = createScene();

// ----------------------------------------------------------------------------
// PLAYER AVATARS (capsules)
// ----------------------------------------------------------------------------
// We keep a lookup of socket id -> { mesh, targetX, targetZ } so we can
// create/update/remove capsules as players join, move, and leave.
const playerAvatars = {};
let localPlayerId = null;

// Creates one capsule mesh with the given color and returns it.
//
// A plain capsule is a shape you can spin around its vertical axis and it
// looks exactly the same from every angle - so rotating it to "aim" would
// be invisible! To fix that, we stick a small cone ("nose") on the front
// of it, parented to the capsule so it automatically moves and rotates
// along with it. Whichever way the nose points is the way that player is
// aiming.
function createCapsuleMesh(id, colorHex) {
  const capsule = BABYLON.MeshBuilder.CreateCapsule(
    `player-${id}`,
    { height: 1.8, radius: 0.4 },
    scene
  );
  capsule.position.y = 0.9; // half the height, so it rests on the ground

  const material = new BABYLON.StandardMaterial(`mat-${id}`, scene);
  material.diffuseColor = BABYLON.Color3.FromHexString(colorHex);
  capsule.material = material;

  // CreateCylinder with diameterTop 0 makes a cone. It's built pointing
  // "up" (+Y) by default, so we rotate it 90 degrees around X to lay it
  // on its side, pointing along local +Z, which is our "forward" axis
  // (see the rotationY convention used throughout this file).
  const nose = BABYLON.MeshBuilder.CreateCylinder(
    `nose-${id}`,
    { diameterTop: 0, diameterBottom: 0.25, height: 0.5 },
    scene
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.55; // sticks out past the capsule's 0.4 radius
  nose.material = material; // same material, so it flashes along with the capsule
  nose.parent = capsule; // moves/rotates automatically with the capsule

  return capsule;
}

// Adds a new player's avatar to the scene (called for both the local
// player and every remote player).
function addPlayer(id, playerData) {
  const mesh = createCapsuleMesh(id, playerData.color);
  mesh.position.x = playerData.x;
  mesh.position.z = playerData.z;

  playerAvatars[id] = {
    mesh,
    colorHex: playerData.color, // remembered so we can revert after a hit-flash
    // "target" values are where remote players are glide-interpolating
    // toward. For the local player these aren't used for movement.
    targetX: playerData.x,
    targetZ: playerData.z,
  };
}

function removePlayer(id) {
  const avatar = playerAvatars[id];
  if (!avatar) return;
  avatar.mesh.dispose();
  delete playerAvatars[id];
}

// ----------------------------------------------------------------------------
// KEYBOARD INPUT (WASD)
// ----------------------------------------------------------------------------
// We just track which keys are currently held down in a plain object.
// The actual movement math happens once per frame in the render loop
// below, using how much time has passed (deltaTime) so movement speed
// doesn't depend on framerate.
const keysDown = {};
window.addEventListener('keydown', (e) => {
  keysDown[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
  keysDown[e.key.toLowerCase()] = false;
});

// ----------------------------------------------------------------------------
// NETWORKING (Socket.io)
// ----------------------------------------------------------------------------
const socket = io();

// The server sends this once, right after we connect: our own id plus
// the full list of players already in the game (so we can catch up).
socket.on('init', (data) => {
  localPlayerId = data.id;

  Object.entries(data.players).forEach(([id, playerData]) => {
    addPlayer(id, playerData);
  });

  hud.textContent = `Connected as ${localPlayerId.slice(0, 6)} | Players: ${Object.keys(playerAvatars).length}`;
});

// A new player joined after us.
socket.on('playerJoined', (data) => {
  addPlayer(data.id, data.player);
  hud.textContent = `Connected as ${localPlayerId.slice(0, 6)} | Players: ${Object.keys(playerAvatars).length}`;
});

// Someone else moved. We just update their "target" position - the
// render loop below smoothly glides their capsule toward it, instead of
// snapping instantly, so movement looks fluid even though updates only
// arrive ~20 times/sec.
socket.on('playerMoved', (data) => {
  const avatar = playerAvatars[data.id];
  if (!avatar) return;
  avatar.targetX = data.x;
  avatar.targetZ = data.z;
  avatar.mesh.rotation.y = data.rotationY;
});

socket.on('playerLeft', (data) => {
  removePlayer(data.id);
  hud.textContent = `Connected as ${localPlayerId ? localPlayerId.slice(0, 6) : '?'} | Players: ${Object.keys(playerAvatars).length}`;
});

// Someone (possibly us) fired a shot. We spawn our OWN projectile the
// instant we click, for zero-latency feedback, so we skip it here to
// avoid spawning a duplicate when the server's broadcast comes back.
socket.on('projectileFired', (data) => {
  if (data.ownerId === localPlayerId) return;
  spawnProjectile(data);
});

// The server confirmed a hit - flash that player, whether it's us,
// the shooter, or a bystander watching. Every browser runs this same
// reaction, so everyone sees hits consistently.
socket.on('playerHit', (data) => {
  triggerHitFlash(data.id);
});

// Only send an update to the server when our position actually changed,
// and no more often than NETWORK_SEND_INTERVAL_MS.
let lastSentX = null;
let lastSentZ = null;
let lastSentRotation = null;
let msSinceLastSend = 0;

function maybeSendPositionToServer(deltaMs) {
  msSinceLastSend += deltaMs;
  if (msSinceLastSend < NETWORK_SEND_INTERVAL_MS) return;
  msSinceLastSend = 0;

  const local = playerAvatars[localPlayerId];
  if (!local) return;

  const { x, z } = local.mesh.position;
  const rotationY = local.mesh.rotation.y;

  const moved = x !== lastSentX || z !== lastSentZ || rotationY !== lastSentRotation;
  if (!moved) return;

  lastSentX = x;
  lastSentZ = z;
  lastSentRotation = rotationY;
  socket.emit('move', { x, z, rotationY });
}

// ----------------------------------------------------------------------------
// COMBAT: MOUSE AIMING, SHOOTING, AND HIT REACTIONS
// ----------------------------------------------------------------------------

// Track raw mouse position on the canvas. Babylon can auto-track this via
// camera.attachControl(), but we deliberately didn't attach the camera to
// mouse input (see createScene above), so we track it ourselves.
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;
canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

// Left click fires. (button 0 = left, 1 = middle, 2 = right)
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) tryFireProjectile();
});

// Converts a screen position (like the mouse) into a point on the flat
// ground (y = 0), by casting a ray from the camera through that screen
// point and finding where it crosses the ground plane. This is the same
// "ray-plane intersection" trick used for mouse-aiming in most top-down
// or third-person shooters.
function screenPointToGroundPoint(screenX, screenY) {
  const ray = scene.createPickingRay(screenX, screenY, BABYLON.Matrix.Identity(), camera);

  // If the ray is (near) parallel to the ground, or pointing away from
  // it, there's no sensible intersection point to aim at.
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;

  return {
    x: ray.origin.x + ray.direction.x * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

// All projectiles currently in flight, from any player.
// Each entry: { mesh, ownerId, dirX, dirZ, distanceTraveled }
const activeProjectiles = [];

function spawnProjectile({ ownerId, x, y, z, dirX, dirZ, color }) {
  const mesh = BABYLON.MeshBuilder.CreateSphere(
    `projectile-${ownerId}-${Date.now()}-${Math.random()}`,
    { diameter: 0.3 },
    scene
  );
  mesh.position.set(x, y, z);

  const material = new BABYLON.StandardMaterial('projectileMat', scene);
  material.diffuseColor = BABYLON.Color3.FromHexString(color);
  material.emissiveColor = BABYLON.Color3.FromHexString(color); // glows, so it reads clearly in flight
  mesh.material = material;

  activeProjectiles.push({ mesh, ownerId, dirX, dirZ, distanceTraveled: 0 });
}

let lastFireTime = 0;

function tryFireProjectile() {
  const local = playerAvatars[localPlayerId];
  if (!local) return;

  const now = performance.now();
  if (now - lastFireTime < FIRE_COOLDOWN_MS) return; // still on cooldown
  lastFireTime = now;

  // Fire in the direction the capsule is currently facing (set every
  // frame by the mouse-aim code in the render loop below).
  const rotationY = local.mesh.rotation.y;
  const dirX = Math.sin(rotationY);
  const dirZ = Math.cos(rotationY);

  // Spawn slightly in front of the player (at the nose) so the
  // projectile doesn't visually start out inside their own capsule.
  const spawnOffset = 0.7;
  const shotData = {
    ownerId: localPlayerId,
    x: local.mesh.position.x + dirX * spawnOffset,
    y: 1.0,
    z: local.mesh.position.z + dirZ * spawnOffset,
    dirX,
    dirZ,
    color: local.colorHex,
  };

  // Spawn our own copy immediately (don't wait on a server round-trip -
  // this makes shooting feel instant), then tell the server so it can
  // relay the shot to everyone else.
  spawnProjectile(shotData);
  socket.emit('fire', { x: shotData.x, y: shotData.y, z: shotData.z, dirX, dirZ });
}

// Moves every active projectile forward, removes ones that traveled too
// far, and checks for hits.
//
// Only the client that OWNS a projectile checks whether it hit someone.
// That keeps the logic simple (one clear decision-maker per shot) at the
// cost of trusting the shooter's own view of where everyone is standing -
// fine for a local playtest with friends, but worth revisiting if this
// ever needs to be cheat-resistant.
function updateProjectiles(deltaSeconds) {
  const moveDistance = PROJECTILE_SPEED * deltaSeconds;

  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const proj = activeProjectiles[i];
    proj.mesh.position.x += proj.dirX * moveDistance;
    proj.mesh.position.z += proj.dirZ * moveDistance;
    proj.distanceTraveled += moveDistance;

    let shouldRemove = proj.distanceTraveled >= PROJECTILE_MAX_DISTANCE;

    if (!shouldRemove && proj.ownerId === localPlayerId) {
      for (const [id, avatar] of Object.entries(playerAvatars)) {
        if (id === localPlayerId) continue; // can't hit yourself

        const dx = avatar.mesh.position.x - proj.mesh.position.x;
        const dz = avatar.mesh.position.z - proj.mesh.position.z;
        if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) {
          socket.emit('hit', { targetId: id });
          shouldRemove = true;
          break;
        }
      }
    }

    if (shouldRemove) {
      proj.mesh.dispose();
      activeProjectiles.splice(i, 1);
    }
  }
}

// Briefly flashes a player's capsule white to show a hit landed. Guards
// against a second hit interrupting an in-progress flash by clearing any
// existing revert timer before starting a new one.
function triggerHitFlash(id) {
  const avatar = playerAvatars[id];
  if (!avatar) return;

  if (avatar.flashTimeoutId) clearTimeout(avatar.flashTimeoutId);

  avatar.mesh.material.diffuseColor = BABYLON.Color3.White();
  avatar.flashTimeoutId = setTimeout(() => {
    avatar.mesh.material.diffuseColor = BABYLON.Color3.FromHexString(avatar.colorHex);
    avatar.flashTimeoutId = null;
  }, HIT_FLASH_DURATION_MS);
}

// ----------------------------------------------------------------------------
// MAIN RENDER LOOP
// ----------------------------------------------------------------------------
// Babylon calls this once per frame (typically 60 times/sec). Everything
// that needs to happen continuously - reading input, moving the local
// player, gliding remote players, following with the camera - lives here.
scene.onBeforeRenderObservable.add(() => {
  const deltaMs = engine.getDeltaTime();
  const deltaSeconds = deltaMs / 1000;

  const local = playerAvatars[localPlayerId];
  if (local) {
    // --- Local movement from WASD ---
    // Movement is in world space (fixed compass directions - W always moves
    // +Z, D always moves +X, etc, regardless of which way your capsule is
    // facing/aiming) which is the simplest thing to reason about for a
    // first prototype.
    //
    // W/S are tied to +Z/-Z because the camera is fixed looking toward +Z
    // (see createScene above) - +Z is "deeper into the view", which is what
    // W (forward) should mean. Getting this backwards is a subtle bug: the
    // movement would still work, but pressing "forward" would walk you
    // toward the camera instead of away from it, which feels wrong/broken
    // even though nothing is throwing an error.
    let moveX = 0;
    let moveZ = 0;
    if (keysDown['w']) moveZ += 1;
    if (keysDown['s']) moveZ -= 1;
    if (keysDown['a']) moveX -= 1;
    if (keysDown['d']) moveX += 1;

    if (moveX !== 0 || moveZ !== 0) {
      // Normalize so diagonal movement isn't faster than straight movement.
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= length;
      moveZ /= length;

      local.mesh.position.x += moveX * MOVE_SPEED * deltaSeconds;
      local.mesh.position.z += moveZ * MOVE_SPEED * deltaSeconds;
    }

    // --- Mouse aiming ---
    // Facing is now driven by the mouse instead of movement direction, so
    // you can strafe or backpedal while keeping your aim locked on target
    // (the standard "twin-stick shooter" control scheme).
    const groundPoint = screenPointToGroundPoint(mouseX, mouseY);
    if (groundPoint) {
      const dx = groundPoint.x - local.mesh.position.x;
      const dz = groundPoint.z - local.mesh.position.z;
      if (dx * dx + dz * dz > 0.0001) {
        local.mesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    // --- Camera follows the local player ---
    // Glides toward the player instead of snapping instantly. Snapping
    // 1:1 every frame keeps your capsule PERFECTLY centered at all times,
    // which sounds nice but actually means your own character never
    // visibly moves on screen no matter which way you walk - only a
    // moving ground grid or nearby players give any sense of motion. A
    // little lag here means the camera briefly trails behind, so you
    // genuinely see yourself shift within the frame as you move.
    const camLerpFactor = Math.min(1, CAMERA_LERP_SPEED * deltaSeconds);
    camera.target.x += (local.mesh.position.x - camera.target.x) * camLerpFactor;
    camera.target.z += (local.mesh.position.z - camera.target.z) * camLerpFactor;

    maybeSendPositionToServer(deltaMs);
  }

  updateProjectiles(deltaSeconds);

  // --- Glide remote players toward their latest known position ---
  Object.entries(playerAvatars).forEach(([id, avatar]) => {
    if (id === localPlayerId) return;
    const lerpFactor = Math.min(1, REMOTE_LERP_SPEED * deltaSeconds);
    avatar.mesh.position.x += (avatar.targetX - avatar.mesh.position.x) * lerpFactor;
    avatar.mesh.position.z += (avatar.targetZ - avatar.mesh.position.z) * lerpFactor;
  });
});

// Start rendering, and keep the canvas sized to the window.
engine.runRenderLoop(() => {
  scene.render();
});
window.addEventListener('resize', () => {
  engine.resize();
});
