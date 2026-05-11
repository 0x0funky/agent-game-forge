function createPlayerAt(spawn) {
  const pc = cfg("player");
  state.player = {
    x: spawn.x,
    y: spawn.y,
    w: pc.size.w,
    h: pc.size.h,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    maxJumps: pc.movement.maxJumps,
    jumpsLeft: pc.movement.maxJumps,
    hp: pc.stats.maxHp,
    maxHp: pc.stats.maxHp,
    lives: pc.stats.lives,
    invuln: 0,
    attackTimer: 0,
    attackCooldown: 0,
    state: "idle",
    anim: "idle",
    animations: pc.animations,
    bodyInsetX: pc.bodyInsetX,
    bodyInsetY: pc.bodyInsetY
  };
  state.checkpoint = { x: spawn.x, y: spawn.y };
}

function updatePlayer(dt) {
  const p = state.player;
  if (!p) return;
  const pc = cfg("player");
  const move = pc.movement;

  p.invuln = Math.max(0, p.invuln - dt);
  p.attackTimer = Math.max(0, p.attackTimer - dt);
  p.attackCooldown = Math.max(0, p.attackCooldown - dt);

  const desired = input.actions.x || 0;
  if (Math.abs(desired) > 0.1) p.facing = desired > 0 ? 1 : -1;
  const accel = p.grounded ? move.accel : move.airAccel;
  const target = desired * move.maxSpeed;
  p.vx += (target - p.vx) * Math.min(1, accel * dt);
  if (Math.abs(desired) < 0.1 && p.grounded) p.vx *= Math.exp(-move.friction * dt);

  if (wasPressed("jump") && p.jumpsLeft > 0) {
    p.vy = move.jumpVelocity;
    p.jumpsLeft -= 1;
    p.grounded = false;
    p.anim = "jump";
    burstParticles(p.x + p.w / 2, p.y + p.h, 5, COLORS.smoke);
    playSfx("jump");
  }
  if (wasPressed("attack") && p.attackCooldown <= 0) startPlayerAttack();

  applyGravity(p, dt);
  integrateEntity(p, dt, platformColliders(state.level));
  if (p.y > (state.level.mapSize.height + 120)) loseLife();

  if (p.attackTimer > 0) p.state = p.anim = "attack";
  else if (!p.grounded) p.state = p.anim = "jump";
  else if (Math.abs(p.vx) > 20) p.state = p.anim = "walk";
  else p.state = p.anim = "idle";
}

function damagePlayer(amount, knockDir) {
  const p = state.player;
  if (!p || p.invuln > 0 || state.mode !== "playing") return;
  p.hp -= amount;
  p.invuln = cfg("player").stats.invulnSec;
  p.vx = knockDir * 160;
  p.vy = Math.min(p.vy, -160);
  burstParticles(p.x + p.w / 2, p.y + p.h / 2, 8, COLORS.hp);
  screenshake(5, 0.12);
  playSfx("hurt");
  if (p.hp <= 0) loseLife();
}

function loseLife() {
  const p = state.player;
  if (!p) return;
  p.lives -= 1;
  if (p.lives < 1) {
    state.mode = "gameover";
    showMessage("The road is lost.", 4);
    playSfx("defeat");
    return;
  }
  p.hp = p.maxHp;
  p.x = state.checkpoint.x;
  p.y = state.checkpoint.y;
  p.vx = 0;
  p.vy = 0;
  p.invuln = cfg("player").stats.invulnSec;
  state.projectiles.length = 0;
  showMessage("Back to the last banner.", 2.5);
}
