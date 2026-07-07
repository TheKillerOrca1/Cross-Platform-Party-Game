// ============================================================================
// GAME CLIENT (runs in every player's browser)
// ----------------------------------------------------------------------------
// This file does three things:
//   1. Sets up a Babylon.js 3D scene: a ground plane, a light, a camera,
//      and a colored capsule mesh for every connected player.
//   2. Reads WASD keyboard input and moves YOUR capsule around.
//   3. Talks to the server over Socket.io so everyone sees everyone else
//      move in real time.
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

// ----------------------------------------------------------------------------
// SCENE SETUP
// ----------------------------------------------------------------------------
function createScene() {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color3(0.05, 0.05, 0.08);

  // Soft, all-around light so capsules are visible from every angle.
  const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  // A flat ground plane players walk around on.
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 50, height: 50 }, scene);
  const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.15);
  ground.material = groundMat;

  // A camera that orbits/follows behind the local player. ArcRotateCamera
  // is Babylon's "orbit around a target point" camera - here the target
  // is always the local player's capsule, updated every frame below.
  const camera = new BABYLON.ArcRotateCamera(
    'camera',
    -Math.PI / 2,   // alpha: horizontal angle
    Math.PI / 3,    // beta: vertical angle (tilt down toward the player)
    12,             // radius: distance from target
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
  camera.attachControl(canvas, true); // mouse/touch drag to look around
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 25;

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
    // Movement is in world space (W = north, D = east, etc.) which is the
    // simplest thing to reason about for a first prototype.
    let moveX = 0;
    let moveZ = 0;
    if (keysDown['w']) moveZ -= 1;
    if (keysDown['s']) moveZ += 1;
    if (keysDown['a']) moveX -= 1;
    if (keysDown['d']) moveX += 1;

    if (moveX !== 0 || moveZ !== 0) {
      // Normalize so diagonal movement isn't faster than straight movement.
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= length;
      moveZ /= length;

      local.mesh.position.x += moveX * MOVE_SPEED * deltaSeconds;
      local.mesh.position.z += moveZ * MOVE_SPEED * deltaSeconds;

      // Rotate the capsule to visually face the direction it's moving.
      local.mesh.rotation.y = Math.atan2(moveX, moveZ);
    }

    // --- Camera follows the local player ---
    camera.target.x = local.mesh.position.x;
    camera.target.z = local.mesh.position.z;

    maybeSendPositionToServer(deltaMs);
  }

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
