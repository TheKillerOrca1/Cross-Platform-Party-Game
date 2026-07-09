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
// --- Vertical movement: gravity, jump, sprint, climb ---
// Added so players can jump (PC), fall, stand on top of cover boxes, and
// mount/climb ledges. Applies to every mode that has a walking avatar.
const GRAVITY = 20;             // units/s^2 pulling the player down
const JUMP_SPEED = 8;           // launch speed of a PC jump (~1.6u apex)
const SPRINT_MULTIPLIER = 1.7;  // PC move-speed boost while holding F (sprint)
const CROUCH_MOVE_FACTOR = 0.45; // PC move-speed while crouched (holding Shift)
const PC_SLIDE_DISTANCE = 9;    // how far a PC slide (F then Shift) carries you
const PC_SLIDE_DURATION = 0.42; // seconds the PC slide lasts
const CLIMB_RATE = 5;           // units/s the player scales a wall while mantling
const CLIMB_REACH = 2.8;        // tallest ledge a climb can start onto (leaves the 3u border walls unclimbable, so you can't scale out of the arena)
const CLIMB_MIN_LEDGE = 0.35;   // ledges shorter than this are just walked up; taller ones trigger a climb
const PLAYER_RADIUS = 0.4;      // matches the capsule radius / collision ellipsoid
const CAPSULE_HALF = 0.9;       // capsule center sits this far above the feet
const LAND_TOLERANCE = 0.25;    // how far below a surface you can be and still settle onto it
// Babylon's moveWithCollisions clamps a SINGLE call to ~0.1u of travel, so
// anything faster than a walk (sprint, dashes) has to be broken into small
// sub-moves or it silently caps out. This is the max distance per sub-move.
const MOVE_COLLIDE_SUBSTEP = 0.09;
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
// Bumped for a faster, longer-reaching "real gun" feel across ALL platforms
// (was 25 / 30). Fast enough that leading a target barely matters at typical
// arena ranges, and reaches most of the way across the 70u map.
const PROJECTILE_SPEED = 48;        // world units per second
const PROJECTILE_MAX_DISTANCE = 55; // despawn after traveling this far
const HIT_RADIUS = 0.9;             // how close (horizontally) a projectile must get to count as a hit
// Projectiles now travel in full 3D (they can be aimed up/down), so a hit
// also needs the shot to be at roughly the target's HEIGHT, not just its
// x/z footprint. A capsule spans ~0.9 above and below its center; this is
// that half-height plus a little forgiveness.
const HIT_VERTICAL = 1.2;
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
const MOUSE_PITCH_SENSITIVITY = 0.0022; // vertical look, a touch slower than horizontal
const TOUCH_LOOK_SENSITIVITY = 0.006;  // radians of turn per pixel of touch drag (touch screens are smaller, so a bit more sensitive per pixel)

// --- Look pitch (up/down aim), shared by every crosshair mode ---
// aimPitch is radians: 0 = level, positive = looking up, negative = down.
// Clamped so you can't roll the camera past straight up/down.
const AIM_PITCH_MIN = -1.15; // ~ -66°
const AIM_PITCH_MAX = 1.15;  // ~ +66°
// Third-person can't tilt as far without the orbit camera dropping through
// the floor, so its pitch drives the camera's beta angle within a safe band
// around this resting angle. Accuracy doesn't depend on the exact tilt -
// shots always follow the actual on-screen crosshair ray (see
// computeAimDirection) - so a compressed third-person tilt is fine.
const TP_BASE_BETA = Math.PI / 2.4; // ~75° from vertical (the old resting chase angle)
const TP_PITCH_TO_BETA = 0.42;      // how much aimPitch swings beta
const TP_BETA_MIN = 0.85;           // camera highest (looking down)
const TP_BETA_MAX = 1.62;           // camera lowest (looking up) - stays above ground

// --- Aim-down-sights (ADS): hold to steady + zoom for a real accuracy gain ---
const HIPFIRE_FOV = 0.8;        // Babylon's default field of view (radians)
const ADS_FOV = 0.5;            // zoomed-in while aiming
const FOV_LERP_SPEED = 12;      // how fast the zoom eases in/out
const ADS_SENS_FACTOR = 0.55;   // look slower while zoomed, for finer aim
const HIPFIRE_SPREAD_RAD = 0.045; // ~2.5° random cone on hip-fire...
const ADS_SPREAD_RAD = 0;       // ...vs pinpoint while aiming down sights

// --- Gamepad (Console) ---
const GAMEPAD_DEADZONE = 0.2; // ignore stick input this close to center (avoids drift from imprecise sticks)
const GAMEPAD_FIRE_BUTTON_INDEX = 7; // right trigger on the "standard" gamepad mapping (Xbox/PlayStation/etc)
const GAMEPAD_ALT_FIRE_BUTTON_INDEX = 0; // A/Cross too - some Bluetooth pads map triggers unusually
const GAMEPAD_ADS_BUTTON_INDEX = 6;  // left trigger = hold to aim (mirrors PC's right-mouse ADS)
const GAMEPAD_PERSP_BUTTON_INDEX = 3; // Y/Triangle toggles first/third person
const GAMEPAD_YAW_RATE = 2.6;   // radians/sec of turn at full right-stick deflection
const GAMEPAD_PITCH_RATE = 1.8; // radians/sec of pitch at full deflection (a bit gentler than yaw)
const GAMEPAD_GRACE_PERIOD_MS = 2000; // how long to wait in Console mode before showing "no controller"
// (The old GAMEPAD_AIM_LERP_SPEED is gone: Console aim is now rate-based,
// integrated directly, so there's no "glide toward a target angle" to tune.)

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
// MOBILE MODE (dual-stick + DRIFT DECK) - tuning constants
// ----------------------------------------------------------------------------
// This is the CURRENT mobile design direction (see 01_Platform_Playstyles.md,
// July 9 2026 session): fully manual dual-stick control plus a see-through
// "Drift Deck" (DD) - the panel next to the aim stick where the player DRAWS
// their movement. The four older mobile modes are kept as superseded
// experiments.
//
// ⚠ First on-device playtest happened; these numbers are being tuned from
// that feedback (bigger throw, snappier cooldown, Drift Deck moved beside
// the aim stick). Keep tuning freely.

// The bottom strip of the screen belongs to the two sticks (left half =
// move, right half = aim). Touches above the strip hit the Drift Deck
// (its own element) or nothing.
const DUAL_STICK_STRIP_FRACTION = 0.35;
// Both sticks are drawn at a fixed "home" position at rest (Brawl-Stars
// style) and spring back there on release. These are the home CENTERS as a
// fraction of the canvas, kept clear of the Drift Deck (upper right).
const STICK_HOME = {
  moveFracX: 0.13, moveFracY: 0.78, // left stick home
  aimFracX: 0.87, aimFracY: 0.82,   // right stick home (Drift Deck sits just above)
};
// Right stick: full-edge deflection turns you this fast (radians/second),
// scaled by the sensitivity slider. It is an ADS + fire stick: holding it
// aims-down-sights (steadier + zoomed), releasing it fires one shot.
const DUAL_TURN_MAX_RATE = 4.6;  // raised so an edge flick turns fast...
// Vertical deflection pitches the aim up/down. Deliberately a lower rate
// than horizontal turning - vertical aim wants finer control on a phone.
const DUAL_PITCH_MAX_RATE = 3.0;
const TOUCH_LOOK_PITCH_FACTOR = 0.55; // mobile vertical look is slower than horizontal
// Exponent applied to stick deflection before it becomes a turn/look rate.
// >1 makes the response DYNAMIC: near the center the stick is very steady
// (fine combat aim), out at the edge it ramps up fast (quick turns). This is
// the classic "expo" curve. 1 = linear.
const AIM_STICK_EXPO = 2.4;

// --- Drift Deck: recognizing the drawn stroke ---
const GESTURE_MIN_STROKE_PX = 26;    // shorter marks are ignored (accidental taps)
const GESTURE_SMOOTH_WINDOW = 5;     // moving-average window over raw finger points
const GESTURE_RESAMPLE_POINTS = 28;  // the cleaned-up path is reduced to this many evenly spaced points
// Corner-cutting (Chaikin) smoothing passes applied to a free-form stroke so
// a jagged zigzag becomes a flowing squiggle instead of a literal jittery
// copy of the finger path. Higher = looser/rounder.
const GESTURE_SPLINE_ITERATIONS = 3;
// A mostly-vertical stroke is a forward move (jump if it goes up, slide if it
// goes down) EVEN IF it wiggles - only a stroke that arcs out to a SIDE
// becomes a free-form (potentially backward) dash. This ratio is the gate: a
// stroke wider than tall*this counts as a real sideways swoop. Fixes the bug
// where an S-shaped downward stroke became a backward dash instead of a
// forward slide.
const GESTURE_SWOOP_ASPECT = 0.9;

// --- Turning the drawn shape into a world-space dash path ---
// Screen-up in the Drift Deck = "the way the camera faced when the gesture
// STARTED" (locked at gesture start, per the design - moving the camera
// mid-draw does not re-aim the dash). Screen-x = sideways.
// Throw values bumped up from the first playtest to compensate for the now-
// smaller Drift Deck (a full-height stroke covers fewer pixels).
const DASH_WORLD_SCALE = 13;     // world units a full-Drift-Deck-height stroke maps to
const DASH_MIN_WORLD_LEN = 4;    // clamp: even a tiny valid stroke dashes a useful distance
const DASH_MAX_WORLD_LEN = 20;   // clamp: no cross-map teleports
const DASH_SPEED = 22;           // world units/second along the traced path
// Hard ceiling on how fast the capsule may chase its path. Normal playback
// peaks around 1.5x DASH_SPEED (smoothstep easing), safely under this; it
// only bites when a wall pinned the capsule mid-dash while the path moved
// on - without the cap, clearing the wall snapped the capsule several
// units in a single frame (found in testing).
const DASH_CATCHUP_SPEED = 34;
const DASH_MIN_DURATION_S = 0.26;
const DASH_MAX_DURATION_S = 1.0;
const JUMP_DASH_HEIGHT = 2.4;    // arc peak of the jump-dash
const FREEFORM_HOP_HEIGHT = 1.0; // curved dashes get a low "carried by wind" hop
const DASH_COOLDOWN_MS = 80;     // much snappier than the first pass (was 250) - fast chaining
const DASH_PATH_LINGER_MS = 500; // how long the glowing world-path line outlives the dash
// Slide-dash ducks the player: a squashed, low capsule with a shorter
// hitbox, so it slips under shots aimed at a standing player.
const SLIDE_SCALE_Y = 0.5;                        // vertical squash of the capsule while sliding
const SLIDE_CENTER_Y = CAPSULE_HALF * SLIDE_SCALE_Y; // squashed center rests on the ground (~0.45)
const HIT_VERTICAL_SLIDE = SLIDE_CENTER_Y + 0.3;  // shorter vertical hit window while sliding

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
    // The CURRENT mobile design (dual-stick + Drift Deck). Third-person
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

// Effective camera type for the CURRENT session. It starts as the mode's
// default (MODE_CONFIG[mode].cameraType) but Console & Mobile can toggle
// between first- and third-person mid-match, so the render loop, aiming,
// and own-capsule visibility all read THIS variable rather than the static
// MODE_CONFIG value. PC never changes it (locked first-person this session).
let currentCameraType = null;

// Which camera types show a screen-center crosshair and therefore aim by
// "shoot wherever the crosshair points" (see computeAimDirection). The
// top-down stick modes are NOT crosshair modes - they aim by facing.
function isCrosshairCameraType(ct) {
  return ct === 'first-person' || ct === 'third-person-chase' || ct === 'third-person-fixed';
}

// --- Shared look pitch + aim-down-sights state (all crosshair modes) ---
// Yaw stays per-input (pcAimYaw / gamepadAimYaw / touchAimYaw) since only
// one input scheme is ever active, but a single shared pitch is simplest.
let aimPitch = 0;       // radians, 0 = level, + = up (clamped to AIM_PITCH_*)
let adsActive = false;  // aim-down-sights currently held: zoom + steady + no spread

// --- Local player vertical state (gravity / jump / climb) ---
let playerVY = 0;          // vertical velocity (units/s)
let playerGrounded = true; // standing on ground or a box top?
// The FEET height is the authoritative vertical state, NOT the capsule
// center. This matters for crouch: ducking changes the capsule's height
// (currentCapsuleHalf), and if we re-derived the feet from the center each
// frame, that height change would look like the feet teleporting - which
// used to make the player "fall", flip un-grounded, and jitter the crouch.
// Keeping feet persistent means a crouch only moves the CENTER down while
// the feet stay planted. Center = feet + currentCapsuleHalf.
let playerFeetY = 0;
let jumpQueued = false;    // set by the PC jump key, consumed by the next physics step
let climbState = null;     // while mantling a ledge: { topY, dirX, dirZ }
let pcFireHeld = false;    // left mouse held: the render loop auto-fires (cooldown-limited)
let pcCrouching = false;   // PC crouch (Shift held): ducked, slower, shorter hitbox
// Effective capsule half-height: 0.9 standing, lower while crouched, so the
// body physically ducks (also lowers the first-person eye). Eased smoothly
// toward its target so ducking/standing isn't an instant snap.
let currentCapsuleHalf = 0.9;
const CROUCH_LERP_SPEED = 14; // how fast the capsule eases between stand/crouch height

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

function addObstacleBox(name, x, z, width, height, depth, colorHex) {
  const box = BABYLON.MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  box.position.set(x, height / 2, z);
  box.checkCollisions = true;

  const mat = new BABYLON.StandardMaterial(`${name}-mat`, scene);
  mat.diffuseColor = colorHex
    ? BABYLON.Color3.FromHexString(colorHex)
    : new BABYLON.Color3(0.42, 0.42, 0.48); // neutral stone gray
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  box.material = mat;

  obstacles.push(box);
  const projectileRadius = 0.15;
  obstacleBounds.push({
    minX: x - width / 2 - projectileRadius,
    maxX: x + width / 2 + projectileRadius,
    minZ: z - depth / 2 - projectileRadius,
    maxZ: z + depth / 2 + projectileRadius,
    // Vertical extent: the box sits from the ground (y=0) up to its height.
    // Now that shots can be aimed up/down, a projectile only stops on a box
    // if it's actually AT the box's height - so you can arc a shot over a
    // low crate instead of it magically eating the bolt.
    minY: 0,
    maxY: height + projectileRadius,
    height,
    // Raw footprint (no projectile padding) + top surface height, used by
    // the player's gravity/stand-on-top and climb logic.
    cx: x,
    cz: z,
    halfW: width / 2,
    halfD: depth / 2,
    top: height,
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

// --- Temporary TEST geometry (parkour + climbing) ---
// Tinted warm so it reads as scratch test terrain, NOT final map design.
// Purpose: give Console's parkour and the new climb/jump something varied to
// exercise - a staircase, a tall climbable wall, a platform to mount, a
// facing-wall corridor, and a low block to vault. Spaced out, no enclosed
// pockets. Will be replaced by the real map (see the map-session backlog).
const TEST_TINT = '#6b5a43';
addObstacleBox('test-step-0', -4, 14, 2.6, 0.7, 2.6, TEST_TINT); // ascending staircase...
addObstacleBox('test-step-1', -1, 14, 2.6, 1.3, 2.6, TEST_TINT);
addObstacleBox('test-step-2',  2, 14, 2.6, 1.9, 2.6, TEST_TINT);
addObstacleBox('test-step-3',  5, 14, 2.6, 2.5, 2.6, TEST_TINT); // ...up to a 2.5u ledge
addObstacleBox('test-wall-climb', -8, -11, 3, 2.6, 1.4, TEST_TINT); // tall wall to mantle
addObstacleBox('test-platform', 6, -12, 6, 1.4, 4, TEST_TINT);      // raised platform to stand/shoot from
addObstacleBox('test-parkour-a', 18, -6, 1.5, 2.4, 4, TEST_TINT);   // facing-wall pair with an...
addObstacleBox('test-parkour-b', 18, 6, 1.5, 2.4, 4, TEST_TINT);    // ...open corridor between them
addObstacleBox('test-low', -18, 11, 4, 1.0, 4, TEST_TINT);          // low block to vault / step onto

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
// MODE_CONFIG above for what each type means. `cameraTypeOverride` lets the
// perspective toggle (Console/Mobile) request first- or third-person
// regardless of the mode's default.
function createCameraForMode(mode, cameraTypeOverride) {
  const cameraType = cameraTypeOverride || MODE_CONFIG[mode].cameraType;

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

// Shows or hides the LOCAL player's own capsule (plus its gun/barrel) based
// on the current perspective: hidden in first-person (the camera is inside
// your head), visible in third-person (so you can watch your own dashes and
// movement). Only touches visibility, never the mesh's realness for hit
// detection or for other players. Pass the capsule explicitly (addPlayer
// hasn't stored it in playerAvatars yet when it first calls this).
function applyOwnCapsuleVisibility(capsuleMaybe) {
  const capsule = capsuleMaybe || (playerAvatars[localPlayerId] && playerAvatars[localPlayerId].mesh);
  if (!capsule) return;
  const visible = currentCameraType !== 'first-person';
  capsule.isVisible = visible;
  capsule.getChildMeshes().forEach((m) => { m.isVisible = visible; });
}

// Console & Mobile can flip between first- and third-person mid-match. PC is
// locked first-person this session, and the top-down stick modes don't have
// a sensible "first-person" so they're excluded too. Rebuilds the camera in
// place (keeping the same socket/session) and refreshes own-body visibility.
function togglePerspective() {
  if (currentMode !== 'console' && currentMode !== 'mobile') return;
  currentCameraType = currentCameraType === 'first-person' ? 'third-person-chase' : 'first-person';
  if (camera) camera.dispose();
  camera = createCameraForMode(currentMode, currentCameraType);
  camera.fov = adsActive ? ADS_FOV : HIPFIRE_FOV; // start the fresh camera at the right zoom
  applyOwnCapsuleVisibility();
  const label = currentCameraType === 'first-person' ? '1st' : '3rd';
  perspectiveToggleBtnEl.innerHTML = `&#128065; view: ${label}`;
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
  // rendering of yourself is hidden. (Applied via applyOwnCapsuleVisibility
  // so the perspective toggle can flip it live.)
  if (id === localPlayerId) {
    // Never let our OWN camera-aim ray (see computeAimDirection) hit our
    // own body or gun - the shot should pass through us to whatever the
    // crosshair is actually over. Remote players stay pickable (they're
    // valid targets); only our own local avatar opts out.
    capsule.isPickable = false;
    capsule.getChildMeshes().forEach((m) => { m.isPickable = false; });
    applyOwnCapsuleVisibility(capsule);
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
  // Seed the local player's authoritative feet height from the spawn center.
  if (id === localPlayerId) playerFeetY = startY - CAPSULE_HALF;

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
    // Our own minions never block our own aim ray (they're not self-targets);
    // keep them non-pickable so shooting past your own squad "just works".
    capsule.isPickable = false;
    capsule.getChildMeshes().forEach((m) => { m.isPickable = false; });
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

  // Escape opens/closes the pause menu (the in-game testing menu doubles as
  // it). Works once a game has started - the menu button is our "are we in
  // a match" signal. Note: Escape also drops pointer lock (browser default);
  // clicking the canvas re-locks.
  if (e.key === 'Escape' && document.getElementById('menuToggleBtn').style.display !== 'none') {
    const m = document.getElementById('inGameMenu');
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
    return;
  }

  if (currentMode === 'pc') {
    // Space = jump (consumed in the vertical-physics step). preventDefault
    // stops the page from scrolling on space.
    if (e.key === ' ') { jumpQueued = true; e.preventDefault(); }
    // Shift = crouch (held), UNLESS you're sprinting (F held) and grounded -
    // then F+Shift kicks off a slide in the direction you're facing.
    if (e.key === 'Shift' && !e.repeat) {
      if (keysDown['f'] && !activeDash && playerGrounded) {
        startPcSlide();
      }
    }
    // F = sprint (held); handled in the render loop via keysDown['f'].
  }
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
  // While aiming down sights, slow the look for finer aim.
  const adsFactor = adsActive ? ADS_SENS_FACTOR : 1;
  pcAimYaw += e.movementX * MOUSE_LOOK_SENSITIVITY * sensitivityMultiplier * adsFactor;
  // movementY up (negative) should look UP (+pitch). Clamp so you can't
  // flip the camera over the top.
  aimPitch = clamp(aimPitch - e.movementY * MOUSE_PITCH_SENSITIVITY * sensitivityMultiplier * adsFactor, AIM_PITCH_MIN, AIM_PITCH_MAX);
}
window.addEventListener('mousemove', handlePcMouseLook);

canvas.addEventListener('pointerdown', (e) => {
  if (currentMode !== 'pc') return;
  if (e.button === 0) {
    // Left mouse: fire immediately, and HOLD to keep firing (the render loop
    // polls pcFireHeld, rate-limited by the cooldown). Hold-to-fire is why
    // "aim with RMB + hold LMB" now streams shots instead of firing once.
    pcFireHeld = true;
    tryFireProjectile();
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  } else if (e.button === 2) {
    adsActive = true; // hold right mouse to aim down sights
  }
});
// Button releases. Listened on window (not just the canvas) so a release
// that happens after the cursor left the canvas still registers.
window.addEventListener('pointerup', (e) => {
  if (currentMode !== 'pc') return;
  if (e.button === 0) pcFireHeld = false;
  else if (e.button === 2) adsActive = false;
});
// If the window loses focus mid-hold, drop the held buttons so we don't get
// stuck firing/aiming.
window.addEventListener('blur', () => { pcFireHeld = false; });
// Suppress the browser context menu so right-click-to-aim doesn't pop it.
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ----------------------------------------------------------------------------
// INPUT: Console (gamepad)
// ----------------------------------------------------------------------------
// Gamepads have no events for "stick moved" - the browser only lets you
// POLL their current state, so we read navigator.getGamepads() fresh every
// frame in the render loop (see readGamepadState below) rather than
// listening for anything here.
let gamepadAimYaw = 0; // holds its last value when the stick is released, rather than snapping to 0
let gamepadFireWasHeld = false; // edge-detection so holding the trigger doesn't fire every single frame
let gamepadPerspWasHeld = false; // edge-detection for the perspective-toggle button
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
  if (!pad) return { connected: false, moveX: 0, moveZ: 0, aimX: 0, aimY: 0, firePressed: false, adsHeld: false, perspPressed: false };

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

  // Left trigger = hold to aim down sights (mirrors PC's right-mouse).
  const adsButton = pad.buttons[GAMEPAD_ADS_BUTTON_INDEX];
  const adsHeld = !!adsButton && (adsButton.pressed || adsButton.value > 0.4);
  // Y/Triangle = toggle perspective (edge-detected by the caller).
  const perspButton = pad.buttons[GAMEPAD_PERSP_BUTTON_INDEX];
  const perspPressed = !!perspButton && perspButton.pressed;

  return {
    connected: true,
    moveX: leftX,
    moveZ: -leftY, // gamepad Y axis is inverted (up = negative) relative to our +Z-forward convention
    aimX: rightX,  // right-stick horizontal -> yaw RATE (turn), consumed in the render loop
    aimY: -rightY, // right-stick vertical (up = positive) -> pitch RATE (look up)
    firePressed,
    adsHeld,
    perspPressed,
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
// INPUT: Mobile (dual-stick + Drift Deck) - the CURRENT mobile design
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
// HOW A DRAWN SHAPE BECOMES MOVEMENT (the Drift Deck)
// The Deck is read like a bird's-eye minimap of your immediate surroundings:
// screen-up = "the way the camera faced when the gesture started",
// screen-x = sideways. A mostly-vertical stroke is an easy/safe forward move:
//   - goes UP   -> jump-dash  (forward leap arc)
//   - goes DOWN -> slide-dash (forward ground slide, ducked low; deliberately
//     NOT a backward dash - even a wiggly S counts as forward)
// A stroke that arcs out to a SIDE is free-form: the traced shape (smoothed
// into a loose flowing spline) becomes the flight path. This is the only way
// to move BACKWARD - swoop a curve around to a side and end low. Simple
// inputs stay safe; curvy inputs unlock the full move set.
//
// A sharp out-and-back "V" stroke is the separate wall-swoop gesture:
// swipe toward a nearby wall then away, and you get a push-off impulse in
// the direction of the return stroke (first-pass implementation).

const gestureZoneEl = document.getElementById('gestureZone');
const gestureCanvasEl = document.getElementById('gestureCanvas');
const gestureResultLabelEl = document.getElementById('gestureResultLabel');
const perspectiveToggleBtnEl = document.getElementById('perspectiveToggleBtn');

// Mobile's on-screen first/third-person toggle (Console uses a gamepad
// button for the same thing).
perspectiveToggleBtnEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  togglePerspective();
});

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
let dualAimOriginY = 0;
let dualTurnX = 0; // -1..1 horizontal deflection -> yaw (turn) rate
let dualTurnY = 0; // -1..1 vertical deflection (up = positive) -> pitch rate

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

// Expo response curve for a stick deflection in [-1,1]: keeps the sign, but
// raises the magnitude to a power so small pushes stay gentle (steady aim)
// and edge pushes stay strong (fast turns). See AIM_STICK_EXPO.
function aimExpo(v) {
  return Math.sign(v) * Math.pow(Math.abs(v), AIM_STICK_EXPO);
}

// --- Dual sticks (Brawl-Stars style: visible at a home position at rest) ---
// Unlike the legacy floating sticks, these are always shown while in Mobile
// mode. They spring to the thumb when grabbed and return to their home
// position on release, so a player can always see where each stick lives.
function stickHomePx(fracX, fracY) {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.width * fracX, y: rect.height * fracY };
}
function homeMoveStick() {
  const h = stickHomePx(STICK_HOME.moveFracX, STICK_HOME.moveFracY);
  joystickBaseEl.style.left = `${h.x - 55}px`;
  joystickBaseEl.style.top = `${h.y - 55}px`;
  joystickKnobEl.style.left = '30px';
  joystickKnobEl.style.top = '30px';
  joystickBaseEl.style.display = 'block';
}
function homeAimStick() {
  const h = stickHomePx(STICK_HOME.aimFracX, STICK_HOME.aimFracY);
  aimJoystickBaseEl.classList.add('turn-stick');
  aimJoystickBaseEl.style.left = `${h.x - 55}px`;
  aimJoystickBaseEl.style.top = `${h.y - 55}px`;
  aimJoystickKnobEl.style.left = '30px';
  aimJoystickKnobEl.style.top = '30px';
  aimJoystickBaseEl.style.display = 'block';
}

function onDualTouchStart(e) {
  if (!currentMode || MODE_CONFIG[currentMode].inputType !== 'touch-dual') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Above the stick strip is the Drift Deck's territory (its own element
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
    dualAimOriginY = y;
    dualTurnX = 0;
    dualTurnY = 0;
    adsActive = true; // grabbing the aim stick aims down sights (steady + zoom)
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
    const dy = y - dualAimOriginY;
    moveAimJoystickKnob(dx, dy); // 2D now: horizontal = turn, vertical = look up/down
    dualTurnX = clamp(dx / JOYSTICK_MAX_RADIUS, -1, 1);
    dualTurnY = clamp(-dy / JOYSTICK_MAX_RADIUS, -1, 1); // push up (dy<0) = look up
  }
}

function onDualTouchEnd(e) {
  if (e.pointerId === dualMoveTouchId) {
    dualMoveTouchId = null;
    dualMoveX = 0;
    dualMoveZ = 0;
    homeMoveStick(); // return to home (stays visible), not hidden
  } else if (e.pointerId === dualAimTouchId) {
    // Releasing the aim stick FIRES one shot in the current aim (the ADS
    // aim-and-release scheme from the design session), then drops out of
    // aim-down-sights. The stick returns to its home position.
    dualAimTouchId = null;
    dualTurnX = 0;
    dualTurnY = 0;
    tryFireProjectile();
    adsActive = false;
    homeAimStick();
  }
}

canvas.addEventListener('pointerdown', onDualTouchStart);
canvas.addEventListener('pointermove', onDualTouchMove);
canvas.addEventListener('pointerup', onDualTouchEnd);
canvas.addEventListener('pointercancel', onDualTouchEnd);

// Keep the resting sticks in their home spots if the window/orientation
// changes while playing and no finger is currently on them.
window.addEventListener('resize', () => {
  if (currentMode === 'mobile') {
    if (dualMoveTouchId === null) homeMoveStick();
    if (dualAimTouchId === null) homeAimStick();
  }
});

// --- Drift Deck canvas (the visible finger trace) ---
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

// Chaikin corner-cutting: replaces each segment's sharp corners with two
// points 1/4 and 3/4 along it, rounding the polyline. Run a few times, a
// jagged zigzag becomes a smooth flowing squiggle - a LOOSE spline through
// the trace, not a literal copy of every jitter. Endpoints are preserved.
function chaikinSmooth(points, iterations) {
  let pts = points;
  for (let it = 0; it < iterations && pts.length >= 3; it++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
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
  // Where the stroke STARTED: 0 = bottom of the pad, 1 = top.
  const startHeight = 1 - first.y / zoneHeightPx;
  // Bounding spread of the stroke (how wide vs how tall it is).
  let minX = first.x, maxX = first.x, minY = first.y, maxY = first.y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const horizSpread = maxX - minX;
  const vertSpread = maxY - minY;

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

  // --- Mostly-vertical stroke => a FORWARD jump or slide ---
  // The key fix: classify by whether the stroke is a sideways SWOOP or not,
  // not by how "straight" it is. A wiggly-but-vertical stroke (like an S
  // drawn downward) is still a forward slide - only a stroke that arcs out
  // to a side (wide relative to tall) becomes a free-form/backward dash.
  // This is what stops a downward S from being read as a backward dash.
  const isSwoop = horizSpread > vertSpread * GESTURE_SWOOP_ASPECT;
  if (!isSwoop && vertSpread >= GESTURE_MIN_STROKE_PX * 0.4) {
    // Up = jump, down = slide. Prefer the net vertical direction; if the
    // stroke is nearly flat vertically (a symmetric S), fall back to the
    // start band (started low = jump, started high = slide) - both forward.
    let goingUp;
    if (Math.abs(netY) > 8) goingUp = netY < 0; // screen-up is -y
    else goingUp = startHeight < 0.5;
    return goingUp
      ? { type: 'jump', netX, netY, pathLen, pts }
      : { type: 'slide', netX, netY, pathLen, pts };
  }

  // --- Everything else (a real sideways swoop): the drawn shape IS the
  // flight path, smoothed into a loose flowing spline. This is the only way
  // to dash BACKWARD (arc a curve around to a side and end low). ---
  return { type: 'freeform', pts: chaikinSmooth(pts, GESTURE_SPLINE_ITERATIONS), pathLen };
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

// Deterministic obstacle backstop for dashes: if the capsule center is
// inside an obstacle's footprint (expanded by its radius) AND the dash is
// below that obstacle's top (i.e. NOT arced over it), shove it out to the
// nearest face. This guarantees a fast dash can't tunnel through cover,
// independent of Babylon's moveWithCollisions (which we also use, but which
// caps per-call and can't be exercised in a backgrounded test tab). A
// jump-dash arced above a box's top passes over it untouched.
function resolveDashAgainstObstacles(mesh, wantY, moveDirX, moveDirZ) {
  // A hair MORE than the capsule radius, so a dash pinned against a wall ends
  // clearly beside the box - not exactly on its footprint edge, where the
  // landing code would mistake it for standing on top.
  const r = PLAYER_RADIUS + 0.08;
  for (const b of obstacleBounds) {
    if (wantY >= b.top - 0.1) continue; // arced above this obstacle - fly over
    const px = mesh.position.x, pz = mesh.position.z;
    const minX = b.cx - b.halfW - r, maxX = b.cx + b.halfW + r;
    const minZ = b.cz - b.halfD - r, maxZ = b.cz + b.halfD + r;
    if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
      // Push back to the face we ENTERED from (opposite the dash's dominant
      // travel axis), so a fast dash stops AT the near wall instead of
      // popping out the far side.
      if (Math.abs(moveDirX) >= Math.abs(moveDirZ)) {
        mesh.position.x = moveDirX >= 0 ? minX : maxX;
      } else {
        mesh.position.z = moveDirZ >= 0 ? minZ : maxZ;
      }
    }
  }
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
  // Slide-dash ducks low: squash the capsule so it's a shorter target
  // (the matching shorter hitbox is applied via the networked `low` flag).
  const local = playerAvatars[localPlayerId];
  if (local) local.mesh.scaling.y = (spec.type === 'slide') ? SLIDE_SCALE_Y : 1;
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
  // Height: a sine arc peaking mid-dash for jumps/swoops; a slide instead
  // stays ducked low the whole time (squashed capsule resting on the ground).
  const wantY = (dash.type === 'slide')
    ? SLIDE_CENTER_Y
    : 0.9 + Math.sin(Math.PI * s) * dash.heightPeak;

  // HORIZONTAL move via moveWithCollisions so cover boxes and the border
  // still block/deflect a dash. Only the x/z step is swept - the vertical
  // (arc / duck) is purely cosmetic and is set directly below. (Feeding the
  // vertical into moveWithCollisions made the collision system reject a
  // downward slide, which both un-ducked the capsule AND, by inflating the
  // step length, starved the forward motion through the anti-tunnel cap.)
  let stepX = wantX - local.mesh.position.x;
  let stepZ = wantZ - local.mesh.position.z;
  const horizLen = Math.hypot(stepX, stepZ);
  const maxStep = DASH_CATCHUP_SPEED * deltaSeconds;
  if (horizLen > maxStep && horizLen > 0) {
    const k = maxStep / horizLen;
    stepX *= k;
    stepZ *= k;
  }
  moveWithCollisionsSubstepped(local.mesh, stepX, 0, stepZ);
  local.mesh.position.y = wantY; // arc / duck, directly (not collision-swept)
  resolveDashAgainstObstacles(local.mesh, wantY, stepX, stepZ); // deterministic anti-tunnel backstop

  if (t >= 1) endActiveDash(local);
}

function endActiveDash(local) {
  const dash = activeDash;
  activeDash = null;
  lastDashEndedAt = performance.now();

  // Land on whatever surface is beneath us: the ground, or the top of a box
  // a jump-dash arced onto. (The per-frame resolveDashAgainstObstacles has
  // already kept us out of any wall we dashed into horizontally, so there's
  // nothing to push out of here - we just settle onto the right height.)
  local.mesh.scaling.y = 1; // stand back up after a slide's duck
  currentCapsuleHalf = CAPSULE_HALF;
  const support = groundSupportHeight(local.mesh.position.x, local.mesh.position.z, Infinity);
  playerFeetY = support; // hand the feet back to the vertical physics
  local.mesh.position.y = playerFeetY + CAPSULE_HALF;
  playerVY = 0;
  playerGrounded = true;

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
  const local = playerAvatars[localPlayerId];
  if (local) local.mesh.scaling.y = 1; // undo any slide-duck squash
}

// PC slide (F held, then Shift): a quick forward slide in the direction the
// player is facing, ducked low - reuses the same slide dash the Drift Deck
// produces (so it ducks the hitbox and networks `low` identically).
function startPcSlide() {
  const local = playerAvatars[localPlayerId];
  if (!local) return;
  if (performance.now() - lastDashEndedAt < DASH_COOLDOWN_MS) return;
  const yaw = local.mesh.rotation.y;
  const dirX = Math.sin(yaw), dirZ = Math.cos(yaw);
  startDash({
    type: 'slide',
    points: straightWaypoints(local.mesh.position.x, local.mesh.position.z, dirX, dirZ, PC_SLIDE_DISTANCE),
    duration: PC_SLIDE_DURATION,
    heightPeak: 0,
    label: 'slide!',
  });
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

  // All three "dash along the drawn shape" cases (jump, slide, free-form)
  // share the same machinery: map the smoothed trace to world offsets from
  // the start point, so the character flies the actual CURVE you drew, then
  // clamp the length. They differ only in how the vertical axis is read and
  // in the height profile:
  //   - free-form: screen-up = forward, screen-down = BACKWARD (the only way
  //     to dash backward), low "wind" hop.
  //   - jump:      screen-up = forward; a big arc. Follows your curve.
  //   - slide:     screen-DOWN = forward (a downward stroke is a forward
  //     slide, per design), ducked low. Horizontal curve still followed, so
  //     a wiggly slide wiggles forward.
  const type = cls.type; // 'jump' | 'slide' | 'freeform'
  const shapePts = (type === 'freeform') ? cls.pts : chaikinSmooth(cls.pts, GESTURE_SPLINE_ITERATIONS);
  const origin = shapePts[0];
  const vSign = (type === 'slide') ? -1 : 1; // slide flips down->forward
  const offsets = shapePts.map((p) => gestureVecToWorld(p.x - origin.x, vSign * (p.y - origin.y), yaw, unitsPerPx));
  let worldLen = 0;
  for (let i = 1; i < offsets.length; i++) {
    worldLen += Math.hypot(offsets[i].x - offsets[i - 1].x, offsets[i].z - offsets[i - 1].z);
  }
  if (worldLen < 0.2) return rejectWith('draw a bigger shape');
  let scale = 1;
  if (worldLen > DASH_MAX_WORLD_LEN) scale = DASH_MAX_WORLD_LEN / worldLen;
  else if (worldLen < DASH_MIN_WORLD_LEN) scale = DASH_MIN_WORLD_LEN / worldLen;
  const heightPeak = type === 'jump' ? JUMP_DASH_HEIGHT : (type === 'slide' ? 0 : FREEFORM_HOP_HEIGHT);
  const label = type === 'jump' ? 'jump-dash!' : (type === 'slide' ? 'slide-dash!' : 'swoop dash!');
  flashPadTrace(cls.pts, GESTURE_COLORS[type]);
  startDash({
    type,
    points: offsets.map((o) => ({ x: px + o.x * scale, z: pz + o.z * scale })),
    duration: clamp((worldLen * scale) / DASH_SPEED, DASH_MIN_DURATION_S, DASH_MAX_DURATION_S),
    heightPeak,
    label,
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
    // Sliding players duck: squash their capsule and remember it so our
    // shots use the shorter hit window against them.
    avatar.low = !!data.low;
    avatar.mesh.scaling.y = avatar.low ? SLIDE_SCALE_Y : 1;
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
let lastSentLow = false;
let msSinceLastSend = 0;

function maybeSendPositionToServer(deltaMs) {
  msSinceLastSend += deltaMs;
  if (msSinceLastSend < NETWORK_SEND_INTERVAL_MS) return;
  msSinceLastSend = 0;

  const local = playerAvatars[localPlayerId];
  if (!local) return;

  const { x, y, z } = local.mesh.position;
  const rotationY = local.mesh.rotation.y;
  // Are we ducked (sliding OR crouching)? Others use this to shrink our
  // hitbox and squash our capsule on their screens.
  const low = pcCrouching || !!(activeDash && activeDash.type === 'slide');

  const moved = x !== lastSentX || y !== lastSentY || z !== lastSentZ || rotationY !== lastSentRotation || low !== lastSentLow;
  if (!moved) return;

  lastSentX = x;
  lastSentY = y;
  lastSentZ = z;
  lastSentRotation = rotationY;
  lastSentLow = low;
  socket.emit('move', { x, y, z, rotationY, low });
}

// ----------------------------------------------------------------------------
// COMBAT: SHOOTING AND HIT REACTIONS
// ----------------------------------------------------------------------------
// All projectiles currently in flight, from any player.
// Each entry: { mesh, ownerId, dirX, dirZ, distanceTraveled }
const activeProjectiles = [];

function spawnProjectile({ ownerId, x, y, z, dirX, dirY, dirZ, color }) {
  dirY = typeof dirY === 'number' ? dirY : 0; // older senders (or top-down modes) fire level
  // A stretched thin "bolt" instead of a ball - an elongated shape reads
  // its direction of travel at a glance, which a sphere can't.
  const mesh = BABYLON.MeshBuilder.CreateCylinder(
    `projectile-${ownerId}-${Date.now()}-${Math.random()}`,
    { diameterTop: 0.12, diameterBottom: 0.12, height: 0.6 },
    scene
  );
  mesh.position.set(x, y, z);
  mesh.isPickable = false; // never let the aim-ray pick a flying bolt
  // Cylinders are built standing up (+Y). Rotate that +Y axis onto the 3D
  // flight direction so the bolt points where it's going, up/down included.
  // (One-time at spawn - projectiles fly straight.)
  const dir = new BABYLON.Vector3(dirX, dirY, dirZ).normalize();
  const axis = BABYLON.Vector3.Cross(BABYLON.Axis.Y, dir);
  if (axis.lengthSquared() < 1e-6) {
    // Direction is (anti)parallel to +Y (a near-vertical shot): no rotation
    // axis; flip 180° if pointing straight down, else leave upright.
    if (dir.y < 0) mesh.rotation.x = Math.PI;
  } else {
    const angle = Math.acos(clamp(BABYLON.Vector3.Dot(BABYLON.Axis.Y, dir), -1, 1));
    mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
  }

  const material = new BABYLON.StandardMaterial('projectileMat', scene);
  material.diffuseColor = BABYLON.Color3.FromHexString(color);
  material.emissiveColor = BABYLON.Color3.FromHexString(color); // glows, so it reads clearly in flight
  mesh.material = material;

  activeProjectiles.push({
    mesh,
    ownerId,
    dirX,
    dirY,
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

// Computes the world-space direction to fire so that the shot goes exactly
// where the screen-center crosshair points - in full 3D, for both first-
// and third-person. THIS is the fix for the old "shots land below the
// crosshair" bug: previously we fired horizontally from the player's chest
// while the camera looked from a different height/angle, so the bolt and
// the crosshair were two different lines that never met. Now we cast a ray
// from the crosshair through the camera, find what it's actually over, and
// aim the muzzle at that point.
function computeAimDirection(muzzle) {
  const cx = canvas.clientWidth / 2;
  const cy = canvas.clientHeight / 2;
  const ray = scene.createPickingRay(cx, cy, BABYLON.Matrix.Identity(), camera);
  // Consider only real, targetable geometry: our own body/gun and in-flight
  // projectiles are non-pickable, so the ray sails through them to whatever
  // we're truly pointing at (ground, cover, an enemy).
  const pick = scene.pickWithRay(ray, (m) => m.isPickable && m.isEnabled() && m.isVisible);
  let point;
  if (pick && pick.hit && pick.pickedPoint) point = pick.pickedPoint;
  else point = ray.origin.add(ray.direction.scale(PROJECTILE_MAX_DISTANCE + 10)); // nothing hit: aim far along the ray
  let dx = point.x - muzzle.x;
  let dy = point.y - muzzle.y;
  let dz = point.z - muzzle.z;
  let len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) { dx = ray.direction.x; dy = ray.direction.y; dz = ray.direction.z; len = Math.hypot(dx, dy, dz) || 1; }
  return { x: dx / len, y: dy / len, z: dz / len };
}

// Nudges an aim direction by a small random cone (hip-fire inaccuracy).
// ADS passes 0, so aiming down sights is pinpoint - a real, earned accuracy
// gain the player can feel.
function applySpread(dir, spread) {
  if (spread <= 0) return dir;
  let yaw = Math.atan2(dir.x, dir.z);
  let pitch = Math.asin(clamp(dir.y, -1, 1));
  yaw += (Math.random() * 2 - 1) * spread;
  pitch += (Math.random() * 2 - 1) * spread;
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
}

let lastFireTime = 0;

function tryFireProjectile() {
  const local = playerAvatars[localPlayerId];
  if (!local) return;

  const now = performance.now();
  if (now - lastFireTime < FIRE_COOLDOWN_MS) return; // still on cooldown
  lastFireTime = now;

  // Muzzle sits at the player, up around chest height, so the bolt visibly
  // leaves the shooter (rides with position.y, so a mid-dash shot starts at
  // the player, not their shadow).
  const muzzle = {
    x: local.mesh.position.x,
    y: local.mesh.position.y + 0.6,
    z: local.mesh.position.z,
  };

  // Crosshair modes aim by "shoot where the crosshair points" (3D). The
  // old top-down stick modes (Squad/Swarm) still aim by facing - they have
  // no centered crosshair, so a camera-ray would point at the ground.
  let dir;
  if (isCrosshairCameraType(currentCameraType)) {
    dir = computeAimDirection(muzzle);
    dir = applySpread(dir, adsActive ? ADS_SPREAD_RAD : HIPFIRE_SPREAD_RAD);
  } else {
    const r = local.mesh.rotation.y;
    dir = { x: Math.sin(r), y: 0, z: Math.cos(r) };
  }

  const spawnOffset = 0.7;
  const shotData = {
    ownerId: localPlayerId,
    x: muzzle.x + dir.x * spawnOffset,
    y: muzzle.y + dir.y * spawnOffset,
    z: muzzle.z + dir.z * spawnOffset,
    dirX: dir.x,
    dirY: dir.y,
    dirZ: dir.z,
    color: local.colorHex,
  };

  // Spawn our own copy immediately (don't wait on a server round-trip -
  // this makes shooting feel instant), then tell the server so it can
  // relay the shot to everyone else.
  spawnProjectile(shotData);
  socket.emit('fire', { x: shotData.x, y: shotData.y, z: shotData.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z });
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
    proj.mesh.position.y += (proj.dirY || 0) * moveDistance; // 3D travel (aimed up/down)
    proj.mesh.position.z += proj.dirZ * moveDistance;
    proj.distanceTraveled += moveDistance;

    let shouldRemove = proj.distanceTraveled >= PROJECTILE_MAX_DISTANCE;

    // A downward shot that reaches the ground stops there (no burrowing).
    if (!shouldRemove && proj.mesh.position.y <= 0.05) shouldRemove = true;

    // Obstacles and border walls stop shots dead - checked FIRST (and on
    // every client identically, since this is static shared geometry with
    // no desync risk), so a shot that reaches a wall the same frame it
    // would have reached a player behind it correctly stops at the wall.
    // Now height-aware: a shot only stops on a box if it's within the box's
    // vertical extent, so you can arc a bolt clean over low cover.
    if (!shouldRemove) {
      const px = proj.mesh.position.x;
      const py = proj.mesh.position.y;
      const pz = proj.mesh.position.z;
      for (const b of obstacleBounds) {
        if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ && py >= b.minY && py <= b.maxY) {
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
        const dy = avatar.mesh.position.y - proj.mesh.position.y;
        // A sliding (ducked) target has a shorter vertical hit window, so a
        // shot at standing height sails over them.
        const vhit = avatar.low ? HIT_VERTICAL_SLIDE : HIT_VERTICAL;
        if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS && Math.abs(dy) < vhit) {
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
          const dy = m.mesh.position.y - proj.mesh.position.y;
          if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS && Math.abs(dy) < HIT_VERTICAL) {
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

// moveWithCollisions but broken into small sub-moves, because a single
// moveWithCollisions call silently clamps to ~0.1u (see MOVE_COLLIDE_SUBSTEP).
// Without this, sprinting and dashing barely move. Walls still block/deflect
// because each sub-move is itself collision-swept.
function moveWithCollisionsSubstepped(mesh, dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return;
  const n = Math.max(1, Math.ceil(len / MOVE_COLLIDE_SUBSTEP));
  const vx = dx / n, vy = dy / n, vz = dz / n;
  for (let i = 0; i < n; i++) mesh.moveWithCollisions(new BABYLON.Vector3(vx, vy, vz));
}

// ----------------------------------------------------------------------------
// VERTICAL MOVEMENT: gravity, standing on boxes, jumping, climbing/mantling
// ----------------------------------------------------------------------------
// Highest surface the player can be resting on at (x,z): the map floor (0)
// or the top of any cover box whose footprint they're over and which is at
// or below their feet (so you land on box tops when you drop onto them).
function groundSupportHeight(x, z, feetY) {
  let support = 0;
  for (const b of obstacleBounds) {
    if (Math.abs(x - b.cx) <= b.halfW + PLAYER_RADIUS && Math.abs(z - b.cz) <= b.halfD + PLAYER_RADIUS) {
      if (b.top <= feetY + LAND_TOLERANCE && b.top > support) support = b.top;
    }
  }
  return support;
}

// Is the player pressing into a climbable ledge? Probes just ahead of the
// player in their movement direction for a box whose top is above the feet
// but within CLIMB_REACH - that's a wall you can mantle. Returns the climb
// descriptor or null.
function findClimbLedge(x, z, feetY, dirX, dirZ) {
  if (dirX === 0 && dirZ === 0) return null;
  const len = Math.hypot(dirX, dirZ) || 1;
  const nx = dirX / len;
  const nz = dirZ / len;
  const probeX = x + nx * (PLAYER_RADIUS + 0.25);
  const probeZ = z + nz * (PLAYER_RADIUS + 0.25);
  let best = null;
  for (const b of obstacleBounds) {
    if (Math.abs(probeX - b.cx) <= b.halfW + 0.05 && Math.abs(probeZ - b.cz) <= b.halfD + 0.05) {
      if (b.top > feetY + CLIMB_MIN_LEDGE && b.top <= feetY + CLIMB_REACH) {
        if (!best || b.top < best.top) best = b; // prefer the lowest climbable ledge
      }
    }
  }
  return best ? { topY: best.top, dirX: nx, dirZ: nz } : null;
}

// Runs one step of the local player's vertical physics: an in-progress
// climb, or gravity + support + jump. `moveX/moveZ` is this frame's WORLD
// movement direction (for detecting a climb into a wall we're pushing on).
function updateVerticalPhysics(local, dt, moveX, moveZ, hasMove) {
  const pos = local.mesh.position;
  // playerFeetY is the source of truth (NOT pos.y - half), so a crouch that
  // changes currentCapsuleHalf never phantom-moves the feet.

  // --- A climb/mantle is under way: scale straight up the wall ---
  if (climbState) {
    playerFeetY += CLIMB_RATE * dt;
    playerVY = 0;
    playerGrounded = false;
    if (playerFeetY >= climbState.topY) {
      // Cleared the lip: hop forward onto the ledge and finish.
      playerFeetY = climbState.topY + 0.02;
      pos.x += climbState.dirX * (PLAYER_RADIUS + 0.3);
      pos.z += climbState.dirZ * (PLAYER_RADIUS + 0.3);
      climbState = null;
      playerGrounded = true;
    }
    pos.y = playerFeetY + currentCapsuleHalf;
    return;
  }

  // --- Start a climb if we're pushing into a reachable ledge ---
  if (hasMove) {
    const ledge = findClimbLedge(pos.x, pos.z, playerFeetY, moveX, moveZ);
    if (ledge) { climbState = ledge; return; }
  }

  // --- Jump ---
  if (jumpQueued) {
    jumpQueued = false;
    if (playerGrounded) { playerVY = JUMP_SPEED; playerGrounded = false; }
  }

  // --- Gravity + landing (all on the FEET) ---
  const support = groundSupportHeight(pos.x, pos.z, playerFeetY);
  playerVY -= GRAVITY * dt;
  let newFeetY = playerFeetY + playerVY * dt;
  if (newFeetY <= support) {
    newFeetY = support;
    playerVY = 0;
    playerGrounded = true;
  } else {
    playerGrounded = false;
  }
  playerFeetY = newFeetY;
  // Center rides above the feet at the current (possibly crouched) height.
  pos.y = playerFeetY + currentCapsuleHalf;
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
  // Effective (possibly toggled) camera type, NOT the static MODE_CONFIG one,
  // so the perspective toggle takes effect for movement space + camera follow.
  const cameraType = currentCameraType;

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
      // Hold left mouse to keep firing (cooldown-limited). This is what makes
      // "hold RMB to aim + hold LMB to fire" stream shots.
      if (pcFireHeld) tryFireProjectile();
      // Crouch (Shift held, not mid-slide): ease the capsule down/up. NOT
      // gated on playerGrounded - the old gate created a feedback loop (the
      // crouch briefly un-grounded the player, which un-crouched them, which
      // re-grounded them...). Now feet stay planted (see updateVerticalPhysics)
      // and the height eases smoothly, so there's nothing to jitter.
      pcCrouching = keysDown['shift'] && !activeDash;
      if (!activeDash) {
        const targetHalf = pcCrouching ? SLIDE_CENTER_Y : CAPSULE_HALF;
        currentCapsuleHalf += (targetHalf - currentCapsuleHalf) * Math.min(1, CROUCH_LERP_SPEED * deltaSeconds);
        local.mesh.scaling.y = currentCapsuleHalf / CAPSULE_HALF; // 1 standing, 0.5 fully crouched
      }
    } else if (inputType === 'gamepad') {
      const gp = readGamepadState();
      moveX = gp.moveX;
      moveZ = gp.moveZ;
      adsActive = gp.adsHeld; // left trigger held = aim down sights
      const adsF = adsActive ? ADS_SENS_FACTOR : 1;
      // Rate-based dual-axis aim (standard console-shooter feel): the right
      // stick's horizontal deflection is a TURN rate and its vertical is a
      // LOOK rate, integrated into yaw/pitch each frame. (Replaces the old
      // "point the stick at a compass heading" scheme, which left no axis
      // free for up/down look.)
      gamepadAimYaw += gp.aimX * GAMEPAD_YAW_RATE * sensitivityMultiplier * adsF * deltaSeconds;
      aimPitch = clamp(aimPitch + gp.aimY * GAMEPAD_PITCH_RATE * sensitivityMultiplier * adsF * deltaSeconds, AIM_PITCH_MIN, AIM_PITCH_MAX);
      if (gp.firePressed && !gamepadFireWasHeld) tryFireProjectile();
      gamepadFireWasHeld = gp.firePressed;
      // Y/Triangle toggles first/third person (edge-detected so one press =
      // one toggle, not a flicker every frame it's held).
      if (gp.perspPressed && !gamepadPerspWasHeld) togglePerspective();
      gamepadPerspWasHeld = gp.perspPressed;

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
      // Firing is on aim-stick release now (no separate fire button).
    }

    // Movement space depends on the camera:
    //   - First-person AND chase cameras rotate with your facing, so
    //     "forward" must mean "the way I'm looking" - world-space input
    //     under a rotating camera feels completely broken (pressing
    //     forward would walk you sideways across the screen).
    //   - Fixed-angle cameras (top-down Squad) keep world-space compass
    //     movement: the screen never rotates, so up-on-the-stick = up-on-
    //     the-screen already holds without any transform.
    if (activeDash) {
      // A dash is playing back (mobile Drift Deck, or a PC slide): it owns
      // movement this frame (horizontal AND vertical). Stick/key movement is
      // ignored until it lands, but aiming (below) and firing stay live -
      // tracking a target WHILE the dash animates is the whole point.
      stepActiveDash(deltaSeconds, local);
    } else {
      // Normal movement: horizontal via moveWithCollisions (slides along
      // cover), vertical via updateVerticalPhysics (gravity/jump/climb).
      let worldMoveX = 0;
      let worldMoveZ = 0;
      const hasMove = moveX !== 0 || moveZ !== 0;
      if (hasMove) {
        const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
        const normX = moveX / length;
        const normZ = moveZ / length;

        worldMoveX = normX;
        worldMoveZ = normZ;
        if (cameraType === 'first-person' || cameraType === 'third-person-chase') {
          const yaw = local.mesh.rotation.y;
          const sin = Math.sin(yaw);
          const cos = Math.cos(yaw);
          worldMoveX = normX * cos + normZ * sin;
          worldMoveZ = -normX * sin + normZ * cos;
        }

        // PC speed modifiers: hold F to sprint, Shift to crouch (slower).
        let speedMul = 1;
        if (currentMode === 'pc') {
          if (keysDown['f']) speedMul *= SPRINT_MULTIPLIER;
          if (pcCrouching) speedMul *= CROUCH_MOVE_FACTOR;
        }

        // Sweeps the capsule ellipsoid against every checkCollisions mesh
        // and SLIDES along surfaces. Sub-stepped so sprint speed isn't capped
        // by moveWithCollisions' per-call clamp. Skipped while mid-climb
        // (updateVerticalPhysics hugs the wall going up instead).
        if (!climbState) {
          moveWithCollisionsSubstepped(
            local.mesh,
            worldMoveX * MOVE_SPEED * speedMul * deltaSeconds,
            0,
            worldMoveZ * MOVE_SPEED * speedMul * deltaSeconds
          );
        }
      }

      // Gravity, standing on box tops, jumping, and climbing onto ledges.
      updateVerticalPhysics(local, deltaSeconds, worldMoveX, worldMoveZ, hasMove);
    }

    // Hard arena clamp: no matter what (a fast dash into a corner, a climb,
    // physics jitter), the player can never end up outside the border walls.
    // This is the belt-and-suspenders fix for dashes clipping through the
    // thin border wall.
    const arenaBound = MAP_HALF - 1;
    local.mesh.position.x = clamp(local.mesh.position.x, -arenaBound, arenaBound);
    local.mesh.position.z = clamp(local.mesh.position.z, -arenaBound, arenaBound);

    // --- Aiming: apply whichever yaw source this mode uses ---
    if (inputType === 'keyboard-mouse') {
      local.mesh.rotation.y = pcAimYaw;
    } else if (inputType === 'gamepad') {
      local.mesh.rotation.y = gamepadAimYaw;
    } else if (inputType === 'touch-dual') {
      // Right stick: horizontal deflection = turn (yaw) RATE, vertical =
      // look (pitch) RATE, both integrated each frame. A DYNAMIC expo curve
      // (aimExpo) makes the stick very steady near the center for fine combat
      // aim and ramp up fast out at the edge for quick turns. While the stick
      // is held we're aiming down sights, so look is also slowed for fine aim.
      const adsF = adsActive ? ADS_SENS_FACTOR : 1;
      touchAimYaw += aimExpo(dualTurnX) * DUAL_TURN_MAX_RATE * sensitivityMultiplier * adsF * deltaSeconds;
      aimPitch = clamp(
        aimPitch + aimExpo(dualTurnY) * DUAL_PITCH_MAX_RATE * TOUCH_LOOK_PITCH_FACTOR * sensitivityMultiplier * adsF * deltaSeconds,
        AIM_PITCH_MIN, AIM_PITCH_MAX
      );
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
      // Eye sits above the feet, scaled down when crouched so ducking
      // actually lowers your view. feet = center - currentCapsuleHalf.
      camera.position.y = (local.mesh.position.y - currentCapsuleHalf) + EYE_HEIGHT * (currentCapsuleHalf / CAPSULE_HALF);
      camera.position.z = local.mesh.position.z;
      camera.rotation.y = local.mesh.rotation.y;
      // Look up/down. Babylon's UniversalCamera pitches with +rotation.x =
      // looking DOWN, so negate our "up-positive" aimPitch.
      camera.rotation.x = -aimPitch;
    } else {
      // Both third-person variants and the top-down camera share the same
      // position-follow behavior (glide the ORBIT TARGET toward the
      // player, not the camera itself, since these are all ArcRotateCameras).
      const lerpFactor = Math.min(1, CAMERA_LERP_SPEED * deltaSeconds);
      camera.target.x += (local.mesh.position.x - camera.target.x) * lerpFactor;
      camera.target.z += (local.mesh.position.z - camera.target.z) * lerpFactor;
      // Follow the player's height too, so jumping/climbing onto a box keeps
      // them framed (aim at ~mid-capsule, hence the +0.1 above feet-center).
      camera.target.y += ((local.mesh.position.y + 0.1) - camera.target.y) * lerpFactor;

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

        // Look up/down: aimPitch swings the orbit's BETA (elevation) within
        // a floor-safe band. The camera keeps looking at the player, so a
        // higher beta drops the camera lower and tilts the whole view up.
        // Firing accuracy doesn't hinge on the exact tilt - shots follow
        // the real crosshair ray (computeAimDirection) - so this only has
        // to feel right, not be geometrically perfect.
        const targetBeta = clamp(TP_BASE_BETA + aimPitch * TP_PITCH_TO_BETA, TP_BETA_MIN, TP_BETA_MAX);
        camera.beta += (targetBeta - camera.beta) * rotLerpFactor;
      }
    }

    // Aim-down-sights zoom: ease the field of view toward the ADS or hip-fire
    // value. adsActive is only ever set true by crosshair modes, and the
    // hip-fire value equals Babylon's default, so this is a no-op for the
    // top-down stick modes.
    const targetFov = adsActive ? ADS_FOV : HIPFIRE_FOV;
    camera.fov += (targetFov - camera.fov) * Math.min(1, FOV_LERP_SPEED * deltaSeconds);

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
  gamepadPerspWasHeld = false;

  // --- Shared aim (pitch + ADS) ---
  aimPitch = 0;
  adsActive = false;

  // --- Vertical physics ---
  playerVY = 0;
  playerFeetY = 0;
  playerGrounded = true;
  jumpQueued = false;
  climbState = null;
  pcFireHeld = false;
  pcCrouching = false;
  currentCapsuleHalf = CAPSULE_HALF;

  // --- Mobile dual-stick / Drift Deck state ---
  dualMoveTouchId = null;
  dualMoveX = 0;
  dualMoveZ = 0;
  dualAimTouchId = null;
  dualTurnX = 0;
  dualTurnY = 0;
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
  perspectiveToggleBtnEl.style.display = 'none';
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('hudHealthBar').style.display = 'none';
  document.getElementById('inGameMenu').style.display = 'none';
  document.getElementById('orientationLockOverlay').classList.remove('mobile-active');

  // --- Network send throttle ---
  lastSentX = null;
  lastSentY = null;
  lastSentLow = false;
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
  // Effective camera type starts at the mode's default. Console & Mobile
  // default to third-person (so you can watch your own dashes/movement) and
  // can toggle to first-person; PC stays first-person; the rest never change.
  currentCameraType = MODE_CONFIG[mode].cameraType;
  aimPitch = 0;
  adsActive = false;

  document.getElementById('joinScreen').style.display = 'none';
  respawnCountdownEl.style.display = 'none';
  if (MODE_CONFIG[mode].inputType === 'touch-dual') {
    // The current mobile design: both sticks (shown at rest) + the Drift Deck.
    // Firing is release-the-aim-stick; there is no separate fire button.
    touchHintEl.innerHTML = 'left: move &nbsp;|&nbsp; right: aim, release to fire<br/>draw in the Drift Deck to dash';
    touchHintEl.style.display = 'block';
    gestureZoneEl.style.display = 'block';
    homeMoveStick(); // both sticks visible at their home positions
    homeAimStick();
    syncGestureCanvasSize(); // the Drift Deck only has a real size once visible
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

  // Crosshair for every mode where the camera looks along your aim and you
  // shoot toward screen center (PC, Console, Mobile, Solo FPS/TPS). Top-down
  // stick modes aim with sticks/taps instead - they get ground reticles, not
  // a screen-center dot that would point at nothing meaningful.
  document.getElementById('crosshair').style.display =
    isCrosshairCameraType(currentCameraType) ? 'block' : 'none';

  // Perspective-toggle button: only Console & Mobile can switch first/third
  // person (PC is locked first-person this session). Console toggles with a
  // gamepad button; Mobile needs an on-screen button.
  perspectiveToggleBtnEl.style.display = (mode === 'mobile') ? 'block' : 'none';

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

  camera = createCameraForMode(mode, currentCameraType);
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
