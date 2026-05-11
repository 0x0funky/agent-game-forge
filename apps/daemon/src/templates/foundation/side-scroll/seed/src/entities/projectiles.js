function spawnProjectile(typeId, x, y, dir) {
  const type = byId("projectiles", typeId);
  if (!type) return;
  state.projectiles.push({
    typeId,
    x,
    y,
    w: type.size?.w ?? 36,
    h: type.size?.h ?? 12,
    vx: dir * type.speed,
    vy: 0,
    damage: type.damage,
    sprite: type.sprite,
    ttl: type.ttl ?? 4,
    facing: dir
  });
  playSfx("arrow");
}

function updateProjectiles(dt) {
  const playerRect = state.player ? bodyRect(state.player) : null;
  for (const p of state.projectiles) {
    p.ttl -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (playerRect && rectsOverlap(playerRect, p)) {
      damagePlayer(p.damage, p.vx > 0 ? 1 : -1);
      p.ttl = 0;
      burstParticles(p.x, p.y, 5, COLORS.jade);
    }
  }
  const width = state.level?.mapSize?.width ?? VIEW.w;
  state.projectiles = state.projectiles.filter((p) => p.ttl > 0 && p.x > -100 && p.x < width + 100);
}
