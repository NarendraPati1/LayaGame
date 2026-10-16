/**
 * LAYA ARENA — Top-Down Neural Shooter
 * Player: WASD + mouse aim + left-click shoot + R to reload
 * Laya AI: Neural model on CUDA GPU — sees only game state, NOT player HP/ammo
 */

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');
const W = canvas.width;   // 860
const H = canvas.height;  // 600

// ─── Procedural Dynamic Cover Box Generation ─────────────────────────────────
let WALLS = [];
const TILE_COLS = 20;
const TILE_ROWS = 12;

function generateRandomMap() {
  WALLS = [];
  const colW = W / TILE_COLS; // 70px
  const rowH = H / TILE_ROWS; // ~66.6px

  const occupied = Array.from({ length: TILE_ROWS }, () => Array(TILE_COLS).fill(false));

  // Protect Player spawn zone (left side)
  for (let r = 3; r <= 8; r++) {
    for (let c = 0; c <= 3; c++) occupied[r][c] = true;
  }
  // Protect Laya spawn zone (right side)
  for (let r = 3; r <= 8; r++) {
    for (let c = 16; c <= 19; c++) occupied[r][c] = true;
  }
  // Keep outer perimeter rows clear for perimeter flank lanes
  for (let c = 0; c < TILE_COLS; c++) {
    occupied[0][c] = true;
    occupied[TILE_ROWS - 1][c] = true;
  }

  // Cover archetypes: single crates, wide barriers, tall barricades, bunkers
  const archetypes = [
    { w: 1, h: 1, prob: 0.35 },
    { w: 2, h: 1, prob: 0.30 },
    { w: 1, h: 2, prob: 0.25 },
    { w: 2, h: 2, prob: 0.10 }
  ];

  const targetBoxCount = 13 + Math.floor(Math.random() * 5); // 13-17 cover structures
  let placed = 0;
  let attempts = 0;

  while (placed < targetBoxCount && attempts < 160) {
    attempts++;
    const startCol = 3 + Math.floor(Math.random() * 14);
    const startRow = 1 + Math.floor(Math.random() * 10);

    const rand = Math.random();
    let arch = archetypes[0];
    let cum = 0;
    for (const a of archetypes) {
      cum += a.prob;
      if (rand <= cum) { arch = a; break; }
    }

    if (startCol + arch.w > 17 || startRow + arch.h > 11) continue;

    let canPlace = true;
    for (let r = 0; r < arch.h; r++) {
      for (let c = 0; c < arch.w; c++) {
        if (occupied[startRow + r][startCol + c]) { canPlace = false; break; }
      }
      if (!canPlace) break;
    }

    if (canPlace) {
      // Mark cells as occupied + 1-cell buffer on edges to preserve passageways
      for (let dr = -1; dr <= arch.h; dr++) {
        for (let dc = -1; dc <= arch.w; dc++) {
          const nr = startRow + dr, nc = startCol + dc;
          if (nr >= 0 && nr < TILE_ROWS && nc >= 0 && nc < TILE_COLS) {
            occupied[nr][nc] = true;
          }
        }
      }

      const padX = 6, padY = 6;
      WALLS.push({
        x: startCol * colW + padX,
        y: startRow * rowH + padY,
        w: arch.w * colW - (padX * 2),
        h: arch.h * rowH - (padY * 2)
      });
      placed++;
    }
  }

  // Ensure central combat cover is present
  const hasCenter = WALLS.some(w => w.x > W * 0.38 && w.x < W * 0.62 && w.y > H * 0.3 && w.y < H * 0.7);
  if (!hasCenter) {
    WALLS.push({
      x: W * 0.5 - 45,
      y: H * 0.5 - 45,
      w: 90,
      h: 90
    });
  }
}

// ─── Player Radius & Speed ────────────────────────────────────────────────────
const P_RAD = 14;   // player circle radius
const P_SPEED = 3.6;  // px per frame (scaled for 1400x800 arena)
const MAX_HP = 100;
const MAX_AMMO = 30;
const BULLET_SPEED = 10; // scaled for 1400x800 arena
const RELOAD_FRAMES = 100; // ~1.6s at 60fps
const PLAYER_SHOOT_COOLDOWN = 14;  // frames between player shots
const BULLET_DAMAGE = 8;

// ─── Sound (Web Audio) ───────────────────────────────────────────────────────
let audioCtx = null;
let soundOn = true;

function initAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function playGunshot(pitch = 1.0) {
  if (!soundOn || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filt = audioCtx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);

    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(900, t);

    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(filt);
    filt.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch (e) { }
}

function playImpact() {
  if (!soundOn || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.15);
    gain.gain.setValueAtTime(0.26, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  } catch (e) { }
}

function playReload() {
  if (!soundOn || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.setValueAtTime(300, t + 0.12);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  } catch (e) { }
}

function toggleAudio() {
  initAudio();
  soundOn = !soundOn;
  const btn = document.getElementById('sound-btn');
  if (btn) btn.innerText = soundOn ? '🔊 SOUND: ON' : '🔇 SOUND: OFF';
}

// ─── Game State ───────────────────────────────────────────────────────────────
let playerPos = { x: 120, y: H / 2 };
let layaPos = { x: W - 120, y: H / 2 };

let playerVel = { x: 0, y: 0 };
let layaVel = { x: 0, y: 0 };

let playerAngle = 0; // facing right
let layaAngle = Math.PI; // facing left

let playerHp = MAX_HP, playerGhostHp = MAX_HP;
let layaHp = MAX_HP, layaGhostHp = MAX_HP;

let playerAmmo = MAX_AMMO;
let layaAmmo = MAX_AMMO;

let playerReloading = 0;  // frames left in reload animation
let layaReloading = 0;

let playerShootCooldown = 0;
let layaShootCooldown = 0;

let bullets = []; // {x,y,vx,vy,owner:'player'|'laya'}
let hitFx = []; // {x,y,life}
let screenShake = 0;

let gameOver = false;
let winner = '';
let gameTime = 0; // seconds
let frameCount = 0;

// ─── Input ────────────────────────────────────────────────────────────────────
const keys = {};
let mouseX = W / 2, mouseY = H / 2;

window.addEventListener('keydown', e => {
  initAudio();
  keys[e.code] = true;
  if (e.code === 'KeyR' && !gameOver) startReload('player');
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (W / rect.width);
  mouseY = (e.clientY - rect.top) * (H / rect.height);
});

canvas.addEventListener('mousedown', e => {
  initAudio();
  if (e.button === 0 && !gameOver) playerShoot();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ─── Collision helpers ────────────────────────────────────────────────────────
function rectCircleCollide(rx, ry, rw, rh, cx, cy, cr) {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX, dy = cy - nearY;
  return dx * dx + dy * dy < cr * cr;
}

function circleAABBResolve(pos, vel, rad) {
  for (const w of WALLS) {
    if (rectCircleCollide(w.x, w.y, w.w, w.h, pos.x, pos.y, rad)) {
      // Push out: clamp on nearest axis
      const overlapLeft = (pos.x + rad) - w.x;
      const overlapRight = (w.x + w.w) - (pos.x - rad);
      const overlapTop = (pos.y + rad) - w.y;
      const overlapBot = (w.y + w.h) - (pos.y - rad);

      const minX = Math.min(overlapLeft, overlapRight);
      const minY = Math.min(overlapTop, overlapBot);

      if (minX < minY) {
        if (overlapLeft < overlapRight) pos.x = w.x - rad;
        else pos.x = w.x + w.w + rad;
        vel.x = 0;
      } else {
        if (overlapTop < overlapBot) pos.y = w.y - rad;
        else pos.y = w.y + w.h + rad;
        vel.y = 0;
      }
    }
  }
}

function bulletHitsWall(bx, by) {
  for (const w of WALLS) {
    if (bx >= w.x && bx <= w.x + w.w && by >= w.y && by <= w.y + w.h) return true;
  }
  return false;
}

function isInCover(pos) {
  for (const w of WALLS) {
    const pad = P_RAD + 20;
    if (pos.x > w.x - pad && pos.x < w.x + w.w + pad &&
      pos.y > w.y - pad && pos.y < w.y + w.h + pad) return true;
  }
  return false;
}

// ─── Tactical Cover Positioning ───────────────────────────────────────────────
// Finds the optimal cover spot behind a solid crate that breaks LOS to the threat.
function getBestCoverPosition(fromPos, threatPos) {
  let bestPos = null;
  let bestScore = -Infinity;

  for (const w of WALLS) {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;

    // Vector from threat to crate center
    const dx = cx - threatPos.x;
    const dy = cy - threatPos.y;
    const dLen = Math.hypot(dx, dy) || 1;

    // Safe side is directly behind the crate facing away from the threat
    const safeX = cx + (dx / dLen) * (Math.max(w.w, w.h) * 0.5 + P_RAD + 14);
    const safeY = cy + (dy / dLen) * (Math.max(w.w, w.h) * 0.5 + P_RAD + 14);

    const clampedX = Math.max(P_RAD + 20, Math.min(W - P_RAD - 20, safeX));
    const clampedY = Math.max(P_RAD + 20, Math.min(H - P_RAD - 20, safeY));

    // Distance from fighter to this cover position
    const distToMe = Math.hypot(clampedX - fromPos.x, clampedY - fromPos.y);

    // Verify this spot actually blocks line of sight to threat
    const breaksLOS = !hasLineOfSight(clampedX, clampedY, threatPos.x, threatPos.y);

    let score = -distToMe;
    if (breaksLOS) score += 350;

    if (score > bestScore) {
      bestScore = score;
      bestPos = { x: clampedX, y: clampedY };
    }
  }

  return bestPos || { x: W - 140, y: H / 2 };
}

// ─── Ray-cast Line-of-Sight (Laya cannot see through walls) ─────────────────
// Casts a ray from (ax,ay) to (bx,by) and returns true if no wall blocks it.
// Uses parametric segment-box intersection with insets so standing next to a crate never false-blocks.
function hasLineOfSight(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist <= (P_RAD + 2) * 2) return true; // point blank is visible

  const ux = dx / dist, uy = dy / dist;
  const startT = P_RAD + 2;
  const endT = dist - (P_RAD + 2);
  if (startT >= endT) return true;

  for (const w of WALLS) {
    const wx1 = w.x + 1, wx2 = w.x + w.w - 1;
    const wy1 = w.y + 1, wy2 = w.y + w.h - 1;

    let tNearX, tFarX;
    if (Math.abs(ux) < 1e-9) {
      if (ax < wx1 || ax > wx2) continue;
      tNearX = -Infinity; tFarX = Infinity;
    } else {
      let t1 = (wx1 - ax) / ux;
      let t2 = (wx2 - ax) / ux;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tNearX = t1; tFarX = t2;
    }

    let tNearY, tFarY;
    if (Math.abs(uy) < 1e-9) {
      if (ay < wy1 || ay > wy2) continue;
      tNearY = -Infinity; tFarY = Infinity;
    } else {
      let t1 = (wy1 - ay) / uy;
      let t2 = (wy2 - ay) / uy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tNearY = t1; tFarY = t2;
    }

    const tEnter = Math.max(tNearX, tNearY);
    const tExit = Math.min(tFarX, tFarY);

    if (tEnter < tExit && tExit > startT && tEnter < endT) {
      return false; // crate blocks ray
    }
  }
  return true;
}

// ─── Obstacle Avoidance Steering (Laya navigates smoothly around crates) ─────
function getSteeredVelocity(fromPos, targetPos, speed) {
  const dx = targetPos.x - fromPos.x;
  const dy = targetPos.y - fromPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 6) return { x: 0, y: 0 };

  const directAngle = Math.atan2(dy, dx);

  function isBlocked(angle, step = 36) {
    const tx = fromPos.x + Math.cos(angle) * step;
    const ty = fromPos.y + Math.sin(angle) * step;
    if (tx < P_RAD || tx > W - P_RAD || ty < P_RAD || ty > H - P_RAD) return true;
    for (const w of WALLS) {
      if (rectCircleCollide(w.x, w.y, w.w, w.h, tx, ty, P_RAD + 2)) return true;
    }
    return false;
  }

  // 1. Direct path open
  if (!isBlocked(directAngle)) {
    return { x: Math.cos(directAngle) * speed, y: Math.sin(directAngle) * speed };
  }

  // 2. Steer around obstacle by checking alternative angles
  const offsets = [0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0];
  for (const off of offsets) {
    const testA = directAngle + off;
    if (!isBlocked(testA)) {
      return { x: Math.cos(testA) * speed, y: Math.sin(testA) * speed };
    }
  }

  return { x: Math.cos(directAngle + Math.PI / 2) * speed * 0.5, y: Math.sin(directAngle + Math.PI / 2) * speed * 0.5 };
}

// ─── Shooting ─────────────────────────────────────────────────────────────────
function playerShoot() {
  if (playerAmmo <= 0 || playerReloading > 0 || playerShootCooldown > 0) return;
  const angle = Math.atan2(mouseY - playerPos.y, mouseX - playerPos.x);
  spawnBullet(playerPos.x, playerPos.y, angle, 'player');
  playerAmmo--;
  playerShootCooldown = PLAYER_SHOOT_COOLDOWN;
  playGunshot(1.0);

  // Realistic acoustic awareness: if Laya doesn't have LOS, she hears gunshot direction with human-like sound dispersion
  if (layaHasLOS) {
    lastKnownPlayerPos = { x: playerPos.x, y: playerPos.y };
  } else {
    // Acoustic sound estimation: realistic angular error (±12 deg) and distance uncertainty
    const directAngle = Math.atan2(playerPos.y - layaPos.y, playerPos.x - layaPos.x);
    const soundErrorAngle = directAngle + (Math.random() - 0.5) * 0.42;
    const trueDist = Math.hypot(playerPos.x - layaPos.x, playerPos.y - layaPos.y);
    const estDist = Math.max(100, trueDist + (Math.random() - 0.5) * 180);
    const heardX = Math.max(P_RAD + 20, Math.min(W - P_RAD - 20, layaPos.x + Math.cos(soundErrorAngle) * estDist));
    const heardY = Math.max(P_RAD + 20, Math.min(H - P_RAD - 20, layaPos.y + Math.sin(soundErrorAngle) * estDist));

    lastKnownPlayerPos = { x: heardX, y: heardY };
    layaSearchPos = { x: heardX, y: heardY };
    layaLostSightTimer = 0;
    // Turn towards gunshot sound gradually
    layaFacingAngle = soundErrorAngle;
  }

  if (playerAmmo <= 0) startReload('player');
}

function layaShoot(targetX, targetY, blind = false) {
  // blind = true when Laya is firing suppressive shots without LOS
  if (layaAmmo <= 0 || layaReloading > 0 || layaShootCooldown > 0) return;
  const baseAngle = Math.atan2(targetY - layaPos.y, targetX - layaPos.x);
  // Wider spread when shooting blind (no LOS), tight when has clear sight
  const spread = blind
    ? (Math.random() - 0.5) * 0.65   // big arc — suppressive fire only
    : (Math.random() - 0.5) * 0.14;  // narrow — aimed shot with LOS
  spawnBullet(layaPos.x, layaPos.y, baseAngle + spread, 'laya');
  layaAmmo--;
  layaShootCooldown = blind ? 30 : 22;  // slower when blind
  playGunshot(1.15);
  if (layaAmmo <= 0) startReload('laya');
}

function spawnBullet(x, y, angle, owner) {
  bullets.push({
    x: x + Math.cos(angle) * (P_RAD + 4),
    y: y + Math.sin(angle) * (P_RAD + 4),
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    owner,
    life: 120
  });
}

function startReload(who) {
  if (who === 'player') {
    if (playerReloading > 0 || playerAmmo === MAX_AMMO) return;
    playerReloading = RELOAD_FRAMES;
    playReload();
  } else {
    if (layaReloading > 0 || layaAmmo === MAX_AMMO) return;
    layaReloading = RELOAD_FRAMES;
  }
}

// ─── Laya Neural AI ───────────────────────────────────────────────────────────
let aiProfile = {
  stance: 'aggressive_push',
  action: 'shoot',
  aggression: 0.65,
  should_shoot: true,
  burst: false,
  confidence: 0.8,
  device: 'cuda'
};

let aiQueryActive = false;
let lastAiQueryTime = 0;

// ─── Laya's "Memory" of last known player position ───────────────────────────
// She ONLY gets updated when she has real line-of-sight to the player.
// If you hide behind a crate, she remembers where you WERE, not where you ARE.
let lastKnownPlayerPos = { x: 120, y: H / 2 };   // where she last saw you
let layaHasLOS = false;   // does Laya currently see the player?
let layaLostSightTimer = 0;       // how many frames since she lost LOS (she searches)
let layaSearchPos = null;    // position she's moving to while searching
let layaFacingAngle = Math.PI; // smoothed facing angle

async function queryNeuralBrain() {
  if (aiQueryActive || gameOver) return;
  aiQueryActive = true;

  // Laya's neural model only gets observable game state.
  // Distance and cover status are visible; player HP/ammo are NOT shared.
  const gameState = {
    dist_to_player: Math.hypot(lastKnownPlayerPos.x - layaPos.x,
      lastKnownPlayerPos.y - layaPos.y),
    player_in_cover: !layaHasLOS,           // if no LOS, player is likely in cover
    laya_in_cover: isInCover(layaPos),
    laya_hp: layaHp,
    laya_ammo: layaAmmo,
    bullets_in_air: bullets.filter(b => b.owner === 'player').length,
    game_time: gameTime,
  };

  try {
    const res = await fetch('/api/ai_decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gameState)
    });
    if (res.ok) {
      const data = await res.json();
      aiProfile = data;
      updateTelemetry();
    }
  } catch (e) { /* offline fallback */ }
  finally { aiQueryActive = false; }
}

// ─── Laya Real-Time Behaviour (60 FPS) with LOS-Aware Vision ─────────────────
function processLayaAI() {
  if (gameOver) return;

  const now = performance.now();

  // ── Update Line-of-Sight from Laya's perspective ─────────────────────────
  const losCheck = hasLineOfSight(layaPos.x, layaPos.y, playerPos.x, playerPos.y);
  const losChanged = (losCheck !== layaHasLOS);

  if (losCheck) {
    // Laya sees player directly → update memory
    layaHasLOS = true;
    layaLostSightTimer = 0;
    lastKnownPlayerPos = { x: playerPos.x, y: playerPos.y };
    layaSearchPos = null;
  } else {
    // Player broke LOS behind cover
    layaHasLOS = false;
    layaLostSightTimer++;

    // Refresh search target every 2.5s (150 frames) so Laya actively hunts instead of looping same spot
    if (layaLostSightTimer > 90 && (!layaSearchPos || layaLostSightTimer % 150 === 0)) {
      layaSearchPos = {
        x: Math.max(P_RAD + 30, Math.min(W - P_RAD - 30, lastKnownPlayerPos.x + (Math.random() - 0.5) * 200)),
        y: Math.max(P_RAD + 30, Math.min(H - P_RAD - 30, lastKnownPlayerPos.y + (Math.random() - 0.5) * 200)),
      };
    }
  }

  // ── Reactive Neural Queries ──────────────────────────────────────────────
  // Query every ~1.8s, or instantly on key tactical events (LOS change, out of ammo)
  const needsImmediateQuery = (losChanged || (layaAmmo <= 4 && aiProfile.action !== 'reload')) && (now - lastAiQueryTime > 400);
  if ((now - lastAiQueryTime > 1800) || needsImmediateQuery) {
    lastAiQueryTime = now;
    queryNeuralBrain();
  }

  // ── Neural Action: Reload ────────────────────────────────────────────────
  if ((aiProfile.action === 'reload' || layaAmmo <= 4) && layaReloading === 0 && layaAmmo < MAX_AMMO) {
    startReload('laya');
  }

  const aggrSpeed = 2.8 * (aiProfile.aggression || 0.6);
  const threatPos = layaHasLOS ? playerPos : lastKnownPlayerPos;
  const dist = Math.hypot(threatPos.x - layaPos.x, threatPos.y - layaPos.y);

  // ── Tactical Stance Movement ─────────────────────────────────────────────
  // isRetreating is strictly driven by defensive_reposition — aggressive or flanking stances never retreat
  const isRetreating = (aiProfile.stance === 'defensive_reposition');

  if (isRetreating) {
    // Seek cover only briefly (for reload); then neural model will switch stance back
    const coverSpot = getBestCoverPosition(layaPos, threatPos);
    const vel = getSteeredVelocity(layaPos, coverSpot, 2.7);
    layaVel.x = vel.x;
    layaVel.y = vel.y;

  } else if (aiProfile.stance === 'flank_and_outposition') {
    // Flank: maneuver laterally around crates to break the opponent's cover angle
    const strafeSign = (Math.floor(now / 1600) % 2 === 0) ? 1 : -1;
    const perp = { x: -(threatPos.y - layaPos.y), y: (threatPos.x - layaPos.x) };
    const pLen = Math.hypot(perp.x, perp.y) || 1;
    const flankDist = layaHasLOS ? 220 : 280;
    const flankTarget = {
      x: threatPos.x + (perp.x / pLen) * flankDist * strafeSign,
      y: threatPos.y + (perp.y / pLen) * flankDist * strafeSign
    };
    flankTarget.x = Math.max(P_RAD + 20, Math.min(W - P_RAD - 20, flankTarget.x));
    flankTarget.y = Math.max(P_RAD + 20, Math.min(H - P_RAD - 20, flankTarget.y));
    const vel = getSteeredVelocity(layaPos, flankTarget, aggrSpeed);
    layaVel.x = vel.x;
    layaVel.y = vel.y;

  } else if (aiProfile.stance === 'aggressive_push') {
    if (layaHasLOS) {
      if (dist > 200) {
        // Close distance using steered pathfinding
        const vel = getSteeredVelocity(layaPos, playerPos, aggrSpeed);
        layaVel.x = vel.x;
        layaVel.y = vel.y;
      } else {
        // Close combat: strafe around player
        const strafeSign = Math.sin(now * 0.002) > 0 ? 1 : -1;
        const perp = { x: -(playerPos.y - layaPos.y), y: (playerPos.x - layaPos.x) };
        const pLen = Math.hypot(perp.x, perp.y) || 1;
        const strafeTarget = {
          x: layaPos.x + (perp.x / pLen) * 90 * strafeSign,
          y: layaPos.y + (perp.y / pLen) * 90 * strafeSign
        };
        const vel = getSteeredVelocity(layaPos, strafeTarget, aggrSpeed * 0.85);
        layaVel.x = vel.x;
        layaVel.y = vel.y;
      }
    } else {
      // Advance toward last known position while navigating around crates
      const dest = layaSearchPos || lastKnownPlayerPos;
      const vel = getSteeredVelocity(layaPos, dest, aggrSpeed * 0.75);
      layaVel.x = vel.x;
      layaVel.y = vel.y;
    }

  } else { // suppressive_fire
    // Advance slowly or hold position while maintaining fire lane
    const vel = getSteeredVelocity(layaPos, threatPos, 1.2);
    layaVel.x = vel.x * 0.6;
    layaVel.y = vel.y * 0.6;
  }

  // Handle evasive strafing actions
  if (aiProfile.action === 'strafe_left') {
    const perp = { x: (threatPos.y - layaPos.y), y: -(threatPos.x - layaPos.x) };
    const pLen = Math.hypot(perp.x, perp.y) || 1;
    layaVel.x += (perp.x / pLen) * 1.5;
    layaVel.y += (perp.y / pLen) * 1.5;
  } else if (aiProfile.action === 'strafe_right') {
    const perp = { x: -(threatPos.y - layaPos.y), y: (threatPos.x - layaPos.x) };
    const pLen = Math.hypot(perp.x, perp.y) || 1;
    layaVel.x += (perp.x / pLen) * 1.5;
    layaVel.y += (perp.y / pLen) * 1.5;
  }

  // Facing angle update
  if (layaHasLOS) {
    const targetAngle = Math.atan2(playerPos.y - layaPos.y, playerPos.x - layaPos.x);
    const angleDiff = ((targetAngle - layaFacingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    layaFacingAngle += angleDiff * 0.22;
    layaAngle = layaFacingAngle;
  } else if (Math.hypot(layaVel.x, layaVel.y) > 0.4) {
    const moveAngle = Math.atan2(layaVel.y, layaVel.x);
    const angleDiff = ((moveAngle - layaFacingAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    layaFacingAngle += angleDiff * 0.16;
    layaAngle = layaFacingAngle;
  }

  // Clamp speed
  const spd = Math.hypot(layaVel.x, layaVel.y);
  if (spd > 3.3) { layaVel.x *= 3.3 / spd; layaVel.y *= 3.3 / spd; }

  // ── Shooting Logic (accurate when LOS, suppressive when enemy behind cover) ─
  if (layaShootCooldown === 0 && layaReloading === 0 && aiProfile.should_shoot) {
    if (layaHasLOS) {
      if (dist < 650) {
        if (aiProfile.burst) {
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              if (!gameOver && layaHasLOS && layaReloading === 0) {
                layaShoot(playerPos.x, playerPos.y, false);
              }
            }, i * 130);
          }
        } else {
          layaShoot(playerPos.x, playerPos.y, false);
        }
      }
    } else if (aiProfile.stance === 'suppressive_fire' && dist < 600 && Math.random() < 0.05) {
      // Lay down suppressive fire around the crate the player is hiding behind
      layaShoot(lastKnownPlayerPos.x, lastKnownPlayerPos.y, true);
    } else if (layaLostSightTimer < 90 && Math.random() < 0.02) {
      layaShoot(lastKnownPlayerPos.x, lastKnownPlayerPos.y, true);
    }
  }
}

// ─── Background Tile Rendering ───────────────────────────────────────────────
const FLOOR_A = '#10131a';
const FLOOR_B = '#0d1016';

function drawMap() {
  // Tiled floor
  const tw = W / TILE_COLS;
  const th = H / TILE_ROWS;
  for (let r = 0; r < TILE_ROWS; r++) {
    for (let c = 0; c < TILE_COLS; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? FLOOR_A : FLOOR_B;
      ctx.fillRect(c * tw, r * th, tw, th);
    }
  }

  // Subtle tactical floor grid
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= TILE_COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * tw, 0); ctx.lineTo(c * tw, H); ctx.stroke();
  }
  for (let r = 0; r <= TILE_ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * th); ctx.lineTo(W, r * th); ctx.stroke();
  }

  // Draw each cover box with a top-lit 3D crate look
  for (const w of WALLS) {
    // Shadow behind crate
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(w.x + 6, w.y + 6, w.w, w.h);

    // Crate face
    ctx.fillStyle = '#3d2b1a';
    ctx.fillRect(w.x, w.y, w.w, w.h);

    // Top highlight
    ctx.fillStyle = '#5a3f24';
    ctx.fillRect(w.x, w.y, w.w, 10);

    // Left highlight
    ctx.fillStyle = '#4a3420';
    ctx.fillRect(w.x, w.y, 8, w.h);

    // Cross lines on crate face
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(w.x + 4, w.y + 4, w.w - 8, w.h - 8);

    // Horizontal plank line
    ctx.beginPath();
    ctx.moveTo(w.x, w.y + w.h / 2);
    ctx.lineTo(w.x + w.w, w.y + w.h / 2);
    ctx.stroke();

    // Vertical plank line
    ctx.beginPath();
    ctx.moveTo(w.x + w.w / 2, w.y);
    ctx.lineTo(w.x + w.w / 2, w.y + w.h);
    ctx.stroke();
  }
}

// ─── Player & Laya Rendering (Top-down soldier) ──────────────────────────────
function drawFighter(pos, angle, isPlayer, isReloading, isDead = false) {
  const col = isPlayer ? '#38bdf8' : '#f87171';
  const colDim = isPlayer ? '#164e63' : '#7f1d1d';

  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);

  // Shadow on ground
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(3, 3, P_RAD, P_RAD * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isDead) {
    // Fallen X
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    const s = P_RAD * 0.8;
    ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke();
    ctx.restore();
    return;
  }

  // Body circle
  ctx.fillStyle = colDim;
  ctx.beginPath();
  ctx.arc(0, 0, P_RAD, 0, Math.PI * 2);
  ctx.fill();

  // Body outline
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Directional indicator (front facing dot)
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(P_RAD * 0.6, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  // Gun barrel
  ctx.strokeStyle = col;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(P_RAD * 0.4, 0);
  ctx.lineTo(P_RAD * 1.4, 0);
  ctx.stroke();

  // Reload indicator arc
  if (isReloading > 0) {
    const pct = 1 - (isReloading / RELOAD_FRAMES);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, P_RAD + 5, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Bullets Rendering ────────────────────────────────────────────────────────
function drawBullets() {
  for (const b of bullets) {
    const col = b.owner === 'player' ? '#22d3ee' : '#f87171';
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));

    // Glow
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
    ctx.fillStyle = col;
    ctx.fillRect(-7, -2, 10, 4);

    ctx.restore();
  }
}

// ─── Hit FX ───────────────────────────────────────────────────────────────────
let particles = [];

function spawnHitParticles(x, y, col) {
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1.0, decay: 0.05,
      col, size: 2 + Math.random() * 3
    });
  }
}

function drawParticles() {
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.col;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
    p.x += p.vx; p.y += p.vy;
    p.life -= p.decay;
  }
}

// ─── Damage Numbers ───────────────────────────────────────────────────────────
let dmgNums = [];

function addDmgNum(x, y, text, col) {
  dmgNums.push({ x, y, vy: -1.4, text, col, life: 1.0, decay: 0.022 });
}

function drawDmgNums() {
  dmgNums = dmgNums.filter(d => d.life > 0);
  for (const d of dmgNums) {
    ctx.save();
    ctx.globalAlpha = d.life;
    ctx.fillStyle = d.col;
    ctx.font = '700 13px "Rajdhani",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.text, d.x, d.y);
    ctx.restore();
    d.y += d.vy;
    d.life -= d.decay;
  }
}

// ─── Cursor (custom crosshair) ───────────────────────────────────────────────
function drawCursor() {
  ctx.save();
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;

  const s = 10;
  // Lines
  ctx.beginPath();
  ctx.moveTo(mouseX - s, mouseY); ctx.lineTo(mouseX - 3, mouseY);
  ctx.moveTo(mouseX + 3, mouseY); ctx.lineTo(mouseX + s, mouseY);
  ctx.moveTo(mouseX, mouseY - s); ctx.lineTo(mouseX, mouseY - 3);
  ctx.moveTo(mouseX, mouseY + 3); ctx.lineTo(mouseX, mouseY + s);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(mouseX, mouseY, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ─── HUD Update (DOM) ────────────────────────────────────────────────────────
function buildAmmoPips(containerId, current, max) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const pip = document.createElement('div');
    pip.className = 'ammo-pip' + (i >= current ? ' empty' : '');
    el.appendChild(pip);
  }
}

function updateHUD() {
  // Player HP
  const pHpFill = document.getElementById('p-hp-fill');
  const pHpGhost = document.getElementById('p-hp-ghost');
  if (pHpFill) pHpFill.style.width = `${Math.max(0, playerHp)}%`;
  if (pHpGhost) pHpGhost.style.width = `${Math.max(0, playerGhostHp)}%`;
  const pHpVal = document.getElementById('p-hp-val');
  if (pHpVal) pHpVal.innerText = Math.max(0, Math.round(playerHp));

  // Laya HP
  const lHpFill = document.getElementById('l-hp-fill');
  const lHpGhost = document.getElementById('l-hp-ghost');
  if (lHpFill) lHpFill.style.width = `${Math.max(0, layaHp)}%`;
  if (lHpGhost) lHpGhost.style.width = `${Math.max(0, layaGhostHp)}%`;
  const lHpVal = document.getElementById('l-hp-val');
  if (lHpVal) lHpVal.innerText = Math.max(0, Math.round(layaHp));

  // Ammo values
  const pAmmoVal = document.getElementById('p-ammo-val');
  if (pAmmoVal) pAmmoVal.innerText = playerReloading > 0 ? 'RELOADING...' : playerAmmo;
  const lAmmoVal = document.getElementById('l-ammo-val');
  if (lAmmoVal) lAmmoVal.innerText = layaReloading > 0 ? 'RELOADING...' : layaAmmo;

  // Ammo pips (only first 10 for visual clarity)
  const visMax = 10;
  const pVis = Math.round((playerAmmo / MAX_AMMO) * visMax);
  const lVis = Math.round((layaAmmo / MAX_AMMO) * visMax);
  buildAmmoPips('p-ammo-pips', pVis, visMax);
  buildAmmoPips('l-ammo-pips', lVis, visMax);

  // Ghost HP decay
  if (playerGhostHp > playerHp) { playerGhostHp -= 0.4; if (playerGhostHp < playerHp) playerGhostHp = playerHp; }
  if (layaGhostHp > layaHp) { layaGhostHp -= 0.4; if (layaGhostHp < layaHp) layaGhostHp = layaHp; }
}

function updateTelemetry() {
  const tDev = document.getElementById('t-device');
  const tStance = document.getElementById('t-stance');
  const tAct = document.getElementById('t-action');
  const tConf = document.getElementById('t-conf');
  const tLos = document.getElementById('t-los');

  if (tDev) tDev.innerText = `${(aiProfile.device || 'cpu').toUpperCase()} (RTX 3050)`;
  if (tStance) tStance.innerText = (aiProfile.stance || 'evaluating').replace(/_/g, ' ').toUpperCase();
  if (tAct) tAct.innerText = (aiProfile.action || '—').replace(/_/g, ' ').toUpperCase();
  if (tConf) tConf.innerText = `${Math.round((aiProfile.confidence || 0) * 100)}%`;

  if (tLos) {
    if (layaHasLOS) {
      tLos.innerText = 'TARGET ACQUIRED';
      tLos.style.color = '#4ade80';
    } else if (layaLostSightTimer > 90) {
      tLos.innerText = 'SEARCHING...';
      tLos.style.color = '#f59e0b';
    } else {
      tLos.innerText = 'BEHIND COVER';
      tLos.style.color = '#38bdf8';
    }
  }
}

// ─── Game Over ────────────────────────────────────────────────────────────────
function triggerGameOver(msg, isWin) {
  gameOver = true;
  const overlay = document.getElementById('overlay');
  const overTitle = document.getElementById('over-title');
  if (overTitle) {
    overTitle.innerText = msg;
    overTitle.className = 'over-title ' + (isWin ? 'win' : 'lose');
  }
  if (overlay) overlay.classList.add('show');
}

function resetGame() {
  generateRandomMap();

  playerPos = { x: 120, y: H / 2 };
  layaPos = { x: W - 120, y: H / 2 };
  playerVel = { x: 0, y: 0 };
  layaVel = { x: 0, y: 0 };
  playerAngle = 0;
  layaAngle = Math.PI;

  playerHp = layaHp = MAX_HP;
  playerGhostHp = layaGhostHp = MAX_HP;
  playerAmmo = layaAmmo = MAX_AMMO;
  playerReloading = layaReloading = 0;
  playerShootCooldown = layaShootCooldown = 0;

  bullets = [];
  particles = [];
  dmgNums = [];
  screenShake = 0;
  gameOver = false;
  winner = '';
  gameTime = 0;
  frameCount = 0;

  lastKnownPlayerPos = { x: 120, y: H / 2 };
  layaHasLOS = false;
  layaLostSightTimer = 0;
  layaSearchPos = null;
  layaFacingAngle = Math.PI;

  const tEl = document.getElementById('timer');
  if (tEl) tEl.innerText = '120';

  const overlay = document.getElementById('overlay');
  if (overlay) overlay.classList.remove('show');
  queryNeuralBrain();
}

// ─── Timer ────────────────────────────────────────────────────────────────────
setInterval(() => {
  if (!gameOver) {
    gameTime++;
    const tEl = document.getElementById('timer');
    const remaining = Math.max(0, 120 - gameTime);
    if (tEl) tEl.innerText = remaining < 10 ? '0' + remaining : remaining;
    if (remaining === 0 && !gameOver) {
      // Time limit → whoever has more HP wins
      if (playerHp > layaHp) triggerGameOver('TIME — YOU WIN!', true);
      else if (layaHp > playerHp) triggerGameOver('TIME — LAYA WINS!', false);
      else triggerGameOver('TIME — DRAW!', false);
    }
  }
}, 1000);

// ─── Main 60 FPS Loop ─────────────────────────────────────────────────────────
let fpsCount = 0, fpsTimer = 0;

function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  fpsCount++;
  if (now - fpsTimer > 1000) {
    const fEl = document.getElementById('t-fps');
    if (fEl) fEl.innerText = fpsCount;
    fpsCount = 0;
    fpsTimer = now;
  }

  frameCount++;
  if (playerShootCooldown > 0) playerShootCooldown--;
  if (layaShootCooldown > 0) layaShootCooldown--;

  if (playerReloading > 0) {
    playerReloading--;
    if (playerReloading === 0) playerAmmo = MAX_AMMO;
  }
  if (layaReloading > 0) {
    layaReloading--;
    if (layaReloading === 0) layaAmmo = MAX_AMMO;
  }

  if (!gameOver) {
    // ── Player Movement ─────────────────────────────────────────────────────
    playerVel.x = 0; playerVel.y = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) playerVel.x -= P_SPEED;
    if (keys['KeyD'] || keys['ArrowRight']) playerVel.x += P_SPEED;
    if (keys['KeyW'] || keys['ArrowUp']) playerVel.y -= P_SPEED;
    if (keys['KeyS'] || keys['ArrowDown']) playerVel.y += P_SPEED;

    // Normalize diagonal
    const pSpd = Math.hypot(playerVel.x, playerVel.y);
    if (pSpd > P_SPEED) { playerVel.x = playerVel.x / pSpd * P_SPEED; playerVel.y = playerVel.y / pSpd * P_SPEED; }

    playerPos.x += playerVel.x;
    playerPos.y += playerVel.y;
    playerPos.x = Math.max(P_RAD, Math.min(W - P_RAD, playerPos.x));
    playerPos.y = Math.max(P_RAD, Math.min(H - P_RAD, playerPos.y));
    circleAABBResolve(playerPos, playerVel, P_RAD);

    // Player faces mouse
    playerAngle = Math.atan2(mouseY - playerPos.y, mouseX - playerPos.x);

    // ── Laya AI ─────────────────────────────────────────────────────────────
    processLayaAI();

    layaPos.x += layaVel.x;
    layaPos.y += layaVel.y;
    layaPos.x = Math.max(P_RAD, Math.min(W - P_RAD, layaPos.x));
    layaPos.y = Math.max(P_RAD, Math.min(H - P_RAD, layaPos.y));
    circleAABBResolve(layaPos, layaVel, P_RAD);

    // ── Update Bullets ───────────────────────────────────────────────────────
    const nextBullets = [];
    for (const b of bullets) {
      b.x += b.vx;
      b.y += b.vy;
      b.life--;

      // Wall hit
      if (bulletHitsWall(b.x, b.y)) {
        spawnHitParticles(b.x, b.y, '#94a3b8');
        continue;
      }
      // Out of bounds
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H || b.life <= 0) continue;

      // Hit player
      if (b.owner === 'laya') {
        const dx = b.x - playerPos.x, dy = b.y - playerPos.y;
        if (dx * dx + dy * dy < (P_RAD + 5) * (P_RAD + 5)) {
          playerHp -= BULLET_DAMAGE;
          playImpact();
          spawnHitParticles(b.x, b.y, '#22d3ee');
          addDmgNum(playerPos.x, playerPos.y - 20, `-${BULLET_DAMAGE}`, '#22d3ee');
          screenShake = 6;
          if (playerHp <= 0) { playerHp = 0; triggerGameOver('DEFEATED — LAYA WINS!', false); }
          continue;
        }
      }

      // Hit Laya
      if (b.owner === 'player') {
        const dx = b.x - layaPos.x, dy = b.y - layaPos.y;
        if (dx * dx + dy * dy < (P_RAD + 5) * (P_RAD + 5)) {
          layaHp -= BULLET_DAMAGE;
          playImpact();
          spawnHitParticles(b.x, b.y, '#f87171');
          addDmgNum(layaPos.x, layaPos.y - 20, `-${BULLET_DAMAGE}`, '#f87171');
          screenShake = 5;

          // ── Fair Hit Awareness: check true LOS before acquiring target ──
          const shotAngle = Math.atan2(-b.vy, -b.vx); // incoming angle of bullet
          const hasSight = hasLineOfSight(layaPos.x, layaPos.y, playerPos.x, playerPos.y);

          if (hasSight) {
            // Direct visual confirmation
            lastKnownPlayerPos = { x: playerPos.x, y: playerPos.y };
            layaFacingAngle = shotAngle;
            layaAngle = shotAngle;
            layaLostSightTimer = 0;
            layaHasLOS = true;
            layaSearchPos = null;

            // Retaliate if ready
            if (layaShootCooldown <= 6 && layaAmmo > 0 && layaReloading === 0) {
              layaShoot(playerPos.x, playerPos.y, false);
            }
          } else {
            // Player fired from behind cover or concealed angle!
            // Laya does NOT know exact coordinates through walls.
            layaHasLOS = false;
            layaFacingAngle = shotAngle;
            layaAngle = shotAngle;
            // Search along the trajectory vector the bullet came from
            const estDist = 260 + Math.random() * 220;
            layaSearchPos = {
              x: Math.max(P_RAD + 30, Math.min(W - P_RAD - 30, layaPos.x + Math.cos(shotAngle) * estDist)),
              y: Math.max(P_RAD + 30, Math.min(H - P_RAD - 30, layaPos.y + Math.sin(shotAngle) * estDist))
            };
          }

          // Tactical evasive roll perpendicular to bullet flight path
          const perpX = -b.vy, perpY = b.vx;
          const pLen = Math.hypot(perpX, perpY) || 1;
          const side = Math.random() < 0.5 ? 1 : -1;
          layaVel.x += (perpX / pLen) * 3.8 * side;
          layaVel.y += (perpY / pLen) * 3.8 * side;

          if (layaHp <= 0) { layaHp = 0; triggerGameOver('VICTORY — LAYA DEFEATED!', true); }
          continue;
        }
      }

      nextBullets.push(b);
    }
    bullets = nextBullets;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  ctx.save();
  if (screenShake > 0) {
    ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    screenShake *= 0.84;
    if (screenShake < 0.4) screenShake = 0;
  }

  drawMap();
  drawBullets();
  drawFighter(layaPos, layaAngle, false, layaReloading, layaHp <= 0);
  drawFighter(playerPos, playerAngle, true, playerReloading, playerHp <= 0);
  drawParticles();
  drawDmgNums();
  drawCursor();

  ctx.restore();

  updateHUD();
  updateTelemetry();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
generateRandomMap();
queryNeuralBrain();
requestAnimationFrame(gameLoop);
