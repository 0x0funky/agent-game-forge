function startPlayerAttack() {
  const player = state.player;
  if (!player || player.attackTimer > 0) return;
  const atk = cfg("player").attack;
  player.attackTimer = atk.duration;
  player.attackCooldown = atk.cooldown;
  player.anim = "attack";
  const dir = player.facing;
  state.attacks.push({
    owner: "player",
    x: dir > 0 ? player.x + player.w - 12 : player.x - atk.range + 12,
    y: player.y + 20,
    w: atk.range,
    h: atk.height,
    damage: atk.damage,
    ttl: atk.activeTime,
    // dur + dir let the renderer compute swing progress (0→1) and arc
    // orientation independent of player state, so the slash visual is
    // anchored to where the swing started rather than chasing the player.
    dur: atk.activeTime,
    dir,
    hit: new Set()
  });
  // Dust puff at swing origin — small visual cue that something fired
  // even before the slash arc reaches the enemy.
  const originX = dir > 0 ? player.x + player.w : player.x;
  burstParticles(originX, player.y + player.h - 18, 4, COLORS.smoke);
  playSfx("slash");
}

function updateAttacks(dt) {
  for (const atk of state.attacks) {
    atk.ttl -= dt;
    if (atk.owner === "player") hitEnemies(atk);
  }
  state.attacks = state.attacks.filter((atk) => atk.ttl > 0);
}

function hitEnemies(atk) {
  for (const enemy of state.enemies) {
    if (enemy.dead || atk.hit.has(enemy.uid)) continue;
    if (!rectsOverlap(atk, bodyRect(enemy))) continue;
    atk.hit.add(enemy.uid);
    damageEnemy(enemy, atk.damage, state.player.facing);
  }
}

function damageEnemy(enemy, amount, dir) {
  enemy.hp -= amount;
  enemy.hurtTimer = 0.18;
  enemy.vx += dir * 90;
  burstParticles(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, 8, COLORS.gold);
  screenshake(4, 0.1);
  playSfx("hit");
  if (enemy.hp <= 0) {
    enemy.dead = true;
    enemy.removeTimer = 0.4;
    state.score += enemy.score || 100;
    if (enemy.kind === "boss") {
      state.flags.bossDefeated = true;
      showMessage("Masamune falls. The allied gate opens.", 4);
    }
  }
}
