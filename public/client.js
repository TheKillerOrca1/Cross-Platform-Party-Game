// ============================================================================
// GAME CLIENT (runs in every player's browser)
// ----------------------------------------------------------------------------
// This file does five things:
//   1. Shows a join screen where the player picks a team and how they're
//      playing: PC, Console, Mobile (the current dual-stick + gesture-pad
//      design), or one of four older Mobile experiments kept for
//      comparison - purely for playtesting control schemes on any device.
//   2. Sets up a Babylon.js 3D scene: a ground plane, a light, a camera
//      (whose type depends on the chosen mode), and a colored capsule mesh
//      for every connected player.
//   3. Reads movement/aim/fire input from whichever source the chosen mode
//      uses - keyboard+mouse, a gamepad, or on-screen touch controls.
//   4. Fires projectiles and shows a hit-flash reaction, same as before.
//   5. Talks to the server over Socket.io so everyone sees everyone else
//      move, shoot, and get hit in real time.
//
// Key idea for multiplayer sync: the server is the source of truth. We
// tell the server where we are, and the server tells every OTHER browser.
// We never trust another player's browser directly - it's always relayed
// through the server.
//
// Key idea for the mode system: picking a mode only changes what's LOCAL to
// your own screen - which camera you see through and how you feed in input.
// The server doesn't know or care which mode you picked; it just relays the
// same position/rotation/fire/hit messages regardless.
// ============================================================================

// ---- Babylon.js boilerplate: get the canvas and start the render engine ----
const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true);
const hud = document.getElementById('hud');

// All permanent HUD text goes through this so transient warnings (like
// Console mode's "no controller" notice) can temporarily override it and
// then restore whatever was there before.
let hudBaseText = 'Connecting...';
function setHud(text) {
  hudBaseText = text;
  hud.textContent = text;
}
function setHudWarning(warning) {
  hud.textContent = warning ? `${hudBaseText} | ${warning}` : hudBaseText;
}

// Movement speed in world units per second (a "unit" is roughly a meter).
const MOVE_SPEED = 4;
// The playable ground is MAP_SIZE x MAP_SIZE, ringed by border walls so
// nobody can wander off into the void.
const MAP_SIZE = 70;
const MAP_HALF = MAP_SIZE / 2;
// How often (ms) we send our position to the server. 20 times/sec is
// plenty smooth for a prototype without flooding the network.
const NETWORK_SEND_INTERVAL_MS = 50;
// How quickly remote players' capsules glide toward their latest known
// position. Higher = snappier but jerkier; lower = smoother but laggier.
const REMOTE_LERP_SPEED = 10;
// How quickly a third-person camera's TARGET glides to keep following the
// local player. Deliberately not instant - see the camera-follow code in
// the render loop for why (a small lag is what gives you the *feeling* of
// moving, since a perfectly-centered capsule never visibly shifts on screen).
const CAMERA_LERP_SPEED = 6;
// How quickly a chase camera's rotation catches up to the player's facing
// (used by Mobile TPS - see MODE_CONFIG below).
const CAMERA_ROTATE_LERP_SPEED = 8;

// --- Combat tuning ---
const PROJECTILE_SPEED = 25;        // world units per second (raised from 15 - snappier shots)
const PROJECTILE_MAX_DISTANCE = 30; // despawn after traveling this far
const HIT_RADIUS = 0.9;             // how close a projectile must get to count as a hit
const FIRE_COOLDOWN_MS = 250;       // minimum time between shots (prevents spamming the network)
const HIT_FLASH_DURATION_MS = 180;  // how long a player stays flashed white after being hit
const HIT_MARKER_DURATION_MS = 180; // how long the shooter's own screen-edge hit flash lasts

// --- Health / death / respawn ---
// PLAYER_MAX_HEALTH mirrors the server's own MAX_HEALTH constant (the
// server is the real authority - this copy is just so the client can
// sensibly default a player's health before the first server update
// arrives). PLAYER_PROJECTILE_DAMAGE is how much a player's own shot
// deals - sent along with every 'hit' the client reports, since the
// server no longer assumes a flat amount (other sources, like minions
// later, will deal less).
const PLAYER_MAX_HEALTH = 100;
const PLAYER_PROJECTILE_DAMAGE = 10;
// Purely a client-side UX pace-setter for the "respawn available in..."
// countdown shown on the death screen - NOT a security boundary. A
// respawn is a full fresh connection (see leaveCurrentMode/startGame
// below), so the server always hands out full health regardless of
// timing; this just stops someone from instantly mashing a mode button
// the moment they die.
const RESPAWN_COOLDOWN_MS = 3000;

// --- First-person camera ---
const EYE_HEIGHT = 1.6; // world units above the player's feet
const MOUSE_LOOK_SENSITIVITY = 0.0025; // radians of turn per pixel of mouse movement
const TOUCH_LOOK_SENSITIVITY = 0.006;  // radians of turn per pixel of touch drag (touch screens are smaller, so a bit more sensitive per pixel)

// --- Gamepad (Console) ---
const GAMEPAD_DEADZONE = 0.2; // ignore stick input this close to center (avoids drift from imprecise sticks)
const GAMEPAD_FIRE_BUTTON_INDEX = 7; // right trigger on the "standard" gamepad mapping (Xbox/PlayStation/etc)
const GAMEPAD_ALT_FIRE_BUTTON_INDEX = 0; // A/Cross too - some Bluetooth pads map triggers unusually
const GAMEPAD_AIM_LERP_SPEED = 12; // how fast aim glides to the stick's angle (scaled by the sensitivity slider)
const GAMEPAD_GRACE_PERIOD_MS = 2000; // how long to wait in Console mode before showing "no controller"

// --- In-game testing menu state ---
// Multiplies every look/turn speed (mouse, touch drag, turn stick, gamepad
// aim) - driven by the menu's sensitivity slider.
let sensitivityMultiplier = 1.0;
// "Can't die" toggle for solo control-feel testing. Enforced server-side
// (the server skips damage against players who have this on).
let testModeInvincible = false;

// --- Teams ---
// Picked on the join screen ('auto' lets the server balance you onto the
// smaller side). Teammates can't damage each other (server-enforced) and
// minions never target them. localTeam is whatever the server actually
// assigned us, learned from the init payload.
let selectedTeam = 'auto';
let localTeam = null;

// --- Mobile touch joystick ---
const JOYSTICK_MAX_RADIUS = 55; // pixels the knob can stray from center before movement maxes out
const TOUCH_TAP_MAX_MOVEMENT_PX = 12; // a touch that moves less than this counts as a "tap" (fire), not a "look drag"
const TOUCH_TAP_MAX_DURATION_MS = 300; // and must also be this quick to count as a tap

// --- EXPERIMENTAL: Solo FPS/TPS right-side control scheme ---
// 'turn-joystick': the right side shows a stick; pushing it left/right
//                  turns you at a speed proportional to the push, and
//                  RELEASING it fires one shot in your current facing.
// 'drag-look':     the original scheme - drag to turn 1:1, tap to fire.
// Flip this one line to revert if the experiment feels worse.
const MOBILE_TURN_SCHEME = 'turn-joystick';
const TURN_JOYSTICK_MAX_RATE = 3.0; // radians/sec of turning at full stick deflection
// Squad Mode's aim stick: deflections smaller than this are ignored when
// updating facing (a nearly-centered stick gives a meaninglessly noisy
// angle), but releasing still fires in the current facing.
const AIM_STICK_MIN_DEFLECTION_PX = 10;

// --- Minions (shared by all mobile modes: Squad, Solo FPS, Solo TPS, Swarm) ---
// The three "solo" mobile modes get a small support squad trailing the
// player; Swarm mode has no player at all and is JUST a larger swarm.
const MINION_COUNT = 2;        // support squad size (Squad / FPS / TPS)
const SWARM_MINION_COUNT = 6;  // Swarm mode has no avatar - the minions ARE the player
const MINION_SCALE = 0.7;      // support minions, visibly smaller than a player
const SWARM_MINION_SCALE = 0.85; // swarm minions are the player's whole presence, so a bit bigger
const REMOTE_MINION_SCALE = 0.75; // how we render OTHER players' minions

const MINION_HEALTH = 20;      // dies in 2 player shots (10 dmg each); tanks many minion zaps (2 dmg)
const MINION_DAMAGE = 2;       // a single minion's zap - deliberately far weaker than a player's 10
const MINION_FOLLOW_LERP_SPEED = 4;  // loose idle-follow catch-up speed
const MINION_CHASE_LERP_SPEED = 5;   // slightly snappier when actively closing on a target

// Targeting: minions lock onto the nearest enemy the player is roughly
// facing (Squad/FPS/TPS) or nearest to the swarm's center (Swarm). All
// tunable - these are first-pass "feel" values.
const MINION_TARGET_CONE_DEGREES = 40;   // half-angle off the leader's facing (Squad/FPS/TPS only)
const MINION_TARGET_MAX_DISTANCE = 18;   // won't chase enemies further than this
const MINION_TARGET_SCAN_INTERVAL_MS = 150; // re-scan for a target this often (not every frame)
const MINION_ATTACK_RANGE = 6;           // ~"4-5 tiles" - can zap from this far, no need to touch
const MINION_ATTACK_COOLDOWN_MS = 1000;  // one zap per second per minion
const MINION_ZAP_DURATION_MS = 100;      // how long the attack tracer-line stays visible
const MINION_RESPAWN_COOLDOWN_MS = 6000; // dead minion reappears near its owner after this

// How often each client broadcasts its own minions' state to everyone
// else. Looser than the 50ms player-position rate since minions are
// secondary, lower-priority visual info.
const MINION_NETWORK_SEND_INTERVAL_MS = 100;

// --- Swarm Mode free-pan camera ---
const SWARM_CAM_MIN_RADIUS = 10; // closest pinch-zoom
const SWARM_CAM_MAX_RADIUS = 35; // furthest pinch-zoom
const SWARM_COMMAND_SCATTER = 2.5; // random spread so tapped minions don't perfectly stack

// ----------------------------------------------------------------------------
// MOBILE MODE (dual-stick + gesture pad) - tuning constants
// ----------------------------------------------------------------------------
// This is the CURRENT mobile design direction (see 01_Platform_Playstyles.md,
// July 9 2026 session): fully manual dual-stick control plus a see-through
// "dash pad" above the sticks where the player DRAWS their movement. The
// four older mobile modes are kept around as superseded experiments.
//
// ⚠ None of these numbers have been felt on a real phone yet - this build
// exists precisely to make that playtest possible. Tune freely.

// The bottom strip of the screen belongs to the two sticks (left half =
// move, right half = aim). Touches above the strip hit the gesture pad
// (its own element) or nothing.
const DUAL_STICK_STRIP_FRACTION = 0.35;
// Right stick: full deflection turns you this fast (radians/second),
// scaled by the sensitivity slider - same feel family as the legacy
// turn-stick experiment, but here it's a pure camera/aim stick: releasing
// it does NOT fire (firing has its own placeholder button).
const DUAL_TURN_MAX_RATE = 3.0;

// --- Gesture pad: recognizing the drawn stroke ---
const GESTURE_MIN_STROKE_PX = 30;    // shorter marks are ignored (accidental taps)
const GESTURE_SMOOTH_WINDOW = 5;     // moving-average window over raw finger points
const GESTURE_RESAMPLE_POINTS = 28;  // the cleaned-up path is reduced to this many evenly spaced points
// A stroke whose straight-line displacement is at least this fraction of
// its total drawn length counts as "straight" (the simple/safe inputs);
// anything below it is a curve (the expressive free-form inputs).
const GESTURE_STRAIGHTNESS_MIN = 0.78;
// How far off screen-vertical a straight stroke may lean and still count
// as "up" (jump-dash) or "down" (slide-dash). Generous on purpose - this
// is part of the "tolerance for imprecise starts" the design calls for.
const GESTURE_VERTICAL_TOLERANCE_DEG = 40;

// --- Turning the drawn shape into a world-space dash path ---
// Screen-up in the pad = "the way the camera faced when the gesture
// STARTED" (locked at gesture start, per the design - moving the camera
// mid-draw does not re-aim the dash). Screen-x = sideways.
const DASH_WORLD_SCALE = 8;      // world units a full-pad-height stroke maps to
const DASH_MIN_WORLD_LEN = 3;    // clamp: even a tiny valid stroke dashes a useful distance
const DASH_MAX_WORLD_LEN = 13;   // clamp: no cross-map teleports
const DASH_SPEED = 14;           // world units/second along the traced path
// Hard ceiling on how fast the capsule may chase its path. Normal playback
// peaks around 1.5x DASH_SPEED (smoothstep easing), safely under this; it
// only bites when a wall pinned the capsule mid-dash while the path moved
// on - without the cap, clearing the wall snapped the capsule several
// units in a single frame (found in testing).
const DASH_CATCHUP_SPEED = 24;
const DASH_MIN_DURATION_S = 0.3;
const DASH_MAX_DURATION_S = 1.0;
const JUMP_DASH_HEIGHT = 2.2;    // arc peak of the jump-dash
const FREEFORM_HOP_HEIGHT = 1.0; // curved dashes get a low "carried by wind" hop
const DASH_COOLDOWN_MS = 250;    // small gap after a dash before the next gesture lands
const DASH_PATH_LINGER_MS = 600; // how long the glowing world-path line outlives the dash

// --- Wall-swoop (first pass - "detect wall + swipe + impulse", per plan) ---
// The gesture is a sharp out-and-back "V": swipe toward a nearby wall,
// then away. The return leg's direction is the direction you swoop.
const WALL_SWOOP_RANGE = 3.5;        // how close a wall must be (world units)
const WALL_SWOOP_DISTANCE = 4.5;     // how far the push-off carries you
const WALL_SWOOP_HEIGHT = 1.4;       // its little hop arc
const WALL_SWOOP_DURATION_S = 0.42;
const WALL_SWOOP_MAX_CHAIN = 3;      // design says "chainable 2-3 times pending balance" - 3 for now
const WALL_SWOOP_FOLD_MIN_DEG = 110; // how sharply the stroke must reverse to read as out-and-back
// A "V" retraces itself and encloses almost no area; a swooping curve
// encloses a lot. Comparing enclosed area to stroke length separates the
// wall-swoop gesture from free-form curves far more reliably than angles
// alone. (Dimensionless: area / length². A tight V is ~0, a semicircle ~0.16.)
const WALL_SWOOP_AREA_RATIO_MAX = 0.045;
const WALL_SWOOP_GROUND_RESET_MS = 400; // grounded this long = chain counter resets

// ----------------------------------------------------------------------------
// MODE CONFIGURATION
// ----------------------------------------------------------------------------
// Everything that varies between the 5 join options boils down to two
// independent choices: which kind of camera you see through, and which kind
// of device is feeding in your movement/aim/fire input. Keeping this as one
// small lookup table (rather than scattering "if mode === 'pc'" checks
// throughout the file) means adding a 6th mode later is a one-line change
// here, not a hunt through every function.
//
// cameraType is one of:
//   'first-person'        - camera at eye height, 1:1 with your facing, no lag
//   'third-person-fixed'  - elevated camera that follows your POSITION but
//                            keeps a fixed viewing angle regardless of which
//                            way you're facing (a "twin-stick shooter" cam)
//   'third-person-chase'  - elevated camera that follows both your position
//                            AND rotates to stay behind your back as you turn
//                            (a traditional "over-the-shoulder" cam)
//   'top-down'            - steep overhead angle, follows the player (Squad)
//   'top-down-free'       - overhead angle NOT locked to any player; the
//                            player pans/zooms it freely (Swarm Command)
//
// inputType is one of:
//   'keyboard-mouse' | 'gamepad' | 'touch' | 'touch-swarm' | 'touch-dual'
//
// Flags:
//   hasMinions  - this mode spawns a squad of networked minions
//   minionsOnly - no player avatar at all; the minions ARE the player (Swarm)
const MODE_CONFIG = {
  pc: {
    label: 'PC',
    cameraType: 'first-person',
    inputType: 'keyboard-mouse',
  },
  console: {
    label: 'Console',
    // Was 'third-person-fixed' (camera never rotated). Now the camera
    // follows your aim direction Fortnite-style, per playtest feedback -
    // "xbox needs to move its camera with its aiming".
    cameraType: 'third-person-chase',
    inputType: 'gamepad',
  },
  mobile: {
    label: 'Mobile',
    // The CURRENT mobile design (dual-stick + gesture pad). Third-person
    // chase deliberately: the whole point of this build is judging whether
    // the dash follows your drawn shape, and you can only SEE that arc
    // from behind your character, not through its eyes. (Camera choice
    // wasn't specified in the design session - judgment call, revisit
    // once it's been felt on a device.)
    cameraType: 'third-person-chase',
    inputType: 'touch-dual',
    // No minions: the design session replaced the commander-minion concept
    // with direct character control (see 01_Platform_Playstyles.md).
  },
  'mobile-squad': {
    label: 'Mobile: Squad Mode',
    cameraType: 'top-down',
    inputType: 'touch',
    hasMinions: true,
  },
  'mobile-fps': {
    label: 'Mobile: Solo FPS Mode',
    cameraType: 'first-person',
    inputType: 'touch',
    hasMinions: true,
  },
  'mobile-tps': {
    label: 'Mobile: Solo TPS Mode',
    cameraType: 'third-person-chase',
    inputType: 'touch',
    hasMinions: true,
  },
  'mobile-swarm': {
    label: 'Mobile: Swarm Command',
    cameraType: 'top-down-free',
    inputType: 'touch-swarm',
    hasMinions: true,
    minionsOnly: true,
  },
};

let currentMode = null; // set once the player picks a join button

// ----------------------------------------------------------------------------
// SCENE SETUP (created once at load - camera/players/input are added later,
// once a mode is picked, by startGame() near the bottom of this file)
// ----------------------------------------------------------------------------
// Draws a simple, high-contrast grid onto a square texture and tiles it
// across the ground. Without any visual markings, a flat single-color
// ground gives you ZERO visual feedback that you're moving at all (your
// own capsule stays centered on screen the whole time) - it just looks
// broken/frozen even though position updates are happening correctly under
// the hood. The grid lines are what actually let your eye register "I am
// moving" as they scroll past.
function createGroundGridTexture(scene) {
  // A checkerboard, not thin grid LINES. Thin lines tiled many times across
  // a surface get lost to texture minification (each repeat is only a
  // couple of pixels on screen once tiled 25x, so a 1-2px-wide line falls
  // between sampled texels and effectively disappears). Solid alternating
  // blocks survive that downsampling reliably, so the grid stays visible at
  // any distance.
  const size = 256;
  const half = size / 2;
  const texture = new BABYLON.DynamicTexture('groundGridTex', { width: size, height: size }, scene, true);
  // DynamicTexture defaults to CLAMP addressing, not WRAP - without this,
  // tiling the texture across the ground does nothing visible: UV
  // coordinates past 1 just clamp to a single edge pixel instead of
  // repeating.
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  const ctx = texture.getContext();
  ctx.fillStyle = '#243024';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#3d4f3d';
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);
  texture.update();
  return texture;
}

const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color3(0.05, 0.05, 0.08);

const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
light.intensity = 0.9;

const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: MAP_SIZE, height: MAP_SIZE }, scene);
const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
const gridTexture = createGroundGridTexture(scene);
// Each texture repeat contains a 2x2 checker, so uScale=18 gives ~36
// checker cells across the 70-unit ground - roughly 1.9 world units per
// cell, a readable scale next to a 0.4-radius capsule.
gridTexture.uScale = 18;
gridTexture.vScale = 18;
groundMat.diffuseTexture = gridTexture;
groundMat.specularColor = new BABYLON.Color3(0, 0, 0); // matte - no shiny highlight distracting from the grid
ground.material = groundMat;

// ----------------------------------------------------------------------------
// OBSTACLES + MAP BORDER
// ----------------------------------------------------------------------------
// A handful of static cover boxes to duck behind, plus four walls ringing
// the map edge. Both block player movement (Babylon's collision system)
// and stop projectiles (a simple bounds check in updateProjectiles).
//
// Layout rules (deliberate): pieces are isolated with generous gaps - no
// interlocking walls, no enclosed pockets you could get trapped in - and
// the ~8-unit circle around the center is kept clear because that's where
// everyone spawns.
scene.collisionsEnabled = true;

const obstacles = []; // meshes (for rendering/collision flags)
// Precomputed XZ bounds for fast projectile checks, expanded by the
// projectile's own radius so shots visually clip the surface instead of
// sinking halfway in before stopping.
const obstacleBounds = [];

function addObstacleBox(name, x, z, width, height, depth) {
  const box = BABYLON.MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  box.position.set(x, height / 2, z);
  box.checkCollisions = true;

  const mat = new BABYLON.StandardMaterial(`${name}-mat`, scene);
  mat.diffuseColor = new BABYLON.Color3(0.42, 0.42, 0.48); // neutral stone gray
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  box.material = mat;

  obstacles.push(box);
  const projectileRadius = 0.15;
  obstacleBounds.push({
    minX: x - width / 2 - projectileRadius,
    maxX: x + width / 2 + projectileRadius,
    minZ: z - depth / 2 - projectileRadius,
    maxZ: z + depth / 2 + projectileRadius,
  });
  return box;
}

// Scattered cover pieces (positions/sizes are first-pass, easy to retune).
addObstacleBox('obstacle-0', -15, 15, 4, 2.2, 2);
addObstacleBox('obstacle-1', 15, 15, 2.5, 1.8, 2.5);
addObstacleBox('obstacle-2', -15, -15, 3, 2, 3);
addObstacleBox('obstacle-3', 15, -15, 4, 1.6, 2);
addObstacleBox('obstacle-4', -12, 8, 2, 2.4, 4);
addObstacleBox('obstacle-5', 12, -8, 2, 2.4, 4);
addObstacleBox('obstacle-6', 0, 22, 5, 1.8, 2);
addObstacleBox('obstacle-7', 0, -22, 5, 1.8, 2);
addObstacleBox('obstacle-8', 24, 2, 2, 2.6, 5);
addObstacleBox('obstacle-9', -24, -2, 2, 2.6, 5);

// Border walls: thin, moderately tall boxes just inside the ground's
// edge. Visible (not invisible planes) so the map clearly reads as
// having an edge instead of players face-planting into nothing.
const WALL_THICKNESS = 1;
const WALL_HEIGHT = 3;
addObstacleBox('wall-north', 0, MAP_HALF, MAP_SIZE + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
addObstacleBox('wall-south', 0, -MAP_HALF, MAP_SIZE + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
addObstacleBox('wall-east', MAP_HALF, 0, WALL_THICKNESS, WALL_HEIGHT, MAP_SIZE + WALL_THICKNESS);
addObstacleBox('wall-west', -MAP_HALF, 0, WALL_THICKNESS, WALL_HEIGHT, MAP_SIZE + WALL_THICKNESS);

let camera = null; // created by createCameraForMode() once a mode is picked

// Builds the right camera for the chosen mode. See the cameraType docs in
// MODE_CONFIG above for what each type means.
function createCameraForMode(mode) {
  const cameraType = MODE_CONFIG[mode].cameraType;

  if (cameraType === 'first-person') {
    // UniversalCamera is Babylon's free-look camera - we position and
    // rotate it ourselves every frame (see the render loop) rather than
    // letting Babylon's own input handling drive it, since our own
    // mouse/touch-look code already computes the rotation we want.
    const cam = new BABYLON.UniversalCamera('camera', new BABYLON.Vector3(0, EYE_HEIGHT, 0), scene);
    cam.minZ = 0.05; // avoid near-plane clipping when close to other capsules
    return cam;
  }

  if (cameraType === 'top-down') {
    // Steep overhead angle for Squad Mode - beta close to 0 looks almost
    // straight down; a small tilt (rather than perfectly vertical) keeps a
    // bit of depth/perspective so the scene doesn't look completely flat.
    // Pulled back from the original 0.35/16 - the old view was too tight
    // to see incoming threats. (First-pass values, expect retuning.)
    return new BABYLON.ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      0.45,
      20,
      new BABYLON.Vector3(0, 1, 0),
      scene
    );
  }

  if (cameraType === 'top-down-free') {
    // Swarm Command's camera. Same overhead character as top-down, but it
    // is NOT locked to following any player (there is no player) - the
    // render loop never moves its target automatically. Instead the swarm
    // touch input pans camera.target and pinch-zooms camera.radius directly
    // (see the touch-swarm handlers below), so the player can survey the
    // whole map and issue commands. Starts a bit further back for a wider
    // strategic view; the initial target gets recentered on the swarm's
    // spawn once we connect.
    const cam = new BABYLON.ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      0.5,
      22,
      new BABYLON.Vector3(0, 0, 0),
      scene
    );
    cam.lowerRadiusLimit = SWARM_CAM_MIN_RADIUS;
    cam.upperRadiusLimit = SWARM_CAM_MAX_RADIUS;
    return cam;
  }

  if (cameraType === 'third-person-fixed') {
    // The original elevated "twin-stick shooter" angle: follows position
    // but never rotates with facing. No mode uses this right now (Console
    // moved to chase), but it's kept as a ready-made option in case a
    // future mode wants decoupled-aim feel back.
    return new BABYLON.ArcRotateCamera(
      'camera',
      -Math.PI / 2,
      Math.PI / 4,
      10,
      new BABYLON.Vector3(0, 1, 0),
      scene
    );
  }

  // third-person-chase (Console + Mobile TPS): a Fortnite-style
  // over-the-shoulder camera - much more horizontal than the old 45°
  // angle so you can actually see ahead of you, and closer in. The render
  // loop rotates it to stay behind your facing. Console and TPS share
  // these numbers today but are deliberately separate from the fixed
  // branch above so they can diverge during feel-tuning.
  return new BABYLON.ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    Math.PI / 2.4, // ~75° from vertical - near eye level, looking slightly down
    7,
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
}

// ----------------------------------------------------------------------------
// PLAYER AVATARS (capsules)
// ----------------------------------------------------------------------------
// We keep a lookup of socket id -> { mesh, nose, targetX, targetZ } so we
// can create/update/remove capsules as players join, move, and leave.
const playerAvatars = {};
let localPlayerId = null;

// Creates one capsule mesh (plus a small "gun" showing which way it's
// facing) with the given color, and returns both. (The gun is still called
// `nose` throughout this file - it plays the exact same role the original
// nose cone did: a facing indicator parented to the capsule.)
//
// A plain capsule is a shape you can spin around its vertical axis and it
// looks exactly the same from every angle - so rotating it to "aim" would
// be invisible! The gun fixes that: whichever way it points is the way
// that player is aiming.
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

  // A little procedural "gun" held out front - a chunky receiver box with
  // a thin barrel poking forward along local +Z (our "forward" axis; see
  // the rotationY convention used throughout this file). Replaces the old
  // plain cone: reads as a weapon and makes facing unmistakable. Both
  // pieces share the capsule's material so hit-flashes tint everything.
  const nose = BABYLON.MeshBuilder.CreateBox(
    `gun-${id}`,
    { width: 0.14, height: 0.16, depth: 0.4 },
    scene
  );
  nose.position.set(0.22, 0.15, 0.45); // held slightly to the right and up, like a carried weapon
  nose.material = material;
  nose.parent = capsule; // moves/rotates automatically with the capsule

  const barrel = BABYLON.MeshBuilder.CreateCylinder(
    `gun-barrel-${id}`,
    { diameter: 0.07, height: 0.35 },
    scene
  );
  barrel.rotation.x = Math.PI / 2; // cylinders are built upright - lay it forward
  barrel.position.set(0, 0.02, 0.35); // extends out the front of the receiver
  barrel.material = material;
  barrel.parent = nose; // one setEnabled/dispose on the gun handles both pieces

  return { capsule, nose };
}

// Attaches a small flat ring hovering on the ground in front of a capsule -
// a Brawl-Stars-style aim reticle that shows which way it's facing/aiming
// from a top-down view (where the little nose cone is hard to read).
// Parented to the capsule, so it swings around automatically as the
// capsule rotates; no per-frame work needed.
function attachAimReticle(capsule, colorHex, distance, ringDiameter) {
  const ring = BABYLON.MeshBuilder.CreateTorus(
    `reticle-${capsule.name}`,
    { diameter: ringDiameter, thickness: 0.06, tessellation: 24 },
    scene
  );
  const mat = new BABYLON.StandardMaterial(`reticle-mat-${capsule.name}`, scene);
  mat.emissiveColor = BABYLON.Color3.FromHexString(colorHex); // glows - readable on the dark ground
  mat.diffuseColor = BABYLON.Color3.Black();
  ring.material = mat;
  ring.isPickable = false;
  ring.parent = capsule;
  ring.position.set(0, -0.7, distance); // just above the ground, out in front
  return ring;
}

// --- Health bars ---
// Your OWN health lives in the corner HUD (DOM, see updateHudHealth).
// OTHER players get a small billboard bar floating over their capsule -
// a mesh (not a DOM overlay) because Babylon's billboard mode gives us
// camera-facing, depth-testing, and off-screen culling for free in every
// camera mode, where a DOM approach would need manual 3D->2D projection
// math every frame.
function attachHealthBar(capsule) {
  const bg = BABYLON.MeshBuilder.CreatePlane(
    `healthbar-bg-${capsule.name}`,
    { width: 1.2, height: 0.16, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    scene
  );
  const bgMat = new BABYLON.StandardMaterial(`healthbar-bg-mat-${capsule.name}`, scene);
  bgMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  bgMat.diffuseColor = BABYLON.Color3.Black();
  bgMat.disableLighting = true;
  bg.material = bgMat;
  bg.parent = capsule;
  bg.position.set(0, 1.35, 0); // capsule center is at y=0.9, so this floats just over its head
  bg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  bg.isPickable = false;

  const fill = BABYLON.MeshBuilder.CreatePlane(
    `healthbar-fill-${capsule.name}`,
    { width: 1.16, height: 0.12, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
    scene
  );
  const fillMat = new BABYLON.StandardMaterial(`healthbar-fill-mat-${capsule.name}`, scene);
  fillMat.emissiveColor = BABYLON.Color3.FromHexString('#2ecc71'); // green while healthy
  fillMat.diffuseColor = BABYLON.Color3.Black();
  fillMat.disableLighting = true;
  fill.material = fillMat;
  fill.parent = bg; // inherits the billboard facing
  fill.position.set(0, 0, -0.01); // a hair in front of the background
  fill.isPickable = false;

  return { fill, fillMat };
}

// Scales a bar's fill to the health fraction, anchored to the LEFT edge
// (the standard health-bar trick: scaling alone would shrink from both
// ends, so we also slide the fill over by half the lost width).
function updateHealthBarVisual(avatar) {
  if (!avatar.healthBarFill) return;
  const frac = Math.max(0, avatar.health / PLAYER_MAX_HEALTH);
  avatar.healthBarFill.scaling.x = frac;
  avatar.healthBarFill.position.x = -0.58 * (1 - frac);
  // Green normally; red once they're within one solid hit of dying.
  avatar.healthBarFillMat.emissiveColor = BABYLON.Color3.FromHexString(
    frac <= 0.1 ? '#e74c3c' : '#2ecc71'
  );
}

// Your own health readout (bottom-left DOM bar + number).
function updateHudHealth(health) {
  const fill = document.getElementById('hudHealthBarFill');
  const text = document.getElementById('hudHealthBarText');
  if (!fill || !text) return;
  const frac = Math.max(0, health / PLAYER_MAX_HEALTH);
  fill.style.width = `${frac * 100}%`;
  fill.style.backgroundColor = frac <= 0.1 ? '#e74c3c' : frac <= 0.35 ? '#e67e22' : '#2ecc71';
  text.textContent = `${health} / ${PLAYER_MAX_HEALTH}`;
}

// Adds a new player's avatar to the scene (called for both the local
// player and every remote player).
function addPlayer(id, playerData) {
  const { capsule, nose } = createCapsuleMesh(id, playerData.color);
  capsule.position.x = playerData.x;
  capsule.position.z = playerData.z;

  // In first-person, you don't see your own body - the camera IS your
  // eyes. Leaving the mesh visible would mean staring at the inside of
  // your own capsule. It stays fully real for hit-detection and for
  // everyone ELSE, who still sees you normally; only your own local
  // rendering of yourself is hidden.
  if (id === localPlayerId && MODE_CONFIG[currentMode].cameraType === 'first-person') {
    capsule.isVisible = false;
    // isVisible doesn't cascade - sweep every attached piece (gun, barrel)
    capsule.getChildMeshes().forEach((m) => { m.isVisible = false; });
  }

  // Only the LOCAL player's capsule needs to be collision-aware (it's the
  // only mesh we actively move via moveWithCollisions). Remote players'
  // positions already had collisions applied on their own machines, so
  // re-checking here would just double the work.
  if (id === localPlayerId) {
    capsule.checkCollisions = true;
    // Babylon approximates the moving body as an ellipsoid - match it to
    // the capsule's actual proportions (0.4 radius, 1.8 tall).
    capsule.ellipsoid = new BABYLON.Vector3(0.4, 0.9, 0.4);

    // Squad Mode aims with a stick from a top-down view - give the local
    // player a Brawl-Stars-style ground reticle so the aim direction is
    // obvious at a glance (the nose cone alone is subtle from above).
    if (currentMode === 'mobile-squad') {
      attachAimReticle(capsule, playerData.color, 1.5, 0.55);
    }
  }

  // Height: 0.9 = capsule center standing on the ground. Anything above
  // that means the player is mid-dash (Mobile's gesture dashes are the
  // first mechanic that leaves the ground).
  const startY = typeof playerData.y === 'number' ? playerData.y : 0.9;
  capsule.position.y = startY;

  playerAvatars[id] = {
    mesh: capsule,
    nose,
    colorHex: playerData.color, // remembered so we can revert after a hit-flash
    team: playerData.team || null,
    health: typeof playerData.health === 'number' ? playerData.health : PLAYER_MAX_HEALTH,
    alive: playerData.alive !== false,
    // "target" values are where remote players are glide-interpolating
    // toward. For the local player these aren't used for movement.
    targetX: playerData.x,
    targetY: startY,
    targetZ: playerData.z,
  };

  // Floating health bar - remote players only. You never need to see your
  // own floating bar (the corner HUD covers you), and skipping it entirely
  // also sidesteps having to hide it per camera mode.
  if (id !== localPlayerId) {
    const { fill, fillMat } = attachHealthBar(capsule);
    playerAvatars[id].healthBarFill = fill;
    playerAvatars[id].healthBarFillMat = fillMat;
    updateHealthBarVisual(playerAvatars[id]);
  }
}

function removePlayer(id) {
  const avatar = playerAvatars[id];
  if (!avatar) return;
  avatar.mesh.dispose(); // also disposes the parented nose mesh
  delete playerAvatars[id];
}

// ----------------------------------------------------------------------------
// MINIONS: networked ranged squad (Squad / Solo FPS / Solo TPS / Swarm)
// ----------------------------------------------------------------------------
// Minions are the Mobile platform's identity - a little swarm that fights
// alongside (or, in Swarm mode, INSTEAD of) the player. They:
//   - lock onto the nearest enemy the player is facing (or, for the leaderless
//     Swarm mode, nearest to the swarm's center),
//   - chase into range and zap it once a second for light damage,
//   - can be shot and killed by enemies, respawning near their owner after a
//     cooldown,
//   - and are fully NETWORKED: every client renders and can shoot at every
//     other player's minions, not just its own.
//
// Authority model (matches the rest of this prototype): each client is the
// source of truth for ITS OWN minions' health/alive state. It broadcasts
// their positions ~10x/sec; other clients render those as "remote minions"
// and, when they shoot one, tell its owner (who applies the damage).

// --- Our own minions (authoritative) ---
const minions = [];
// --- Other players' minions, keyed by owner id, for rendering + hit-testing ---
// remoteMinions[ownerId] = { color, minions: [{ mesh, targetX, targetZ, alive, flashTimeoutId }] }
const remoteMinions = {};

// Shared combat target our minions are focusing - either
// { kind: 'player', id } or { kind: 'minion', ownerId, index } or null.
let currentMinionTarget = null;
let msSinceMinionScan = 0;        // throttles the target re-scan
let msSinceMinionSend = 0;        // throttles the outbound minionsUpdate
let localSpawnPoint = { x: 0, z: 0 }; // our server-assigned spawn (swarm minions rally here)
const activeZaps = [];            // transient attack tracer lines, self-disposing

// Idle formation offsets in the leader's LOCAL space (support modes only);
// sized generously so it works for any small squad count.
const MINION_OFFSETS = [
  { x: -1.2, z: -1.4 }, { x: 1.2, z: -1.4 },
  { x: -2.2, z: -0.2 }, { x: 2.2, z: -0.2 },
  { x: 0, z: -2.4 },    { x: 0, z: 1.6 },
];

// Spawns `count` minions around (spawnX, spawnZ) with the given color/scale.
// Each minion starts at its formation offset from the spawn (rather than all
// stacked on the exact same point).
function spawnMinions(count, colorHex, spawnX, spawnZ, scale) {
  for (let i = 0; i < count; i++) {
    const off = MINION_OFFSETS[i % MINION_OFFSETS.length];
    const { capsule, nose } = createCapsuleMesh(`minion-${i}`, colorHex);
    capsule.scaling.setAll(scale);
    capsule.position.set(spawnX + off.x, 0.9 * scale, spawnZ + off.z); // 0.9*scale keeps the shrunk capsule resting on the ground
    // Every one of OUR minions gets a small facing reticle, so you can
    // read at a glance who each one is turning toward / about to zap.
    attachAimReticle(capsule, colorHex, 1.3, 0.4);
    minions.push({
      index: i,
      mesh: capsule,
      nose,
      colorHex,
      scale,
      offset: off,
      health: MINION_HEALTH,
      alive: true,
      respawnAt: null,   // set to a timestamp while dead
      lastAttackAt: 0,
      flashTimeoutId: null,
      commandX: spawnX + off.x, // Swarm mode: where the player last tapped (defaults to spawn)
      commandZ: spawnZ + off.z,
    });
  }
}

// Disposes every one of OUR minions and empties the array - used when the
// leader dies and during mode-switch/respawn teardown.
function hideLocalMinions() {
  minions.forEach((m) => {
    if (m.flashTimeoutId) clearTimeout(m.flashTimeoutId);
    m.mesh.dispose(); // disposes the parented nose too
  });
  minions.length = 0;
  currentMinionTarget = null;
}

function killMinion(minion) {
  minion.alive = false;
  minion.respawnAt = performance.now() + MINION_RESPAWN_COOLDOWN_MS;
  minion.mesh.setEnabled(false); // setEnabled (not isVisible) so the parented nose hides too
}

function reviveMinion(minion) {
  minion.alive = true;
  minion.health = MINION_HEALTH;
  minion.respawnAt = null;
  minion.mesh.setEnabled(true);
  // Reappear at the leader (support modes) or the swarm's spawn point.
  const leader = playerAvatars[localPlayerId];
  const rx = leader ? leader.mesh.position.x : localSpawnPoint.x;
  const rz = leader ? leader.mesh.position.z : localSpawnPoint.z;
  minion.mesh.position.set(rx, 0.9 * minion.scale, rz);
  minion.commandX = rx;
  minion.commandZ = rz;
}

// Average position of our living minions (used as the Swarm's targeting
// origin, since Swarm mode has no leader). Falls back to the spawn point.
function swarmCentroid() {
  let sx = 0, sz = 0, n = 0;
  minions.forEach((m) => {
    if (!m.alive) return;
    sx += m.mesh.position.x;
    sz += m.mesh.position.z;
    n++;
  });
  if (n === 0) return { x: localSpawnPoint.x, z: localSpawnPoint.z };
  return { x: sx / n, z: sz / n };
}

// Finds the best enemy for our minions to focus. Candidates are BOTH
// enemy players and enemy minions (so swarms can fight swarms - a Swarm
// Command player has no body of their own to shoot at, only minions).
// Nearest candidate within range wins; for leader-based modes it must
// also be within a cone of the leader's facing (so minions attack roughly
// where you're looking, not behind you). Swarm mode has no facing, so it
// just takes nearest-to-swarm-center with no cone filter.
//
// Returns { kind: 'player', id } or { kind: 'minion', ownerId, index }
// or null.
function findMinionTarget() {
  const leader = playerAvatars[localPlayerId];
  let originX, originZ, facingYaw;
  if (leader) {
    originX = leader.mesh.position.x;
    originZ = leader.mesh.position.z;
    facingYaw = leader.mesh.rotation.y;
  } else {
    const c = swarmCentroid();
    originX = c.x;
    originZ = c.z;
    facingYaw = null; // no cone filter for the swarm
  }

  const coneRad = (MINION_TARGET_CONE_DEGREES * Math.PI) / 180;
  let best = null;
  let bestDistSq = MINION_TARGET_MAX_DISTANCE * MINION_TARGET_MAX_DISTANCE;

  // Shared filter: keeps whichever candidate is nearest and (for leader
  // modes) inside the aim cone.
  const consider = (x, z, ref) => {
    const dx = x - originX;
    const dz = z - originZ;
    const distSq = dx * dx + dz * dz;
    if (distSq > bestDistSq) return;

    if (facingYaw !== null) {
      const angleTo = Math.atan2(dx, dz);
      let da = angleTo - facingYaw;
      da = Math.atan2(Math.sin(da), Math.cos(da)); // wrap to [-PI, PI]
      if (Math.abs(da) > coneRad) return;
    }

    best = ref;
    bestDistSq = distSq;
  };

  for (const [id, avatar] of Object.entries(playerAvatars)) {
    if (id === localPlayerId) continue;
    if (!avatar.alive) continue;
    if (localTeam && avatar.team === localTeam) continue; // never target teammates
    consider(avatar.mesh.position.x, avatar.mesh.position.z, { kind: 'player', id });
  }

  for (const [ownerId, rm] of Object.entries(remoteMinions)) {
    if (localTeam && rm.team === localTeam) continue; // teammates' minions are friends too
    for (let i = 0; i < rm.minions.length; i++) {
      const m = rm.minions[i];
      if (!m || !m.alive) continue;
      consider(m.mesh.position.x, m.mesh.position.z, { kind: 'minion', ownerId, index: i });
    }
  }

  return best;
}

// Turns a stored target reference into a live position - or null if the
// target has died/left since we picked it (callers treat null as "no
// target this frame"; the next scan will pick a fresh one).
function resolveMinionTarget(t) {
  if (!t) return null;
  if (t.kind === 'player') {
    const a = playerAvatars[t.id];
    if (!a || !a.alive) return null;
    return { x: a.mesh.position.x, z: a.mesh.position.z };
  }
  const rm = remoteMinions[t.ownerId];
  const m = rm && rm.minions[t.index];
  if (!m || !m.alive) return null;
  return { x: m.mesh.position.x, z: m.mesh.position.z };
}

// Draws a short-lived tracer line for a minion's zap. Owner-side only for
// now - the target flashing white + its health bar dropping (both networked)
// are what everyone else sees; a fully-networked beam is deferred polish.
function showZap(fromPos, toPos, colorHex) {
  const line = BABYLON.MeshBuilder.CreateLines(
    `zap-${Date.now()}-${Math.random()}`,
    { points: [
      new BABYLON.Vector3(fromPos.x, 1.0, fromPos.z),
      new BABYLON.Vector3(toPos.x, 1.0, toPos.z),
    ] },
    scene
  );
  line.color = BABYLON.Color3.FromHexString(colorHex);
  line.isPickable = false;
  activeZaps.push(line);
  setTimeout(() => {
    if (!line.isDisposed()) line.dispose();
    const idx = activeZaps.indexOf(line);
    if (idx !== -1) activeZaps.splice(idx, 1);
  }, MINION_ZAP_DURATION_MS);
}

// Runs our own minions: targeting, movement, ranged attack, and
// death/respawn. Called every frame for any mode with minions.
//
// Attack and movement are deliberately INDEPENDENT decisions each frame,
// so a minion keeps firing while it repositions ("they can shoot while
// moving"). Movement differs by mode:
//   - Swarm Command: minions go where the player last tapped, period.
//     Targets get shot when they come into range, but never chased -
//     positioning is entirely the commander's job.
//   - Squad/FPS/TPS: minions auto-chase the current target into firing
//     range, or fall back into formation behind the leader when idle.
function updateMinions(deltaSeconds) {
  const now = performance.now();
  const isSwarm = !!(MODE_CONFIG[currentMode] && MODE_CONFIG[currentMode].minionsOnly);

  msSinceMinionScan += deltaSeconds * 1000;
  if (msSinceMinionScan >= MINION_TARGET_SCAN_INTERVAL_MS) {
    msSinceMinionScan = 0;
    currentMinionTarget = findMinionTarget();
  }
  const target = resolveMinionTarget(currentMinionTarget);

  const leader = playerAvatars[localPlayerId];
  let leaderX = 0, leaderZ = 0, sinY = 0, cosY = 1;
  if (leader) {
    leaderX = leader.mesh.position.x;
    leaderZ = leader.mesh.position.z;
    sinY = Math.sin(leader.mesh.rotation.y);
    cosY = Math.cos(leader.mesh.rotation.y);
  }

  const rangeSq = MINION_ATTACK_RANGE * MINION_ATTACK_RANGE;

  minions.forEach((minion) => {
    if (!minion.alive) {
      if (minion.respawnAt !== null && now >= minion.respawnAt) reviveMinion(minion);
      return;
    }

    // --- Attack: fire on the target whenever it's in range and the
    // per-minion cooldown is up, regardless of what movement is doing. ---
    let targetInRange = false;
    if (target) {
      const adx = target.x - minion.mesh.position.x;
      const adz = target.z - minion.mesh.position.z;
      targetInRange = adx * adx + adz * adz <= rangeSq;

      if (targetInRange && now - minion.lastAttackAt >= MINION_ATTACK_COOLDOWN_MS) {
        minion.lastAttackAt = now;
        if (currentMinionTarget.kind === 'player') {
          socket.emit('hit', { targetId: currentMinionTarget.id, damage: MINION_DAMAGE });
        } else {
          socket.emit('minionHit', {
            ownerId: currentMinionTarget.ownerId,
            minionIndex: currentMinionTarget.index,
            damage: MINION_DAMAGE,
          });
        }
        showZap(minion.mesh.position, target, minion.colorHex);
        triggerHitMarker(); // our minions' damage counts as OUR hits
      }
    }

    // --- Movement ---
    let desiredX, desiredZ;
    if (isSwarm) {
      // Player commands are absolute - no auto-chasing.
      desiredX = minion.commandX;
      desiredZ = minion.commandZ;
    } else if (target) {
      if (!targetInRange) {
        desiredX = target.x; // close into firing range
        desiredZ = target.z;
      } else {
        desiredX = minion.mesh.position.x; // in range: hold position and fire
        desiredZ = minion.mesh.position.z;
      }
    } else if (leader) {
      // Idle: trail behind the leader in its local space.
      desiredX = leaderX + (minion.offset.x * cosY + minion.offset.z * sinY);
      desiredZ = leaderZ + (-minion.offset.x * sinY + minion.offset.z * cosY);
    } else {
      desiredX = minion.mesh.position.x;
      desiredZ = minion.mesh.position.z;
    }

    const lerpSpeed = target ? MINION_CHASE_LERP_SPEED : MINION_FOLLOW_LERP_SPEED;
    const lf = Math.min(1, lerpSpeed * deltaSeconds);
    minion.mesh.position.x += (desiredX - minion.mesh.position.x) * lf;
    minion.mesh.position.z += (desiredZ - minion.mesh.position.z) * lf;

    // --- Facing: at the target when we have one, else direction of travel ---
    const faceX = target ? target.x - minion.mesh.position.x : desiredX - minion.mesh.position.x;
    const faceZ = target ? target.z - minion.mesh.position.z : desiredZ - minion.mesh.position.z;
    if (faceX * faceX + faceZ * faceZ > 0.0004) {
      minion.mesh.rotation.y = Math.atan2(faceX, faceZ);
    }
  });
}

// Broadcasts our minions' state to everyone else, throttled.
function maybeSendMinionsToServer(deltaMs) {
  if (!socket || minions.length === 0) return;
  msSinceMinionSend += deltaMs;
  if (msSinceMinionSend < MINION_NETWORK_SEND_INTERVAL_MS) return;
  msSinceMinionSend = 0;

  socket.emit('minionsUpdate', {
    minions: minions.map((m) => ({
      alive: m.alive,
      x: m.mesh.position.x,
      z: m.mesh.position.z,
      health: m.health,
    })),
  });
}

// --- Rendering OTHER players' minions ---
// Lazily creates the mesh for a remote minion the first time we hear about
// it, snapped directly to its reported position (NOT lerped in from the
// world origin, which would look like it teleporting across the map).
function ensureRemoteMinion(rm, index, x, z) {
  if (rm.minions[index]) return rm.minions[index];
  const { capsule } = createCapsuleMesh(`remote-minion-${index}-${Math.random()}`, rm.color);
  capsule.scaling.setAll(REMOTE_MINION_SCALE);
  capsule.position.set(x, 0.9 * REMOTE_MINION_SCALE, z);
  const entry = { mesh: capsule, targetX: x, targetZ: z, alive: true, flashTimeoutId: null };
  rm.minions[index] = entry;
  return entry;
}

function removeRemoteMinions(ownerId) {
  const rm = remoteMinions[ownerId];
  if (!rm) return;
  rm.minions.forEach((m) => {
    if (m.flashTimeoutId) clearTimeout(m.flashTimeoutId);
    m.mesh.dispose();
  });
  delete remoteMinions[ownerId];
}

function disposeAllRemoteMinions() {
  Object.keys(remoteMinions).forEach(removeRemoteMinions);
}

// Briefly flashes any mesh white then reverts it - shared by minion hits.
// The `holder` object stores the pending revert timer so overlapping hits
// don't leave a mesh stuck white.
function flashMeshWhite(mesh, revertColorHex, holder) {
  if (holder.flashTimeoutId) clearTimeout(holder.flashTimeoutId);
  mesh.material.diffuseColor = BABYLON.Color3.White();
  holder.flashTimeoutId = setTimeout(() => {
    if (!mesh.isDisposed()) mesh.material.diffuseColor = BABYLON.Color3.FromHexString(revertColorHex);
    holder.flashTimeoutId = null;
  }, HIT_FLASH_DURATION_MS);
}

// ----------------------------------------------------------------------------
// INPUT: PC (keyboard + mouse)
// ----------------------------------------------------------------------------
const keysDown = {};
window.addEventListener('keydown', (e) => {
  keysDown[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
  keysDown[e.key.toLowerCase()] = false;
});

// Accumulated yaw from mouse movement. Unlike the old ground-raycast aiming
// (used back when PC had a third-person camera), a first-person camera
// needs true "mouselook": dragging the mouse TURNS you, rather than
// pointing at a spot on the ground - there often isn't a sensible ground
// point to point at when you're looking near-level at eye height.
let pcAimYaw = 0;

function handlePcMouseLook(e) {
  if (currentMode !== 'pc') return;
  // movementX/Y is the pixel delta since the last mousemove event. Browsers
  // provide this whether or not Pointer Lock is active - Pointer Lock just
  // additionally hides the cursor and stops it hitting the screen edge, so
  // we request it for polish but don't depend on it for the core mechanic.
  pcAimYaw += e.movementX * MOUSE_LOOK_SENSITIVITY * sensitivityMultiplier;
}
window.addEventListener('mousemove', handlePcMouseLook);

canvas.addEventListener('pointerdown', (e) => {
  if (currentMode === 'pc' && e.button === 0) {
    tryFireProjectile();
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  }
});

// ----------------------------------------------------------------------------
// INPUT: Console (gamepad)
// ----------------------------------------------------------------------------
// Gamepads have no events for "stick moved" - the browser only lets you
// POLL their current state, so we read navigator.getGamepads() fresh every
// frame in the render loop (see readGamepadState below) rather than
// listening for anything here.
let gamepadAimYaw = 0; // holds its last value when the stick is released, rather than snapping to 0
let gamepadFireWasHeld = false; // edge-detection so holding the trigger doesn't fire every single frame
let consoleModeEnteredAt = 0;   // when Console mode started - drives the "no controller" grace period

function applyDeadzone(value) {
  return Math.abs(value) < GAMEPAD_DEADZONE ? 0 : value;
}

function readGamepadState() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  // Use the first connected gamepad we find - fine for a single local
  // playtester; a "pick your controller" UI would be needed for multiple
  // gamepads on one machine, which isn't a concern here.
  let pad = null;
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]) { pad = pads[i]; break; }
  }
  if (!pad) return { connected: false, moveX: 0, moveZ: 0, hasAimInput: false, aimX: 0, aimY: 0, firePressed: false };

  const leftX = applyDeadzone(pad.axes[0] || 0);
  const leftY = applyDeadzone(pad.axes[1] || 0);
  const rightX = applyDeadzone(pad.axes[2] || 0);
  const rightY = applyDeadzone(pad.axes[3] || 0);

  // Accept the right trigger OR the primary face button (A/Cross) as
  // fire - some Bluetooth controllers (especially paired to phones) map
  // triggers to nonstandard indices, and this doubles the odds a pad
  // "just works".
  const fireButton = pad.buttons[GAMEPAD_FIRE_BUTTON_INDEX];
  const altFireButton = pad.buttons[GAMEPAD_ALT_FIRE_BUTTON_INDEX];
  const firePressed =
    (!!fireButton && (fireButton.pressed || fireButton.value > 0.5)) ||
    (!!altFireButton && altFireButton.pressed);

  return {
    connected: true,
    moveX: leftX,
    moveZ: -leftY, // gamepad Y axis is inverted (up = negative) relative to our +Z-forward convention
    hasAimInput: rightX !== 0 || rightY !== 0,
    aimX: rightX,
    aimY: -rightY,
    firePressed,
  };
}

// Basic diagnostics - always on, harmless, and exactly what we'll want in
// the console when someone's Bluetooth controller mysteriously "doesn't
// work" on their device.
window.addEventListener('gamepadconnected', (e) => {
  console.log(`Gamepad connected: "${e.gamepad.id}" (${e.gamepad.buttons.length} buttons, ${e.gamepad.axes.length} axes)`);
});
window.addEventListener('gamepaddisconnected', (e) => {
  console.log(`Gamepad disconnected: "${e.gamepad.id}"`);
});

// ----------------------------------------------------------------------------
// INPUT: Mobile (on-screen touch)
// ----------------------------------------------------------------------------
// Left half of the screen = movement joystick. Right half = look/aim (drag)
// and fire (tap). We track touches by pointerId so a move-finger and a
// look-finger can both be active at once.
const joystickBaseEl = document.getElementById('touchJoystickBase');
const joystickKnobEl = document.getElementById('touchJoystickKnob');
const aimJoystickBaseEl = document.getElementById('aimJoystickBase');
const aimJoystickKnobEl = document.getElementById('aimJoystickKnob');
const touchHintEl = document.getElementById('touchHint');
const respawnCountdownEl = document.getElementById('respawnCountdown');

let moveTouchId = null;
let moveTouchOriginX = 0;
let moveTouchOriginY = 0;
let touchMoveX = 0; // -1..1
let touchMoveZ = 0; // -1..1

// Old drag-look scheme (still fully wired up - see MOBILE_TURN_SCHEME)
let lookTouchId = null;
let lookTouchStartX = 0;
let lookTouchStartY = 0;
let lookTouchStartTime = 0;
let lookTouchMaxMovement = 0; // largest single-axis movement seen, used to tell a tap from a drag
let touchAimYaw = 0;

// Squad Mode's aim stick (absolute angle = fire direction)
let aimTouchId = null;
let aimTouchOriginX = 0;
let aimTouchOriginY = 0;

// FPS/TPS turn stick (horizontal deflection = turn rate)
let turnTouchId = null;
let turnTouchOriginX = 0;
let turnTouchOriginY = 0;
let turnJoystickX = 0; // -1..1

// Positions the shared right-side stick visual at a touch point, in
// either its red "aim" look (Squad) or blue "turn" look (FPS/TPS).
function showAimJoystickAt(x, y, asTurnStick) {
  aimJoystickBaseEl.classList.toggle('turn-stick', asTurnStick);
  aimJoystickBaseEl.style.left = `${x - 55}px`;
  aimJoystickBaseEl.style.top = `${y - 55}px`;
  aimJoystickKnobEl.style.left = '30px';
  aimJoystickKnobEl.style.top = '30px';
  aimJoystickBaseEl.style.display = 'block';
}

function moveAimJoystickKnob(dx, dy) {
  const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_MAX_RADIUS);
  const angle = Math.atan2(dy, dx);
  aimJoystickKnobEl.style.left = `${30 + Math.cos(angle) * dist}px`;
  aimJoystickKnobEl.style.top = `${30 + Math.sin(angle) * dist}px`;
}

function hideAimJoystick() {
  aimJoystickBaseEl.style.display = 'none';
}

function isLeftHalf(x) {
  return x < canvas.clientWidth / 2;
}

function onTouchStart(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (isLeftHalf(x) && moveTouchId === null) {
    moveTouchId = e.pointerId;
    moveTouchOriginX = x;
    moveTouchOriginY = y;
    joystickBaseEl.style.left = `${x - 55}px`;
    joystickBaseEl.style.top = `${y - 55}px`;
    joystickBaseEl.style.display = 'block';
  } else if (!isLeftHalf(x)) {
    // Right half - which control it is depends on the mode:
    //   Squad             -> aim stick (absolute angle, release = fire)
    //   FPS/TPS           -> turn stick OR the old drag-look, per the
    //                        MOBILE_TURN_SCHEME experiment flag
    if (currentMode === 'mobile-squad' && aimTouchId === null) {
      aimTouchId = e.pointerId;
      aimTouchOriginX = x;
      aimTouchOriginY = y;
      showAimJoystickAt(x, y, false);
    } else if (currentMode !== 'mobile-squad' && MOBILE_TURN_SCHEME === 'turn-joystick' && turnTouchId === null) {
      turnTouchId = e.pointerId;
      turnTouchOriginX = x;
      turnTouchOriginY = y;
      turnJoystickX = 0;
      showAimJoystickAt(x, y, true);
    } else if (currentMode !== 'mobile-squad' && MOBILE_TURN_SCHEME === 'drag-look' && lookTouchId === null) {
      lookTouchId = e.pointerId;
      lookTouchStartX = x;
      lookTouchStartY = y;
      lookTouchStartTime = performance.now();
      lookTouchMaxMovement = 0;
    }
  }
}

function onTouchMove(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (e.pointerId === moveTouchId) {
    const dx = x - moveTouchOriginX;
    const dy = y - moveTouchOriginY;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), JOYSTICK_MAX_RADIUS);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * dist;
    const knobY = Math.sin(angle) * dist;
    joystickKnobEl.style.left = `${30 + knobX}px`;
    joystickKnobEl.style.top = `${30 + knobY}px`;

    // Normalize to -1..1 on each axis. Screen-down (+Y) should mean "walk
    // backward" (-Z), matching the same forward=+Z convention used
    // everywhere else in this file.
    touchMoveX = (knobX / JOYSTICK_MAX_RADIUS);
    touchMoveZ = -(knobY / JOYSTICK_MAX_RADIUS);
  } else if (e.pointerId === aimTouchId) {
    // Squad aim stick: the stick's ABSOLUTE angle is the aim direction,
    // applied to the character live so the nose visibly tracks it.
    // Screen-up is world +Z under the top-down camera, so the world angle
    // is atan2(dx, -dy) in our rotationY convention (0 = facing +Z).
    const dx = x - aimTouchOriginX;
    const dy = y - aimTouchOriginY;
    moveAimJoystickKnob(dx, dy);
    if (Math.hypot(dx, dy) >= AIM_STICK_MIN_DEFLECTION_PX) {
      const local = playerAvatars[localPlayerId];
      if (local) local.mesh.rotation.y = Math.atan2(dx, -dy);
    }
  } else if (e.pointerId === turnTouchId) {
    // FPS/TPS turn stick: horizontal deflection sets a turn RATE, which
    // the render loop integrates into yaw every frame (push further =
    // turn faster). Vertical deflection is intentionally ignored.
    const dx = x - turnTouchOriginX;
    const dy = y - turnTouchOriginY;
    moveAimJoystickKnob(dx, dy);
    turnJoystickX = Math.max(-1, Math.min(1, dx / JOYSTICK_MAX_RADIUS));
  } else if (e.pointerId === lookTouchId) {
    const dx = x - lookTouchStartX;
    const dy = y - lookTouchStartY;
    lookTouchMaxMovement = Math.max(lookTouchMaxMovement, Math.abs(dx), Math.abs(dy));

    // Drag delta since last frame's stored position turns the camera,
    // same idea as PC's mouselook but computed manually since touch events
    // don't reliably provide a movementX/Y equivalent across browsers.
    touchAimYaw += dx * TOUCH_LOOK_SENSITIVITY * sensitivityMultiplier;
    lookTouchStartX = x;
    lookTouchStartY = y;
  }
}

function onTouchEnd(e) {
  if (e.pointerId === moveTouchId) {
    moveTouchId = null;
    touchMoveX = 0;
    touchMoveZ = 0;
    joystickBaseEl.style.display = 'none';
  } else if (e.pointerId === aimTouchId) {
    // Squad: releasing the aim stick IS the fire gesture - one shot in
    // whatever direction the stick was pointing (already applied to
    // rotation.y live during the drag).
    aimTouchId = null;
    hideAimJoystick();
    tryFireProjectile();
  } else if (e.pointerId === turnTouchId) {
    // FPS/TPS turn stick: releasing fires once in the direction you're
    // CURRENTLY facing (your accumulated yaw) - deliberately NOT the
    // stick's own angle, unlike Squad's aim stick.
    turnTouchId = null;
    turnJoystickX = 0;
    hideAimJoystick();
    tryFireProjectile();
  } else if (e.pointerId === lookTouchId) {
    const duration = performance.now() - lookTouchStartTime;
    // A short, mostly-stationary touch counts as a tap (fire) rather than
    // a look-drag - the same distinction phone shooters use to let one
    // finger/zone do double duty for aiming and shooting.
    if (lookTouchMaxMovement < TOUCH_TAP_MAX_MOVEMENT_PX && duration < TOUCH_TAP_MAX_DURATION_MS) {
      tryFireProjectile();
    }
    lookTouchId = null;
  }
}

canvas.addEventListener('pointerdown', onTouchStart);
canvas.addEventListener('pointermove', onTouchMove);
canvas.addEventListener('pointerup', onTouchEnd);
canvas.addEventListener('pointercancel', onTouchEnd);

// ----------------------------------------------------------------------------
// INPUT: Swarm Command (tap = move swarm, drag = pan camera, pinch = zoom)
// ----------------------------------------------------------------------------
// A completely different touch model from the other mobile modes: there's
// no character to steer, so the whole screen is one map surface. We track
// every active finger by pointerId in a Map so we can tell one-finger
// gestures (tap or pan) apart from two-finger pinches.
const swarmPointers = new Map(); // pointerId -> last known {x, y}
let swarmPinchPrevDist = null;   // finger separation last frame, while pinching
let swarmTapCandidate = null;    // a touch that MIGHT still be a tap (hasn't moved/lasted too long yet)
// Camera can pan to the map edge; move COMMANDS clamp slightly inside it
// so minions (which don't collide with walls) never get told to stand
// inside the border geometry.
const SWARM_PAN_WORLD_LIMIT = MAP_HALF;
const SWARM_COMMAND_LIMIT = MAP_HALF - 2;

// Converts a screen point to the spot on the ground plane (y=0) under it,
// by casting a ray from the camera and intersecting it with the plane -
// the classic way to answer "where on the map did they tap?".
function screenPointToGround(screenX, screenY) {
  const ray = scene.createPickingRay(screenX, screenY, BABYLON.Matrix.Identity(), camera);
  if (Math.abs(ray.direction.y) < 1e-6) return null; // looking parallel to the ground - no sensible answer
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    z: ray.origin.z + ray.direction.z * t,
  };
}

// Sends every minion toward the tapped point, each with a small random
// scatter so they arrive as a loose cluster instead of a single stack.
// The point is clamped to the map: a tap near the horizon can raycast to
// a spot far beyond the ground plane's edge, and without the clamp the
// swarm would happily march off into the void.
function commandSwarmTo(groundPoint) {
  const gx = Math.max(-SWARM_COMMAND_LIMIT, Math.min(SWARM_COMMAND_LIMIT, groundPoint.x));
  const gz = Math.max(-SWARM_COMMAND_LIMIT, Math.min(SWARM_COMMAND_LIMIT, groundPoint.z));
  minions.forEach((minion) => {
    minion.commandX = gx + (Math.random() - 0.5) * 2 * SWARM_COMMAND_SCATTER;
    minion.commandZ = gz + (Math.random() - 0.5) * 2 * SWARM_COMMAND_SCATTER;
  });
}

function onSwarmTouchStart(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch-swarm') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  swarmPointers.set(e.pointerId, { x, y });

  if (swarmPointers.size === 1) {
    swarmTapCandidate = { pointerId: e.pointerId, startTime: performance.now(), maxMovement: 0 };
  } else {
    swarmTapCandidate = null; // a second finger means pinch, not tap
    if (swarmPointers.size === 2) {
      const [a, b] = [...swarmPointers.values()];
      swarmPinchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
}

function onSwarmTouchMove(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch-swarm') return;
  const prev = swarmPointers.get(e.pointerId);
  if (!prev) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const dx = x - prev.x;
  const dy = y - prev.y;
  swarmPointers.set(e.pointerId, { x, y });

  if (swarmTapCandidate && swarmTapCandidate.pointerId === e.pointerId) {
    swarmTapCandidate.maxMovement = Math.max(swarmTapCandidate.maxMovement, Math.abs(dx), Math.abs(dy));
  }

  if (swarmPointers.size === 1) {
    // One-finger drag pans the camera so the map appears to follow the
    // finger. Scale pixels->world units by zoom level (radius) so a drag
    // covers a consistent-feeling screen distance whether zoomed in or out.
    const worldPerPixel = (camera.radius / canvas.clientHeight) * 1.2;
    camera.target.x = Math.max(-SWARM_PAN_WORLD_LIMIT, Math.min(SWARM_PAN_WORLD_LIMIT, camera.target.x - dx * worldPerPixel));
    camera.target.z = Math.max(-SWARM_PAN_WORLD_LIMIT, Math.min(SWARM_PAN_WORLD_LIMIT, camera.target.z + dy * worldPerPixel));
  } else if (swarmPointers.size === 2 && swarmPinchPrevDist !== null) {
    // Pinch: fingers moving apart shrinks radius (zoom in), together
    // grows it (zoom out).
    const [a, b] = [...swarmPointers.values()];
    const newDist = Math.hypot(a.x - b.x, a.y - b.y);
    if (newDist > 1) {
      camera.radius = Math.max(SWARM_CAM_MIN_RADIUS, Math.min(SWARM_CAM_MAX_RADIUS, camera.radius * (swarmPinchPrevDist / newDist)));
      swarmPinchPrevDist = newDist;
    }
  }
}

function onSwarmTouchEnd(e) {
  if (!swarmPointers.has(e.pointerId)) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  swarmPointers.delete(e.pointerId);
  if (swarmPointers.size < 2) swarmPinchPrevDist = null;

  // A short, mostly-stationary touch is a tap = "swarm, go here".
  if (swarmTapCandidate && swarmTapCandidate.pointerId === e.pointerId) {
    const duration = performance.now() - swarmTapCandidate.startTime;
    if (swarmTapCandidate.maxMovement < TOUCH_TAP_MAX_MOVEMENT_PX && duration < TOUCH_TAP_MAX_DURATION_MS) {
      const ground = screenPointToGround(x, y);
      if (ground) commandSwarmTo(ground);
    }
    swarmTapCandidate = null;
  }
}

canvas.addEventListener('pointerdown', onSwarmTouchStart);
canvas.addEventListener('pointermove', onSwarmTouchMove);
canvas.addEventListener('pointerup', onSwarmTouchEnd);
canvas.addEventListener('pointercancel', onSwarmTouchEnd);

// ----------------------------------------------------------------------------
// INPUT: Mobile (dual-stick + gesture pad) - the CURRENT mobile design
// ----------------------------------------------------------------------------
// Three input surfaces, all usable at the same time (each touch is tracked
// by its own pointerId, so a thumb on each stick plus a finger drawing in
// the pad all coexist):
//
//   1. LEFT STICK  (bottom-left of screen)  - move, exactly like PC's WASD
//   2. RIGHT STICK (bottom-right of screen) - turn/aim the camera. Pure
//      aim: releasing it does NOT fire (unlike the older experiments).
//      Firing is a separate placeholder button - the design session locked
//      movement/aim but left the firing input open (see backlog).
//   3. GESTURE PAD (the see-through panel above the sticks) - draw a shape,
//      lift your finger, and the dash executes. Recorded-then-executed,
//      NOT live: nothing moves until you release, and the camera direction
//      used to interpret the shape is LOCKED at the moment your finger
//      first touched the pad. That's deliberate: draw, release, snap your
//      thumb back to the aim stick, and track a target while the dash
//      plays out.
//
// HOW A DRAWN SHAPE BECOMES MOVEMENT
// The pad is read like a bird's-eye minimap of your immediate surroundings:
// screen-up = "the way the camera faced when the gesture started",
// screen-x = sideways. Two special straight strokes are the easy/safe moves
// (their vertical direction means height, not backward):
//   - start LOW, drag UP          -> jump-dash  (forward leap arc)
//   - start HIGH, drag STRAIGHT DOWN -> slide-dash (forward ground slide -
//     deliberately NOT a backward dash!)
// Everything curved is free-form: the traced shape itself (smoothed into a
// clean swoop) becomes the flight path. This is why moving BACKWARD
// requires drawing a curve that swoops around a side and ends at the
// bottom - simple inputs stay safe, curvy inputs unlock the full move set,
// which is the design's intended casual/skilled split.
//
// A sharp out-and-back "V" stroke is the separate wall-swoop gesture:
// swipe toward a nearby wall then away, and you get a push-off impulse in
// the direction of the return stroke (first-pass implementation).

const gestureZoneEl = document.getElementById('gestureZone');
const gestureCanvasEl = document.getElementById('gestureCanvas');
const gestureResultLabelEl = document.getElementById('gestureResultLabel');
const fireButtonEl = document.getElementById('fireButton');

// Trace/result colors per gesture type (also used for the in-world path line)
const GESTURE_COLORS = {
  jump: '#35e0ff',
  slide: '#ffb037',
  freeform: '#c07bff',
  wallswoop: '#ffe25e',
  reject: '#ff5e5e',
  draw: '#ffffff',
};

// --- Dual-stick state ---
let dualMoveTouchId = null;
let dualMoveOriginX = 0;
let dualMoveOriginY = 0;
let dualMoveX = 0; // -1..1, same convention as the legacy move stick
let dualMoveZ = 0;
let dualAimTouchId = null;
let dualAimOriginX = 0;
let dualTurnX = 0; // -1..1 horizontal deflection -> turn rate
let fireHeld = false; // fire button held: the render loop fires on cooldown

// --- Gesture pad state ---
let gestureCtx = null;       // 2d context for drawing the finger trace
let gesturePointerId = null; // the one finger currently drawing (if any)
let gesturePoints = [];      // raw trace, in pad-local pixels
let gestureStartYaw = 0;     // camera yaw LOCKED at the moment the gesture started
let gestureFadeTimeoutId = null;
let gestureResultTimeoutId = null;

// --- Dash state ---
// The dash currently playing back, or null. Built by executeGesture():
//   { type, points: [{x,z}...], duration, heightPeak, elapsed, line }
let activeDash = null;
let lastDashEndedAt = 0;
let wallSwoopChain = 0; // consecutive swoops without touching ground

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

// --- Dual sticks (canvas touches in the bottom strip of the screen) ---
// Same floating-stick pattern as the legacy modes: the stick base appears
// wherever the thumb lands inside its region, which is far more forgiving
// than demanding a precise hit on a fixed circle.
function onDualTouchStart(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch-dual') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Above the stick strip is the gesture pad's territory (its own element
  // grabs those touches before the canvas ever sees them) or dead space.
  if (y < rect.height * (1 - DUAL_STICK_STRIP_FRACTION)) return;

  if (isLeftHalf(x) && dualMoveTouchId === null) {
    dualMoveTouchId = e.pointerId;
    dualMoveOriginX = x;
    dualMoveOriginY = y;
    joystickBaseEl.style.left = `${x - 55}px`;
    joystickBaseEl.style.top = `${y - 55}px`;
    joystickBaseEl.style.display = 'block';
    joystickKnobEl.style.left = '30px';
    joystickKnobEl.style.top = '30px';
  } else if (!isLeftHalf(x) && dualAimTouchId === null) {
    dualAimTouchId = e.pointerId;
    dualAimOriginX = x;
    dualTurnX = 0;
    showAimJoystickAt(x, y, true); // blue "turn stick" look
  }
}

function onDualTouchMove(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch-dual') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (e.pointerId === dualMoveTouchId) {
    const dx = x - dualMoveOriginX;
    const dy = y - dualMoveOriginY;
    const dist = Math.min(Math.hypot(dx, dy), JOYSTICK_MAX_RADIUS);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * dist;
    const knobY = Math.sin(angle) * dist;
    joystickKnobEl.style.left = `${30 + knobX}px`;
    joystickKnobEl.style.top = `${30 + knobY}px`;
    // Screen-down = walk backward, matching every other stick in this file.
    dualMoveX = knobX / JOYSTICK_MAX_RADIUS;
    dualMoveZ = -(knobY / JOYSTICK_MAX_RADIUS);
  } else if (e.pointerId === dualAimTouchId) {
    const dx = x - dualAimOriginX;
    moveAimJoystickKnob(dx, 0); // knob slides horizontally only - it's a yaw-rate stick
    dualTurnX = clamp(dx / JOYSTICK_MAX_RADIUS, -1, 1);
    // NOTE: no pitch/vertical aim for now - the map is flat and every
    // projectile flies level, so up/down aim would be cosmetic. Revisit
    // when the map gets verticality (see the map-session dependency).
  }
}

function onDualTouchEnd(e) {
  if (e.pointerId === dualMoveTouchId) {
    dualMoveTouchId = null;
    dualMoveX = 0;
    dualMoveZ = 0;
    joystickBaseEl.style.display = 'none';
  } else if (e.pointerId === dualAimTouchId) {
    // Releasing the aim stick does NOTHING but stop turning - deliberately
    // not a fire trigger (that was the old experiments' scheme).
    dualAimTouchId = null;
    dualTurnX = 0;
    hideAimJoystick();
  }
}

canvas.addEventListener('pointerdown', onDualTouchStart);
canvas.addEventListener('pointermove', onDualTouchMove);
canvas.addEventListener('pointerup', onDualTouchEnd);
canvas.addEventListener('pointercancel', onDualTouchEnd);

// --- Placeholder fire button (see backlog: mobile firing input undecided) ---
// Hold to auto-fire at the normal cooldown rate; the render loop does the
// repeating so the rate limit lives in exactly one place (tryFireProjectile).
fireButtonEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); // stop the browser synthesizing a duplicate mouse click
  fireHeld = true;
  tryFireProjectile();
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
  fireButtonEl.addEventListener(evt, () => { fireHeld = false; });
});

// --- Gesture pad canvas (the visible finger trace) ---
// The pad's <canvas> is resized to its on-screen pixels whenever the pad is
// shown (and on window resizes) so traces are crisp on high-DPI phones.
function syncGestureCanvasSize() {
  const rect = gestureZoneEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  gestureCanvasEl.width = Math.max(1, Math.round(rect.width * dpr));
  gestureCanvasEl.height = Math.max(1, Math.round(rect.height * dpr));
  gestureCtx = gestureCanvasEl.getContext('2d');
  gestureCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
}
window.addEventListener('resize', () => {
  if (gestureZoneEl.style.display === 'block') syncGestureCanvasSize();
});

function clearGestureCanvas() {
  if (!gestureCtx) return;
  gestureCtx.save();
  gestureCtx.setTransform(1, 0, 0, 1, 0, 0);
  gestureCtx.clearRect(0, 0, gestureCanvasEl.width, gestureCanvasEl.height);
  gestureCtx.restore();
}

function drawPadTrace(points, colorHex) {
  clearGestureCanvas();
  if (!gestureCtx || points.length < 2) return;
  gestureCtx.strokeStyle = colorHex;
  gestureCtx.lineWidth = 3;
  gestureCtx.lineCap = 'round';
  gestureCtx.lineJoin = 'round';
  gestureCtx.beginPath();
  gestureCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) gestureCtx.lineTo(points[i].x, points[i].y);
  gestureCtx.stroke();
}

// Briefly shows the CLEANED-UP stroke in its result color, so the player
// sees what the game actually read from their finger, then fades it.
function flashPadTrace(points, colorHex) {
  if (points && points.length >= 2) drawPadTrace(points, colorHex);
  if (gestureFadeTimeoutId) clearTimeout(gestureFadeTimeoutId);
  gestureFadeTimeoutId = setTimeout(() => {
    clearGestureCanvas();
    gestureFadeTimeoutId = null;
  }, 600);
}

function showGestureResult(text, colorHex) {
  gestureResultLabelEl.textContent = text;
  gestureResultLabelEl.style.color = colorHex || '#fff';
  if (gestureResultTimeoutId) clearTimeout(gestureResultTimeoutId);
  gestureResultTimeoutId = setTimeout(() => {
    gestureResultLabelEl.textContent = '';
    gestureResultTimeoutId = null;
  }, 900);
}

// --- Small geometry helpers for stroke analysis ---
function polylineLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

// Moving-average smoothing: each point becomes the average of its
// neighbors. Kills the pixel-level jitter of a real finger without
// changing the stroke's overall shape.
function smoothPolyline(points, windowSize) {
  if (points.length <= 2) return points.slice();
  const half = Math.floor(windowSize / 2);
  return points.map((_, i) => {
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      sx += points[j].x;
      sy += points[j].y;
      n++;
    }
    return { x: sx / n, y: sy / n };
  });
}

// Re-walks the stroke and lays down `count` points at perfectly even
// spacing along it. Fingers don't move at constant speed (points bunch up
// where you slow down), and evenly spaced points are what lets the dash
// play back at a steady pace along the drawn shape.
function resamplePolyline(points, count) {
  const total = polylineLength(points);
  if (total === 0 || points.length < 2) return points.slice();
  const step = total / (count - 1);
  const out = [points[0]];
  let acc = 0;
  let i = 1;
  let prev = points[0];
  while (out.length < count - 1 && i < points.length) {
    const seg = Math.hypot(points[i].x - prev.x, points[i].y - prev.y);
    if (seg === 0) { i++; continue; }
    if (acc + seg >= step) {
      const f = (step - acc) / seg;
      const nx = prev.x + (points[i].x - prev.x) * f;
      const ny = prev.y + (points[i].y - prev.y) * f;
      out.push({ x: nx, y: ny });
      prev = { x: nx, y: ny };
      acc = 0;
    } else {
      acc += seg;
      prev = points[i];
      i++;
    }
  }
  while (out.length < count) out.push(points[points.length - 1]);
  return out;
}

// Signed area enclosed by the stroke (shoelace formula). Used to tell a
// wall-swoop "V" (retraces itself, ~zero area) from a swooping curve
// (encloses lots of area) - see WALL_SWOOP_AREA_RATIO_MAX.
function shoelaceArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Maps a pad-space vector to a world-space one. Screen-up = the camera's
// forward AT GESTURE START (the yaw passed in), screen-right = its right.
// (rotationY convention from the rest of this file: forward = (sin yaw,
// cos yaw), so right = (cos yaw, -sin yaw).)
function gestureVecToWorld(dxPx, dyPx, yaw, unitsPerPx) {
  const upPx = -dyPx; // screen y grows downward; flip so "up" is positive
  const fX = Math.sin(yaw), fZ = Math.cos(yaw);
  const rX = Math.cos(yaw), rZ = -Math.sin(yaw);
  return {
    x: (dxPx * rX + upPx * fX) * unitsPerPx,
    z: (dxPx * rZ + upPx * fZ) * unitsPerPx,
  };
}

// ---------------------------------------------------------------------------
// Gesture classification: raw finger trace -> which move was drawn?
// ---------------------------------------------------------------------------
// Returns one of:
//   { type: 'reject', reason }                       - nothing usable
//   { type: 'wallswoop', outX, outY, backX, backY, pts }
//   { type: 'jump' | 'slide', netX, netY, pathLen, pts }
//   { type: 'freeform', pts, pathLen }
function classifyGesture(rawPoints, zoneHeightPx) {
  if (rawPoints.length < 2) return { type: 'reject', reason: 'draw a bigger shape' };

  const smoothed = smoothPolyline(rawPoints, GESTURE_SMOOTH_WINDOW);
  const pathLen = polylineLength(smoothed);
  if (pathLen < GESTURE_MIN_STROKE_PX) return { type: 'reject', reason: 'draw a bigger shape' };

  const pts = resamplePolyline(smoothed, GESTURE_RESAMPLE_POINTS);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const netX = last.x - first.x;
  const netY = last.y - first.y;
  const straightness = Math.hypot(netX, netY) / pathLen;
  // Where the stroke STARTED: 0 = bottom of the pad, 1 = top.
  const startHeight = 1 - first.y / zoneHeightPx;

  // --- Wall-swoop check first: a sharp out-and-back "V" ---
  // Apex = the point of the stroke farthest from where it began.
  let apexIdx = 0;
  let apexDistSq = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - first.x;
    const dy = pts[i].y - first.y;
    const d = dx * dx + dy * dy;
    if (d > apexDistSq) { apexDistSq = d; apexIdx = i; }
  }
  const apex = pts[apexIdx];
  const outX = apex.x - first.x, outY = apex.y - first.y;
  const backX = last.x - apex.x, backY = last.y - apex.y;
  const outLen = Math.hypot(outX, outY);
  const backLen = Math.hypot(backX, backY);
  if (outLen > 1 && backLen >= outLen * 0.4) {
    const dot = (outX * backX + outY * backY) / (outLen * backLen);
    const foldDeg = (Math.acos(clamp(dot, -1, 1)) * 180) / Math.PI; // 180° = perfect retrace
    const areaRatio = Math.abs(shoelaceArea(pts)) / (pathLen * pathLen);
    if (foldDeg >= WALL_SWOOP_FOLD_MIN_DEG && areaRatio <= WALL_SWOOP_AREA_RATIO_MAX) {
      return { type: 'wallswoop', outX, outY, backX, backY, pts };
    }
  }

  // --- Straight strokes: the simple/safe moves ---
  // Direction is the primary signal; the start-position bands are generous
  // on purpose ("tolerance for imprecise starting points" in the design).
  if (straightness >= GESTURE_STRAIGHTNESS_MIN) {
    // Angle off screen-up: 0° = straight up, ±180° = straight down.
    const angleFromUp = (Math.atan2(netX, -netY) * 180) / Math.PI;
    if (Math.abs(angleFromUp) <= GESTURE_VERTICAL_TOLERANCE_DEG && startHeight <= 0.8) {
      return { type: 'jump', netX, netY, pathLen, pts };
    }
    if (Math.abs(angleFromUp) >= 180 - GESTURE_VERTICAL_TOLERANCE_DEG && startHeight >= 0.2) {
      return { type: 'slide', netX, netY, pathLen, pts };
    }
    // A straight sideways stroke isn't in the spec - fall through and let
    // it be a free-form path (reads as a lateral dodge, which feels like
    // the natural meaning). Judgment call, revisit after device testing.
  }

  // --- Everything else: the drawn shape IS the flight path ---
  return { type: 'freeform', pts, pathLen };
}

// Is there wall/cover within `range` units in this direction? Marches a
// point outward in small steps and checks it against every obstacle's
// bounds (the same precomputed AABBs projectiles use - border walls are in
// that list too). Crude but plenty for "am I next to a wall?".
function findWallInDirection(x, z, dirX, dirZ, range) {
  const margin = 0.5; // roughly the capsule's radius
  for (let d = 0.4; d <= range; d += 0.3) {
    const px = x + dirX * d;
    const pz = z + dirZ * d;
    for (const b of obstacleBounds) {
      if (px >= b.minX - margin && px <= b.maxX + margin &&
          pz >= b.minZ - margin && pz <= b.maxZ + margin) {
        return true;
      }
    }
  }
  return false;
}

// If (x,z) ended up inside an obstacle's footprint (possible when a dash
// arcs OVER a box and lands on/in it), slide the point out along the
// dash's exit direction - try forward first, then backward.
function pushOutOfObstacles(x, z, dirX, dirZ) {
  const margin = 0.45;
  const inside = (px, pz) => obstacleBounds.some((b) =>
    px >= b.minX - margin && px <= b.maxX + margin &&
    pz >= b.minZ - margin && pz <= b.maxZ + margin);
  if (!inside(x, z)) return { x, z };
  for (const sign of [1, -1]) {
    for (let step = 0.3; step <= 3; step += 0.3) {
      const nx = x + dirX * step * sign;
      const nz = z + dirZ * step * sign;
      if (!inside(nx, nz)) return { x: nx, z: nz };
    }
  }
  return { x, z }; // stuck against something odd - collisions kept us out of the solid core anyway
}

// Evenly spaced waypoints along a straight line - used by the canned moves
// (jump-dash, slide-dash, wall-swoop) so every dash type feeds the same
// playback code as the free-form ones.
function straightWaypoints(x, z, dirX, dirZ, distance) {
  const points = [];
  for (let i = 0; i < GESTURE_RESAMPLE_POINTS; i++) {
    const d = (distance * i) / (GESTURE_RESAMPLE_POINTS - 1);
    points.push({ x: x + dirX * d, z: z + dirZ * d });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Dash playback
// ---------------------------------------------------------------------------
// Kicks off a dash: draws its full path as a glowing line in the WORLD
// (this is the "the dash follows your drawn shape" proof, visible from the
// chase camera) and hands the dash to the render loop to step each frame.
function startDash(spec) {
  const linePoints = spec.points.map((p, i) => {
    const s = i / (spec.points.length - 1);
    return new BABYLON.Vector3(p.x, 0.9 + Math.sin(Math.PI * s) * spec.heightPeak, p.z);
  });
  const line = BABYLON.MeshBuilder.CreateLines(`dashpath-${Date.now()}`, { points: linePoints }, scene);
  line.color = BABYLON.Color3.FromHexString(GESTURE_COLORS[spec.type]);
  line.isPickable = false;

  activeDash = { ...spec, elapsed: 0, line };
  showGestureResult(spec.label, GESTURE_COLORS[spec.type]);
  window.__mobileDebug.lastGesture = { type: spec.type, at: performance.now() };
}

// Advances the active dash one frame. Called from the render loop INSTEAD
// of normal stick movement while a dash is playing (the aim stick stays
// live the whole time - that's the point of recorded-then-executed).
function stepActiveDash(deltaSeconds, local) {
  const dash = activeDash;
  dash.elapsed += deltaSeconds;
  const t = Math.min(1, dash.elapsed / dash.duration);
  // Smoothstep easing: gentle speed-up and slow-down, so the dash reads as
  // "a gust of wind carried you", not a teleport with frames in between.
  const s = t * t * (3 - 2 * t);

  // Where along the waypoint list should we be? (Waypoints are evenly
  // spaced, so this is just a fractional index.)
  const fIdx = s * (dash.points.length - 1);
  const i0 = Math.floor(fIdx);
  const i1 = Math.min(dash.points.length - 1, i0 + 1);
  const frac = fIdx - i0;
  let wantX = dash.points[i0].x + (dash.points[i1].x - dash.points[i0].x) * frac;
  let wantZ = dash.points[i0].z + (dash.points[i1].z - dash.points[i0].z) * frac;
  // Never dash out of the map.
  wantX = clamp(wantX, -(MAP_HALF - 1), MAP_HALF - 1);
  wantZ = clamp(wantZ, -(MAP_HALF - 1), MAP_HALF - 1);
  // Height: a sine arc peaking mid-dash (zero for slides).
  const wantY = 0.9 + Math.sin(Math.PI * s) * dash.heightPeak;

  // moveWithCollisions (not a position teleport) so cover boxes and the
  // border still block/deflect a dash instead of being clipped through.
  let stepX = wantX - local.mesh.position.x;
  let stepY = wantY - local.mesh.position.y;
  let stepZ = wantZ - local.mesh.position.z;
  const stepLen = Math.hypot(stepX, stepY, stepZ);
  const maxStep = DASH_CATCHUP_SPEED * deltaSeconds;
  if (stepLen > maxStep && stepLen > 0) {
    const k = maxStep / stepLen;
    stepX *= k;
    stepY *= k;
    stepZ *= k;
  }
  local.mesh.moveWithCollisions(new BABYLON.Vector3(stepX, stepY, stepZ));

  if (t >= 1) endActiveDash(local);
}

function endActiveDash(local) {
  const dash = activeDash;
  activeDash = null;
  lastDashEndedAt = performance.now();

  // Land cleanly: back on the ground, nudged out of any obstacle footprint
  // the arc happened to end on top of.
  const n = dash.points.length;
  let exitX = dash.points[n - 1].x - dash.points[n - 2].x;
  let exitZ = dash.points[n - 1].z - dash.points[n - 2].z;
  const exitLen = Math.hypot(exitX, exitZ);
  if (exitLen > 1e-6) { exitX /= exitLen; exitZ /= exitLen; }
  else { exitX = Math.sin(local.mesh.rotation.y); exitZ = Math.cos(local.mesh.rotation.y); }
  const settled = pushOutOfObstacles(local.mesh.position.x, local.mesh.position.z, exitX, exitZ);
  local.mesh.position.x = settled.x;
  local.mesh.position.z = settled.z;
  local.mesh.position.y = 0.9;

  // The path line lingers briefly so you can compare "what I drew" with
  // "where I went", then cleans itself up.
  if (dash.line) {
    const line = dash.line;
    setTimeout(() => { if (!line.isDisposed()) line.dispose(); }, DASH_PATH_LINGER_MS);
  }
}

// Used by mode teardown - kill an in-flight dash without the landing logic.
function cancelActiveDash() {
  if (!activeDash) return;
  if (activeDash.line && !activeDash.line.isDisposed()) activeDash.line.dispose();
  activeDash = null;
}

// ---------------------------------------------------------------------------
// Turning a classified gesture into an actual dash
// ---------------------------------------------------------------------------
function executeGesture(cls, local) {
  const rect = gestureZoneEl.getBoundingClientRect();
  const unitsPerPx = DASH_WORLD_SCALE / Math.max(1, rect.height);
  const yaw = gestureStartYaw; // locked at gesture start - NOT the current camera
  const px = local.mesh.position.x;
  const pz = local.mesh.position.z;
  const now = performance.now();

  const rejectWith = (reason) => {
    showGestureResult(reason, GESTURE_COLORS.reject);
    flashPadTrace(cls.pts || null, GESTURE_COLORS.reject);
    window.__mobileDebug.lastGesture = { type: 'reject', reason, at: now };
  };

  if (cls.type === 'reject') return rejectWith(cls.reason);
  if (now - lastDashEndedAt < DASH_COOLDOWN_MS) return rejectWith('recovering...');

  if (cls.type === 'wallswoop') {
    // Chain bookkeeping: grounded long enough resets the counter.
    if (now - lastDashEndedAt > WALL_SWOOP_GROUND_RESET_MS) wallSwoopChain = 0;
    if (wallSwoopChain >= WALL_SWOOP_MAX_CHAIN) return rejectWith('touch ground first!');

    // The OUT stroke says where the wall is; the BACK stroke says where
    // you want to be flung. Both resolved against the gesture-start yaw.
    const outWorld = gestureVecToWorld(cls.outX, cls.outY, yaw, 1);
    const outLen = Math.hypot(outWorld.x, outWorld.z) || 1;
    if (!findWallInDirection(px, pz, outWorld.x / outLen, outWorld.z / outLen, WALL_SWOOP_RANGE)) {
      return rejectWith('no wall nearby');
    }
    const backWorld = gestureVecToWorld(cls.backX, cls.backY, yaw, 1);
    const backLen = Math.hypot(backWorld.x, backWorld.z) || 1;
    wallSwoopChain++;
    flashPadTrace(cls.pts, GESTURE_COLORS.wallswoop);
    startDash({
      type: 'wallswoop',
      points: straightWaypoints(px, pz, backWorld.x / backLen, backWorld.z / backLen, WALL_SWOOP_DISTANCE),
      duration: WALL_SWOOP_DURATION_S,
      heightPeak: WALL_SWOOP_HEIGHT,
      label: `wall swoop! (${wallSwoopChain}/${WALL_SWOOP_MAX_CHAIN})`,
    });
    return;
  }

  if (cls.type === 'jump' || cls.type === 'slide') {
    // Jump: the stroke's own (up-ish) direction maps straight to world -
    // up = forward, so a slight lean steers the leap.
    // Slide: the design is explicit that straight-down is a FORWARD slide,
    // so the down-stroke's magnitude is flipped into forward motion
    // (passing -|netY| makes gestureVecToWorld's "up" positive) while any
    // lateral lean still steers, same as the jump.
    const v = cls.type === 'jump'
      ? gestureVecToWorld(cls.netX, cls.netY, yaw, 1)
      : gestureVecToWorld(cls.netX, -Math.abs(cls.netY), yaw, 1);
    const vLen = Math.hypot(v.x, v.z) || 1;
    const dist = clamp(cls.pathLen * unitsPerPx, DASH_MIN_WORLD_LEN, DASH_MAX_WORLD_LEN);
    flashPadTrace(cls.pts, GESTURE_COLORS[cls.type]);
    startDash({
      type: cls.type,
      points: straightWaypoints(px, pz, v.x / vLen, v.z / vLen, dist),
      duration: clamp(dist / DASH_SPEED, DASH_MIN_DURATION_S, DASH_MAX_DURATION_S),
      heightPeak: cls.type === 'jump' ? JUMP_DASH_HEIGHT : 0,
      label: cls.type === 'jump' ? 'jump-dash!' : 'slide-dash!',
    });
    return;
  }

  // Free-form: every resampled point of the drawn shape becomes a world
  // waypoint (relative to where the stroke began), so the character flies
  // the actual curve - including curves that end up BEHIND the start,
  // which is the designed way to dash backward.
  const origin = cls.pts[0];
  const offsets = cls.pts.map((p) => gestureVecToWorld(p.x - origin.x, p.y - origin.y, yaw, unitsPerPx));
  let worldLen = 0;
  for (let i = 1; i < offsets.length; i++) {
    worldLen += Math.hypot(offsets[i].x - offsets[i - 1].x, offsets[i].z - offsets[i - 1].z);
  }
  if (worldLen < 0.2) return rejectWith('draw a bigger shape');
  let scale = 1;
  if (worldLen > DASH_MAX_WORLD_LEN) scale = DASH_MAX_WORLD_LEN / worldLen;
  else if (worldLen < DASH_MIN_WORLD_LEN) scale = DASH_MIN_WORLD_LEN / worldLen;
  flashPadTrace(cls.pts, GESTURE_COLORS.freeform);
  startDash({
    type: 'freeform',
    points: offsets.map((o) => ({ x: px + o.x * scale, z: pz + o.z * scale })),
    duration: clamp((worldLen * scale) / DASH_SPEED, DASH_MIN_DURATION_S, DASH_MAX_DURATION_S),
    heightPeak: FREEFORM_HOP_HEIGHT, // low "carried by the wind" hop; the shape lives in the ground plane
    label: 'swoop dash!',
  });
}

// --- Gesture pad pointer handlers ---
function zoneLocalPoint(e) {
  const rect = gestureZoneEl.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

gestureZoneEl.addEventListener('pointerdown', (e) => {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch-dual') return;
  if (gesturePointerId !== null) return; // one drawing finger at a time
  const local = playerAvatars[localPlayerId];
  if (!local) return;
  if (activeDash) {
    showGestureResult('still dashing...', GESTURE_COLORS.reject);
    return;
  }
  gesturePointerId = e.pointerId;
  // Capture the pointer so the trace survives the finger drifting outside
  // the pad's edges mid-shape (more of the design's tolerance). Synthetic
  // pointers (automated tests) can't be captured - that's fine.
  try { gestureZoneEl.setPointerCapture(e.pointerId); } catch (_) {}
  gestureStartYaw = local.mesh.rotation.y; // <-- the camera lock, right here
  if (gestureFadeTimeoutId) { clearTimeout(gestureFadeTimeoutId); gestureFadeTimeoutId = null; }
  gesturePoints = [zoneLocalPoint(e)];
  drawPadTrace(gesturePoints, GESTURE_COLORS.draw);
});

gestureZoneEl.addEventListener('pointermove', (e) => {
  if (e.pointerId !== gesturePointerId) return;
  const p = zoneLocalPoint(e);
  const prev = gesturePoints[gesturePoints.length - 1];
  if (Math.hypot(p.x - prev.x, p.y - prev.y) < 2) return; // skip micro-jitter
  gesturePoints.push(p);
  drawPadTrace(gesturePoints, GESTURE_COLORS.draw);
});

gestureZoneEl.addEventListener('pointerup', (e) => {
  if (e.pointerId !== gesturePointerId) return;
  gesturePointerId = null;
  const rect = gestureZoneEl.getBoundingClientRect();
  const points = gesturePoints;
  gesturePoints = [];
  const local = playerAvatars[localPlayerId];
  if (!local) { clearGestureCanvas(); return; }
  // THE moment the whole mechanic revolves around: finger up -> classify
  // the recorded shape -> play it back as one motion.
  executeGesture(classifyGesture(points, Math.max(1, rect.height)), local);
});

gestureZoneEl.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== gesturePointerId) return;
  // The browser stole the pointer (notification shade, etc.) - abort quietly.
  gesturePointerId = null;
  gesturePoints = [];
  clearGestureCanvas();
});

// --- Debug/testing hook ---
// Lets automated checks (and curious humans in devtools) read the control
// state without poking at internals. Not used by gameplay.
window.__mobileDebug = {
  lastGesture: null,
  get pos() {
    const a = playerAvatars[localPlayerId];
    return a ? {
      x: a.mesh.position.x, y: a.mesh.position.y, z: a.mesh.position.z,
      yaw: a.mesh.rotation.y,
    } : null;
  },
  get dash() {
    return activeDash
      ? { type: activeDash.type, elapsed: activeDash.elapsed, duration: activeDash.duration }
      : null;
  },
  get wallSwoopChain() { return wallSwoopChain; },
};

// ----------------------------------------------------------------------------
// NETWORKING (Socket.io) - connected once a mode is chosen, in startGame()
// ----------------------------------------------------------------------------
let socket = null;

function connectToServer() {
  // forceNew matters here: socket.io reuses its underlying connection
  // manager across io() calls by default, which would silently keep the
  // FIRST connection's handshake query (our minionsOnly flag below)
  // forever - even after switching to a different mode. A fresh manager
  // per connection keeps the flag accurate for whichever mode this is.
  socket = io({
    forceNew: true,
    // Tells the server up-front whether we're an "avatarless" player
    // (Swarm Command - no walking body, just minions) and which team we
    // asked for, so both are settled before anyone tries to render us.
    query: {
      minionsOnly: MODE_CONFIG[currentMode].minionsOnly ? '1' : '0',
      team: selectedTeam,
    },
  });

  // The server sends this once, right after we connect: our own id plus
  // the full list of players already in the game (so we can catch up).
  socket.on('init', (data) => {
    localPlayerId = data.id;

    const cfg = MODE_CONFIG[currentMode];
    const myData = data.players[localPlayerId];
    localSpawnPoint = { x: myData.x, z: myData.z };
    localTeam = myData.team || null;

    Object.entries(data.players).forEach(([id, playerData]) => {
      // Swarm Command players have no body - nothing to render for them
      // (their minions arrive separately via minionsUpdate broadcasts).
      if (playerData.avatarless) return;
      addPlayer(id, playerData);
    });

    if (cfg.hasMinions) {
      const count = cfg.minionsOnly ? SWARM_MINION_COUNT : MINION_COUNT;
      const scale = cfg.minionsOnly ? SWARM_MINION_SCALE : MINION_SCALE;
      spawnMinions(count, myData.color, myData.x, myData.z, scale);
    }

    if (cfg.minionsOnly) {
      // Free camera starts centered on our swarm's spawn cluster.
      camera.target.x = myData.x;
      camera.target.z = myData.z;
    }

    setHud(`${MODE_CONFIG[currentMode].label} | Team ${(localTeam || '?').toUpperCase()} | Players: ${Object.keys(playerAvatars).length}`);
  });

  // A new player joined after us.
  socket.on('playerJoined', (data) => {
    if (!data.player.avatarless) addPlayer(data.id, data.player);
    setHud(`${MODE_CONFIG[currentMode].label} | Connected as ${localPlayerId.slice(0, 6)} | Players: ${Object.keys(playerAvatars).length}`);
  });

  // Someone else moved. We just update their "target" position - the
  // render loop below smoothly glides their capsule toward it, instead of
  // snapping instantly, so movement looks fluid even though updates only
  // arrive ~20 times/sec.
  socket.on('playerMoved', (data) => {
    const avatar = playerAvatars[data.id];
    if (!avatar) return;
    avatar.targetX = data.x;
    avatar.targetY = typeof data.y === 'number' ? data.y : 0.9; // dash height (0.9 = grounded)
    avatar.targetZ = data.z;
    avatar.mesh.rotation.y = data.rotationY;
  });

  socket.on('playerLeft', (data) => {
    removePlayer(data.id);
    // Also clear any minions they owned - without this, a disconnecting
    // player's squad would linger frozen on everyone's screen forever.
    removeRemoteMinions(data.id);
    setHud(`${MODE_CONFIG[currentMode].label} | Connected as ${localPlayerId ? localPlayerId.slice(0, 6) : '?'} | Players: ${Object.keys(playerAvatars).length}`);
  });

  // Someone (possibly us) fired a shot. We spawn our OWN projectile the
  // instant we click/tap, for zero-latency feedback, so we skip it here to
  // avoid spawning a duplicate when the server's broadcast comes back.
  socket.on('projectileFired', (data) => {
    if (data.ownerId === localPlayerId) return;
    spawnProjectile(data);
  });

  // The server confirmed a hit - flash that player, whether it's us,
  // the shooter, or a bystander watching. Every browser runs this same
  // reaction, so everyone sees hits consistently. We also record the
  // server-authoritative health and refresh the right health display
  // (corner HUD for ourselves, floating bar for anyone else).
  socket.on('playerHit', (data) => {
    const avatar = playerAvatars[data.id];
    if (avatar) {
      avatar.health = data.health;
      updateHealthBarVisual(avatar);
    }
    if (data.id === localPlayerId) updateHudHealth(data.health);
    triggerHitFlash(data.id);
  });

  // The server says this player's health hit 0. Every client (including
  // bystanders) hides that player's body AND their minions until they
  // respawn. If it's US, we freeze our own input/movement (see below)
  // and show the death screen with a short respawn countdown.
  socket.on('playerDied', (data) => {
    const avatar = playerAvatars[data.id];
    if (avatar) {
      avatar.alive = false;
      avatar.mesh.isVisible = false;
      // Hide everything attached too: gun, barrel, reticle, health bar
      avatar.mesh.getChildMeshes().forEach((m) => { m.isVisible = false; });
    }

    if (data.id === localPlayerId) {
      // Our own minions die with us; fresh ones spawn on respawn.
      hideLocalMinions();

      // Setting currentMode to null is enough to freeze everything -
      // the render loop's very first line (`if (!currentMode) return;`)
      // skips ALL per-frame input/movement/network-send logic, so the
      // camera just stays exactly where it was at the moment of death.
      // We deliberately do NOT tear down the camera/socket/avatars here
      // (that's leaveCurrentMode's job) - this is a lightweight freeze,
      // not a full exit; the real cleanup happens when the player picks
      // a mode on the death screen and startGame() runs again.
      currentMode = null;
      showRespawnScreen();
    } else {
      // A remote player died - their squad disappears with them. (When
      // they respawn they'll be a brand-new connection broadcasting fresh
      // minionsUpdate packets, which recreates their squad meshes.)
      removeRemoteMinions(data.id);
    }
  });

  // Another player's minion squad state: positions + alive flags, sent
  // ~10x/sec by each owning client and relayed to us by the server. We
  // render these as small capsules and glide them toward their latest
  // reported positions in the render loop (same trick as remote players).
  socket.on('minionsUpdate', (data) => {
    if (data.id === localPlayerId) return; // safety - shouldn't happen (server broadcasts to others only)

    let rm = remoteMinions[data.id];
    if (!rm) {
      rm = remoteMinions[data.id] = { color: data.color, team: data.team || null, minions: [] };
    }

    data.minions.forEach((mm, idx) => {
      const entry = ensureRemoteMinion(rm, idx, mm.x, mm.z);
      entry.targetX = mm.x;
      entry.targetZ = mm.z;
      if (entry.alive !== mm.alive) {
        entry.alive = mm.alive;
        entry.mesh.setEnabled(mm.alive);
      }
    });
  });

  // A minion somewhere got shot. Two very different jobs depending on
  // whose minion it is:
  //   - OURS: we're the authority for our own minions' health, so apply
  //     the damage for real (and kill it at 0 - everyone else finds out
  //     via our next minionsUpdate broadcast).
  //   - Someone else's: purely cosmetic white flash; its real state
  //     arrives from its owner.
  socket.on('minionHit', (data) => {
    if (data.ownerId === localPlayerId) {
      const minion = minions[data.minionIndex];
      if (!minion || !minion.alive) return;
      minion.health -= typeof data.damage === 'number' ? data.damage : PLAYER_PROJECTILE_DAMAGE;
      flashMeshWhite(minion.mesh, minion.colorHex, minion);
      if (minion.health <= 0) killMinion(minion);
    } else {
      const rm = remoteMinions[data.ownerId];
      const m = rm && rm.minions[data.minionIndex];
      if (m && m.alive) flashMeshWhite(m.mesh, rm.color, m);
    }
  });
}

// Only send an update to the server when our position actually changed,
// and no more often than NETWORK_SEND_INTERVAL_MS.
let lastSentX = null;
let lastSentY = null;
let lastSentZ = null;
let lastSentRotation = null;
let msSinceLastSend = 0;

function maybeSendPositionToServer(deltaMs) {
  msSinceLastSend += deltaMs;
  if (msSinceLastSend < NETWORK_SEND_INTERVAL_MS) return;
  msSinceLastSend = 0;

  const local = playerAvatars[localPlayerId];
  if (!local) return;

  const { x, y, z } = local.mesh.position;
  const rotationY = local.mesh.rotation.y;

  const moved = x !== lastSentX || y !== lastSentY || z !== lastSentZ || rotationY !== lastSentRotation;
  if (!moved) return;

  lastSentX = x;
  lastSentY = y;
  lastSentZ = z;
  lastSentRotation = rotationY;
  socket.emit('move', { x, y, z, rotationY });
}

// ----------------------------------------------------------------------------
// COMBAT: SHOOTING AND HIT REACTIONS
// ----------------------------------------------------------------------------
// All projectiles currently in flight, from any player.
// Each entry: { mesh, ownerId, dirX, dirZ, distanceTraveled }
const activeProjectiles = [];

function spawnProjectile({ ownerId, x, y, z, dirX, dirZ, color }) {
  // A stretched thin "bolt" instead of a ball - an elongated shape reads
  // its direction of travel at a glance, which a sphere can't.
  const mesh = BABYLON.MeshBuilder.CreateCylinder(
    `projectile-${ownerId}-${Date.now()}-${Math.random()}`,
    { diameterTop: 0.12, diameterBottom: 0.12, height: 0.6 },
    scene
  );
  mesh.position.set(x, y, z);
  // Cylinders are built standing up (+Y). Lay it flat, then point it down
  // its flight path - projectiles fly straight, so this is a one-time
  // orientation at spawn, not per-frame work.
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.y = Math.atan2(dirX, dirZ);

  const material = new BABYLON.StandardMaterial('projectileMat', scene);
  material.diffuseColor = BABYLON.Color3.FromHexString(color);
  material.emissiveColor = BABYLON.Color3.FromHexString(color); // glows, so it reads clearly in flight
  mesh.material = material;

  activeProjectiles.push({
    mesh,
    ownerId,
    dirX,
    dirZ,
    distanceTraveled: 0,
    // Shots PIERCE players/minions (only walls and max range stop them),
    // so each projectile remembers who it already damaged - otherwise a
    // bolt overlapping someone for several frames would hit them once per
    // frame. This also fixes an old visual desync: previously the shot
    // vanished on the shooter's screen when it hit, but kept flying on
    // everyone else's.
    hitTargets: new Set(),
  });
}

let lastFireTime = 0;

function tryFireProjectile() {
  const local = playerAvatars[localPlayerId];
  if (!local) return;

  const now = performance.now();
  if (now - lastFireTime < FIRE_COOLDOWN_MS) return; // still on cooldown
  lastFireTime = now;

  // Fire in the direction the capsule is currently facing (set every
  // frame by whichever aiming scheme the current mode uses).
  const rotationY = local.mesh.rotation.y;
  const dirX = Math.sin(rotationY);
  const dirZ = Math.cos(rotationY);

  // Spawn slightly in front of the player (at the nose) so the
  // projectile doesn't visually start out inside their own capsule.
  // Height rides with the capsule (0.9 + 0.1 = the old fixed 1.0 while
  // grounded) so shots fired mid-dash appear at the player, not at their
  // feet's shadow. Hit checks are 2D (x/z), so height stays cosmetic.
  const spawnOffset = 0.7;
  const shotData = {
    ownerId: localPlayerId,
    x: local.mesh.position.x + dirX * spawnOffset,
    y: local.mesh.position.y + 0.1,
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

    // Obstacles and border walls stop shots dead - checked FIRST (and on
    // every client identically, since this is static shared geometry with
    // no desync risk), so a shot that reaches a wall the same frame it
    // would have reached a player behind it correctly stops at the wall.
    if (!shouldRemove) {
      const px = proj.mesh.position.x;
      const pz = proj.mesh.position.z;
      for (const b of obstacleBounds) {
        if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) {
          shouldRemove = true;
          break;
        }
      }
    }

    // Combatant hits: shots PIERCE through players and minions (each
    // unique target damaged once, tracked in proj.hitTargets) rather than
    // stopping - only walls and max range remove a projectile. Every
    // client now sees the same bolt fly the same path.
    if (!shouldRemove && proj.ownerId === localPlayerId) {
      for (const [id, avatar] of Object.entries(playerAvatars)) {
        if (id === localPlayerId) continue; // can't hit yourself
        if (!avatar.alive) continue; // dead players aren't valid targets
        if (localTeam && avatar.team === localTeam) continue; // no friendly fire (server enforces this too)
        if (proj.hitTargets.has(id)) continue; // already damaged by this bolt

        const dx = avatar.mesh.position.x - proj.mesh.position.x;
        const dz = avatar.mesh.position.z - proj.mesh.position.z;
        if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) {
          proj.hitTargets.add(id);
          socket.emit('hit', { targetId: id, damage: PLAYER_PROJECTILE_DAMAGE });
          triggerHitMarker();
        }
      }

      // Other players' minions are shootable too - same reach as players.
      // (Our OWN minions and teammates' minions are ignored: friendly
      // fire off, matching how we can't hit ourselves above.)
      for (const [ownerId, rm] of Object.entries(remoteMinions)) {
        if (localTeam && rm.team === localTeam) continue;
        for (let mi = 0; mi < rm.minions.length; mi++) {
          const m = rm.minions[mi];
          if (!m || !m.alive) continue;
          const key = `minion:${ownerId}:${mi}`;
          if (proj.hitTargets.has(key)) continue;

          const dx = m.mesh.position.x - proj.mesh.position.x;
          const dz = m.mesh.position.z - proj.mesh.position.z;
          if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) {
            proj.hitTargets.add(key);
            socket.emit('minionHit', { ownerId, minionIndex: mi, damage: PLAYER_PROJECTILE_DAMAGE });
            triggerHitMarker();
          }
        }
      }
    }

    if (shouldRemove) {
      proj.mesh.dispose();
      activeProjectiles.splice(i, 1);
    }
  }
}

// Flashes the edges of the SHOOTER's own screen when one of their shots
// (or their minions' zaps) lands - immediate "I hit something" feedback
// regardless of camera angle or distance. Purely local: this runs at the
// exact spot our own hit-detection succeeds, so no networking involved.
let hitMarkerTimeoutId = null;
function triggerHitMarker() {
  const el = document.getElementById('hitMarker');
  if (!el) return;
  if (hitMarkerTimeoutId) clearTimeout(hitMarkerTimeoutId);
  el.classList.add('active');
  hitMarkerTimeoutId = setTimeout(() => {
    el.classList.remove('active');
    hitMarkerTimeoutId = null;
  }, HIT_MARKER_DURATION_MS);
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
// It's a no-op until a mode has been picked and startGame() has run.
scene.onBeforeRenderObservable.add(() => {
  if (!currentMode) return;

  const deltaMs = engine.getDeltaTime();
  const deltaSeconds = deltaMs / 1000;
  const inputType = MODE_CONFIG[currentMode].inputType;
  const cameraType = MODE_CONFIG[currentMode].cameraType;

  const local = playerAvatars[localPlayerId];
  if (local) {
    // --- Gather movement input from whichever source this mode uses ---
    let moveX = 0;
    let moveZ = 0;

    if (inputType === 'keyboard-mouse') {
      // W/S are tied to +Z/-Z because forward/backward should mean
      // "toward/away from whatever I'm facing or looking at" - getting
      // this backwards is a subtle bug: movement still works, but pressing
      // "forward" would walk you the wrong way, which feels broken even
      // though nothing throws an error.
      if (keysDown['w']) moveZ += 1;
      if (keysDown['s']) moveZ -= 1;
      if (keysDown['a']) moveX -= 1;
      if (keysDown['d']) moveX += 1;
    } else if (inputType === 'gamepad') {
      const gp = readGamepadState();
      moveX = gp.moveX;
      moveZ = gp.moveZ;
      if (gp.hasAimInput) {
        // Glide toward the stick's angle instead of snapping instantly -
        // this smoothing is also what gives the sensitivity slider
        // something real to scale on Console (an instant snap has no
        // "speed" to adjust). Shortest-path wrap so aiming across the
        // -PI/PI seam doesn't spin the long way around.
        const targetYaw = Math.atan2(gp.aimX, gp.aimY);
        let aimDelta = targetYaw - gamepadAimYaw;
        aimDelta = Math.atan2(Math.sin(aimDelta), Math.cos(aimDelta));
        gamepadAimYaw += aimDelta * Math.min(1, GAMEPAD_AIM_LERP_SPEED * sensitivityMultiplier * deltaSeconds);
      }
      if (gp.firePressed && !gamepadFireWasHeld) tryFireProjectile();
      gamepadFireWasHeld = gp.firePressed;

      // Friendly feedback instead of a mysteriously frozen game when no
      // controller is paired (the most likely story behind "console mode
      // doesn't work on my phone"). Derived fresh each frame, so it
      // appears after the grace period and clears itself the moment a
      // pad shows up.
      if (!gp.connected && performance.now() - consoleModeEnteredAt > GAMEPAD_GRACE_PERIOD_MS) {
        setHudWarning('NO CONTROLLER - pair one in Bluetooth settings, then press any button on it');
      } else {
        setHudWarning(null);
      }
    } else if (inputType === 'touch') {
      moveX = touchMoveX;
      moveZ = touchMoveZ;
    } else if (inputType === 'touch-dual') {
      moveX = dualMoveX;
      moveZ = dualMoveZ;
      // Hold-to-autofire on the placeholder fire button; the cooldown
      // inside tryFireProjectile is what actually limits the rate.
      if (fireHeld) tryFireProjectile();
    }

    // Movement space depends on the camera:
    //   - First-person AND chase cameras rotate with your facing, so
    //     "forward" must mean "the way I'm looking" - world-space input
    //     under a rotating camera feels completely broken (pressing
    //     forward would walk you sideways across the screen).
    //   - Fixed-angle cameras (top-down Squad) keep world-space compass
    //     movement: the screen never rotates, so up-on-the-stick = up-on-
    //     the-screen already holds without any transform.
    if (activeDash && inputType === 'touch-dual') {
      // A recorded dash is playing back: it owns movement this frame.
      // Stick movement is ignored until it lands, but aiming (below) and
      // firing stay live - being able to track a target WHILE the dash
      // animates is the whole point of recorded-then-executed gestures.
      stepActiveDash(deltaSeconds, local);
    } else if (moveX !== 0 || moveZ !== 0) {
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      const normX = moveX / length;
      const normZ = moveZ / length;

      let worldMoveX = normX;
      let worldMoveZ = normZ;
      if (cameraType === 'first-person' || cameraType === 'third-person-chase') {
        const yaw = local.mesh.rotation.y;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        worldMoveX = normX * cos + normZ * sin;
        worldMoveZ = -normX * sin + normZ * cos;
      }

      // moveWithCollisions instead of directly mutating position: Babylon
      // sweeps the capsule's ellipsoid against every checkCollisions mesh
      // (obstacles + border walls) and SLIDES along surfaces rather than
      // hard-stopping, which is what makes hugging cover feel natural.
      // The Y component stays 0 - flat ground, no gravity in this game.
      local.mesh.moveWithCollisions(new BABYLON.Vector3(
        worldMoveX * MOVE_SPEED * deltaSeconds,
        0,
        worldMoveZ * MOVE_SPEED * deltaSeconds
      ));
    }

    // --- Aiming: apply whichever yaw source this mode uses ---
    if (inputType === 'keyboard-mouse') {
      local.mesh.rotation.y = pcAimYaw;
    } else if (inputType === 'gamepad') {
      local.mesh.rotation.y = gamepadAimYaw;
    } else if (inputType === 'touch-dual') {
      // Right stick: horizontal deflection = turn RATE, integrated into
      // yaw each frame (push further = turn faster). Sensitivity slider
      // applies, same as every other look input. Works mid-dash too.
      touchAimYaw += dualTurnX * DUAL_TURN_MAX_RATE * sensitivityMultiplier * deltaSeconds;
      local.mesh.rotation.y = touchAimYaw;
    } else if (inputType === 'touch') {
      if (currentMode === 'mobile-squad') {
        // Squad's facing is driven ONLY by the aim stick's touch handler -
        // stomping it every frame here would yank the nose back the moment
        // the stick was released. Idle facing just holds its last value.
      } else if (MOBILE_TURN_SCHEME === 'turn-joystick') {
        // Turn stick: integrate the held deflection into yaw over time
        // (this is what makes "push further = turn faster" work).
        touchAimYaw += turnJoystickX * TURN_JOYSTICK_MAX_RATE * sensitivityMultiplier * deltaSeconds;
        local.mesh.rotation.y = touchAimYaw;
      } else {
        local.mesh.rotation.y = touchAimYaw; // drag-look: 1:1 accumulated drag
      }
    }

    // --- Camera follows the local player, per its type ---
    if (cameraType === 'first-person') {
      // 1:1, no smoothing - any lag in a first-person view is disorienting
      // (it's supposed to feel like your own head, not a drone following
      // you).
      camera.position.x = local.mesh.position.x;
      camera.position.y = local.mesh.position.y - 0.9 + EYE_HEIGHT; // relative to feet, not capsule center
      camera.position.z = local.mesh.position.z;
      camera.rotation.y = local.mesh.rotation.y;
    } else {
      // Both third-person variants and the top-down camera share the same
      // position-follow behavior (glide the ORBIT TARGET toward the
      // player, not the camera itself, since these are all ArcRotateCameras).
      const lerpFactor = Math.min(1, CAMERA_LERP_SPEED * deltaSeconds);
      camera.target.x += (local.mesh.position.x - camera.target.x) * lerpFactor;
      camera.target.z += (local.mesh.position.z - camera.target.z) * lerpFactor;

      if (cameraType === 'third-person-chase') {
        // Unlike the fixed twin-stick camera, this one also rotates to
        // stay behind the player's back as they turn - matches the
        // touch-drag-to-turn control scheme, where the character's facing
        // IS the look direction, so the camera should follow it the way an
        // over-the-shoulder camera would.
        const targetAlpha = -local.mesh.rotation.y - Math.PI / 2;
        const rotLerpFactor = Math.min(1, CAMERA_ROTATE_LERP_SPEED * deltaSeconds);
        // Shortest-path angle interpolation, so the camera doesn't spin
        // the "long way around" when crossing the -PI/PI wraparound point.
        let delta = targetAlpha - camera.alpha;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        camera.alpha += delta * rotLerpFactor;
      }
    }

    maybeSendPositionToServer(deltaMs);
  }

  // Minions run OUTSIDE the `if (local)` block deliberately: Swarm
  // Command has no local avatar at all (local is undefined), but its
  // minions still need to move, attack, and broadcast every frame.
  if (MODE_CONFIG[currentMode].hasMinions) {
    updateMinions(deltaSeconds);
    maybeSendMinionsToServer(deltaMs);
  }

  updateProjectiles(deltaSeconds);

  // --- Glide remote players toward their latest known position ---
  Object.entries(playerAvatars).forEach(([id, avatar]) => {
    if (id === localPlayerId) return;
    const lerpFactor = Math.min(1, REMOTE_LERP_SPEED * deltaSeconds);
    avatar.mesh.position.x += (avatar.targetX - avatar.mesh.position.x) * lerpFactor;
    avatar.mesh.position.y += (avatar.targetY - avatar.mesh.position.y) * lerpFactor; // dash arcs
    avatar.mesh.position.z += (avatar.targetZ - avatar.mesh.position.z) * lerpFactor;
  });

  // --- Glide other players' minions the same way ---
  Object.values(remoteMinions).forEach((rm) => {
    rm.minions.forEach((m) => {
      if (!m || !m.alive) return;
      const lf = Math.min(1, REMOTE_LERP_SPEED * deltaSeconds);
      m.mesh.position.x += (m.targetX - m.mesh.position.x) * lf;
      m.mesh.position.z += (m.targetZ - m.mesh.position.z) * lf;
    });
  });
});

// Start rendering, and keep the canvas sized to the window.
// Guarded on `camera` because this loop starts immediately at page load,
// before the player has picked a mode on the join screen - calling
// scene.render() with no active camera throws ("No camera defined"), and
// an uncaught exception inside this callback stops requestAnimationFrame
// from ever rescheduling the next frame, permanently killing the render
// loop even after a camera is created later. Skipping the render (instead
// of letting it throw) until startGame() has run avoids that entirely.
engine.runRenderLoop(() => {
  if (!camera) return;
  scene.render();
});
window.addEventListener('resize', () => {
  engine.resize();
});

// ----------------------------------------------------------------------------
// LEAVING A MODE (shared by respawn-after-death now, and by the in-game
// menu's mode-switch feature later)
// ----------------------------------------------------------------------------
// Tears down everything the CURRENT mode set up, so startGame() can safely
// run again from a clean slate. Safe to call even when nothing is active
// yet (e.g. the very first time startGame() runs at page load) - every
// step below is a harmless no-op if there's nothing to tear down.
let respawnCountdownIntervalId = null;

function leaveCurrentMode() {
  // --- Networking ---
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  // --- Avatars (local + remote) ---
  // Clear any in-flight hit-flash timers before disposing - otherwise a
  // timer could fire later and try to touch a material on an already-
  // disposed mesh.
  Object.values(playerAvatars).forEach((avatar) => {
    if (avatar.flashTimeoutId) clearTimeout(avatar.flashTimeoutId);
    avatar.mesh.dispose(); // also disposes the parented nose mesh
  });
  Object.keys(playerAvatars).forEach((id) => delete playerAvatars[id]);
  localPlayerId = null;

  // --- Minions (ours, everyone else's, and any in-flight zap tracers) ---
  hideLocalMinions();
  disposeAllRemoteMinions();
  currentMinionTarget = null;
  msSinceMinionScan = 0;
  msSinceMinionSend = 0;
  activeZaps.forEach((line) => {
    if (!line.isDisposed()) line.dispose();
  });
  activeZaps.length = 0;

  // --- Swarm touch state ---
  swarmPointers.clear();
  swarmPinchPrevDist = null;
  swarmTapCandidate = null;

  // --- Projectiles in flight ---
  activeProjectiles.forEach((proj) => proj.mesh.dispose());
  activeProjectiles.length = 0;

  // --- Camera ---
  // Setting this to null is critical: the render loop's own
  // `if (!camera) return;` guard (see engine.runRenderLoop below) depends
  // on it staying accurate whenever there isn't a live mode running -
  // without this, scene.render() would throw "No camera defined" the
  // instant a frame ticks after this teardown.
  if (camera) {
    camera.dispose();
    camera = null;
  }

  // --- Per-mode input state ---
  touchMoveX = 0;
  touchMoveZ = 0;
  pcAimYaw = 0;
  gamepadAimYaw = 0;
  touchAimYaw = 0;
  moveTouchId = null;
  lookTouchId = null;
  aimTouchId = null;
  turnTouchId = null;
  turnJoystickX = 0;
  gamepadFireWasHeld = false;

  // --- Mobile dual-stick / gesture-pad state ---
  dualMoveTouchId = null;
  dualMoveX = 0;
  dualMoveZ = 0;
  dualAimTouchId = null;
  dualTurnX = 0;
  fireHeld = false;
  gesturePointerId = null;
  gesturePoints = [];
  cancelActiveDash();
  wallSwoopChain = 0;
  lastDashEndedAt = 0;
  if (gestureFadeTimeoutId) { clearTimeout(gestureFadeTimeoutId); gestureFadeTimeoutId = null; }
  if (gestureResultTimeoutId) { clearTimeout(gestureResultTimeoutId); gestureResultTimeoutId = null; }
  clearGestureCanvas();
  gestureResultLabelEl.textContent = '';

  // --- Touch UI + per-mode HUD elements ---
  joystickBaseEl.style.display = 'none';
  hideAimJoystick();
  touchHintEl.style.display = 'none';
  gestureZoneEl.style.display = 'none';
  fireButtonEl.style.display = 'none';
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('hudHealthBar').style.display = 'none';
  document.getElementById('inGameMenu').style.display = 'none';
  document.getElementById('orientationLockOverlay').classList.remove('mobile-active');

  // --- Network send throttle ---
  lastSentX = null;
  lastSentY = null;
  lastSentZ = null;
  lastSentRotation = null;
  msSinceLastSend = 0;

  // --- Respawn-screen state, in case we're leaving mid-countdown ---
  if (respawnCountdownIntervalId) {
    clearInterval(respawnCountdownIntervalId);
    respawnCountdownIntervalId = null;
  }
  document.querySelectorAll('.join-btn').forEach((btn) => btn.classList.remove('disabled'));
  respawnCountdownEl.style.display = 'none';

  currentMode = null;
}

// Shows the join screen in "you died" mode: buttons disabled with a live
// countdown, becoming clickable once RESPAWN_COOLDOWN_MS has passed.
// Clicking a mode button afterward just calls startGame() exactly like a
// fresh join - a respawn IS a fresh join under the hood (see
// leaveCurrentMode's networking teardown above and server/index.js's
// connection handler, which always hands out full health).
function showRespawnScreen() {
  document.getElementById('joinScreen').style.display = 'flex';
  document.querySelectorAll('.join-btn').forEach((btn) => btn.classList.add('disabled'));
  respawnCountdownEl.style.display = 'block';

  let remainingMs = RESPAWN_COOLDOWN_MS;
  const updateCountdownText = () => {
    respawnCountdownEl.textContent = `Respawn available in ${Math.ceil(remainingMs / 1000)}...`;
  };
  updateCountdownText();

  respawnCountdownIntervalId = setInterval(() => {
    remainingMs -= 250;
    if (remainingMs <= 0) {
      clearInterval(respawnCountdownIntervalId);
      respawnCountdownIntervalId = null;
      respawnCountdownEl.textContent = 'Ready!';
      document.querySelectorAll('.join-btn').forEach((btn) => btn.classList.remove('disabled'));
    } else {
      updateCountdownText();
    }
  }, 250);
}

// ----------------------------------------------------------------------------
// JOIN SCREEN
// ----------------------------------------------------------------------------
// Wires up the join buttons in index.html. Picking a mode is what actually
// (re)starts the game - nothing above this point creates a camera, spawns
// a player, or connects to the server on its own; it only sets up scenery
// and input listeners that stay dormant (checking currentMode) until this
// runs. Safely re-entrant: this same function handles the very first join,
// every respawn after death, and (later) mode-switching from the in-game
// menu, since it always tears down cleanly first.
function startGame(mode) {
  leaveCurrentMode(); // safe no-op on the very first call, when nothing exists yet

  currentMode = mode;

  document.getElementById('joinScreen').style.display = 'none';
  respawnCountdownEl.style.display = 'none';
  if (MODE_CONFIG[mode].inputType === 'touch-dual') {
    // The current mobile design: both sticks + the gesture pad + the
    // placeholder fire button all come up together.
    touchHintEl.innerHTML = 'left: move &nbsp;|&nbsp; right: aim &nbsp;|&nbsp; &#128293;: fire<br/>draw a shape in the pad to dash';
    touchHintEl.style.display = 'block';
    gestureZoneEl.style.display = 'block';
    fireButtonEl.style.display = 'block';
    syncGestureCanvasSize(); // the pad only has a real size once visible
  } else if (MODE_CONFIG[mode].inputType === 'touch') {
    if (mode === 'mobile-squad') {
      touchHintEl.innerHTML = 'right stick: aim<br/>release to fire';
    } else if (MOBILE_TURN_SCHEME === 'turn-joystick') {
      touchHintEl.innerHTML = 'right stick: push to turn<br/>release to fire';
    } else {
      touchHintEl.innerHTML = 'drag right side to look<br/>tap right side to fire';
    }
    touchHintEl.style.display = 'block';
  } else if (MODE_CONFIG[mode].inputType === 'touch-swarm') {
    touchHintEl.innerHTML = 'tap: move swarm &nbsp;|&nbsp; drag: pan &nbsp;|&nbsp; pinch: zoom';
    touchHintEl.style.display = 'block';
  }

  // Crosshair for every mode where your facing IS your fire direction and
  // the camera looks along it (PC, Console, Solo FPS, Solo TPS). Top-down
  // modes aim with sticks/taps instead - they get ground reticles, not a
  // screen-center dot that would point at nothing meaningful.
  const ct = MODE_CONFIG[mode].cameraType;
  document.getElementById('crosshair').style.display =
    (ct === 'first-person' || ct === 'third-person-chase' || ct === 'third-person-fixed') ? 'block' : 'none';

  // Own-health bar: any mode where you have a body that can take damage.
  // Swarm Command has no body - its "health" is the swarm itself.
  document.getElementById('hudHealthBar').style.display =
    MODE_CONFIG[mode].minionsOnly ? 'none' : 'block';
  updateHudHealth(PLAYER_MAX_HEALTH);

  // The testing menu's toggle becomes available once any mode has started
  // (and stays available from then on, including on the death screen).
  document.getElementById('menuToggleBtn').style.display = 'block';

  // Mobile modes want landscape. The CSS media query does the actual
  // detecting - this class just scopes it to mobile modes so a narrow
  // desktop window doesn't get nagged. screen.orientation.lock is a
  // best-effort bonus where supported (notably NOT iOS Safari).
  // startsWith covers all three touch flavors: touch, touch-swarm, touch-dual.
  if (MODE_CONFIG[mode].inputType.startsWith('touch')) {
    document.getElementById('orientationLockOverlay').classList.add('mobile-active');
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) { /* unsupported - the CSS overlay covers it */ }
  }

  if (mode === 'console') consoleModeEnteredAt = performance.now();

  camera = createCameraForMode(mode);
  connectToServer();

  // Re-assert the test-mode toggle on every fresh connection (each
  // respawn/mode-switch is a brand-new socket, so server-side state
  // starts blank each time).
  if (testModeInvincible) socket.emit('setTestMode', { enabled: true });
}

document.querySelectorAll('.join-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('disabled')) return;
    startGame(btn.dataset.mode);
  });
});

// On an actual touch device, spotlight the Mobile (dual-stick) option -
// it's the current design direction and the one built for that hardware.
// Desktop testers can still pick it freely (all its inputs are pointer
// events, so a mouse - or DevTools touch emulation - drives it fine).
if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) {
  const mobileBtn = document.querySelector('.join-btn[data-mode="mobile"]');
  if (mobileBtn) {
    mobileBtn.classList.add('suggested');
    const sub = mobileBtn.querySelector('.sub');
    if (sub) sub.textContent += ' — suggested for this device';
  }
}

// Team picker: highlights the chosen button and remembers the choice for
// the next connection (it's sent in the socket handshake, so it applies
// on the next join/respawn/mode-switch, not retroactively).
document.querySelectorAll('.team-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedTeam = btn.dataset.team;
    document.querySelectorAll('.team-btn').forEach((b) => b.classList.toggle('selected', b === btn));
  });
});

// ----------------------------------------------------------------------------
// IN-GAME TESTING MENU
// ----------------------------------------------------------------------------
// A small overlay for playtesting: switch modes without reloading the tab,
// adjust look sensitivity, and toggle invincibility. The game keeps running
// behind it - it's a tool palette, not a pause screen.
const inGameMenuEl = document.getElementById('inGameMenu');

document.getElementById('menuToggleBtn').addEventListener('click', () => {
  inGameMenuEl.style.display = inGameMenuEl.style.display === 'block' ? 'none' : 'block';
});

// Mode switching: same startGame() as the join screen - it tears the
// current mode down first, so this works mid-match. Picking the CURRENT
// mode again is allowed on purpose: it doubles as a "force reconnect".
document.querySelectorAll('.menu-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    inGameMenuEl.style.display = 'none';
    startGame(btn.dataset.mode);
  });
});

document.getElementById('sensitivitySlider').addEventListener('input', (e) => {
  sensitivityMultiplier = e.target.value / 100;
  document.getElementById('sensitivityLabel').textContent = `${e.target.value}%`;
});

document.getElementById('testModeToggle').addEventListener('change', (e) => {
  testModeInvincible = e.target.checked;
  if (socket) socket.emit('setTestMode', { enabled: testModeInvincible });
});
