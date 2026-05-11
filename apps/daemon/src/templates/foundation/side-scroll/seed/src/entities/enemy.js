let enemyCounter = 0;

function buildEnemyInstance(spawn) {
  const type = byId("enemies", spawn.type);
  if (!type) return null;
  return {
    uid: "enemy_" + (++enemyCounter),
    typeId: spawn.type,
    kind: type.kind,
    name: type.name,
    x: spawn.x,
    y: spawn.y,
    w: type.size?.w ?? 58,
    h: type.size?.h ?? 72,
    vx: 0,
    vy: 0,
    facing: spawn.facing ?? -1,
    patrol: spawn.patrol || null,
    hp: type.stats.hp,
    maxHp: type.stats.hp,
    damage: type.stats.damage,
    speed: type.stats.speed,
    score: type.stats.score,
    attackRange: type.stats.attackRange ?? 60,
    shootRange: type.stats.shootRange ?? 520,
    attackCooldown: 0,
    hurtTimer: 0,
    anim: "idle",
    animations: type.animations,
    projectile: type.projectile,
    dead: false,
    bodyInsetX: type.bodyInsetX ?? 10,
    bodyInsetY: type.bodyInsetY ?? 8
  };
}

function updateEnemies(dt) {
  for (const enemy of state.enemies) {
    if (enemy.dead) {
      enemy.removeTimer -= dt;
      continue;
    }
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    enemy.hurtTimer = Math.max(0, enemy.hurtTimer - dt);
    applyGravity(enemy, dt);
    if (enemy.kind === "ranged") updateArcher(enemy, dt);
    else if (enemy.kind === "boss") updateBoss(enemy, dt);
    else updateMelee(enemy, dt);
    integrateEntity(enemy, dt, platformColliders(state.level));
    handleEnemyContact(enemy);
  }
  state.enemies = state.enemies.filter((enemy) => !enemy.dead || enemy.kind === "boss" || enemy.removeTimer > 0);
}

function updateMelee(enemy) {
  const player = state.player;
  if (!player) return;
  const dx = player.x - enemy.x;
  if (Math.abs(dx) < enemy.attackRange && Math.abs(player.y - enemy.y) < 70) {
    enemy.vx = 0;
    enemy.facing = dx >= 0 ? 1 : -1;
    enemy.anim = "attack";
    if (enemy.attackCooldown <= 0) {
      damagePlayer(enemy.damage, enemy.facing);
      enemy.attackCooldown = 1.1;
    }
    return;
  }
  const minX = enemy.patrol?.minX ?? enemy.x - 160;
  const maxX = enemy.patrol?.maxX ?? enemy.x + 160;
  if (enemy.x < minX) enemy.facing = 1;
  if (enemy.x > maxX) enemy.facing = -1;
  enemy.vx = enemy.facing * enemy.speed;
  enemy.anim = "walk";
}

function updateArcher(enemy) {
  const player = state.player;
  if (!player) return;
  const dx = player.x - enemy.x;
  enemy.facing = dx >= 0 ? 1 : -1;
  enemy.vx = 0;
  if (Math.abs(dx) < enemy.shootRange && Math.abs(player.y - enemy.y) < 120) {
    enemy.anim = "attack";
    if (enemy.attackCooldown <= 0) {
      spawnProjectile(enemy.projectile || "arrow", enemy.x + enemy.w / 2, enemy.y + 34, enemy.facing);
      enemy.attackCooldown = 1.8;
    }
  } else {
    enemy.anim = "idle";
  }
}

function updateBoss(enemy) {
  const player = state.player;
  if (!player) return;
  const dx = player.x - enemy.x;
  enemy.facing = dx >= 0 ? 1 : -1;
  const dist = Math.abs(dx);
  if (dist > enemy.attackRange) {
    enemy.vx = enemy.facing * enemy.speed;
    enemy.anim = "walk";
  } else {
    enemy.vx = 0;
    enemy.anim = enemy.hurtTimer > 0 ? "hurt" : "attack";
    if (enemy.attackCooldown <= 0) {
      damagePlayer(enemy.damage, enemy.facing);
      enemy.attackCooldown = 1.25;
      screenshake(6, 0.14);
    }
  }
}

function handleEnemyContact(enemy) {
  if (!state.player || enemy.kind === "ranged") return;
  if (rectsOverlap(bodyRect(enemy), bodyRect(state.player))) {
    damagePlayer(enemy.damage, enemy.x < state.player.x ? 1 : -1);
  }
}
