function spawnParticle(x, y, opts = {}) {
  const visual = cfg("hud").particles || {};
  state.particles.push({
    x,
    y,
    vx: opts.vx ?? (Math.random() * 2 - 1) * (visual.sparkSpeed ?? 90),
    vy: opts.vy ?? -Math.random() * (visual.sparkSpeed ?? 90),
    life: opts.life ?? visual.sparkLife ?? 0.35,
    maxLife: opts.life ?? visual.sparkLife ?? 0.35,
    size: opts.size ?? 3,
    color: opts.color ?? COLORS.gold
  });
}

function burstParticles(x, y, count, color) {
  for (let i = 0; i < count; i += 1) {
    spawnParticle(x, y, { color, vx: (Math.random() * 2 - 1) * 150, vy: -40 - Math.random() * 160 });
  }
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
  }
  state.particles = state.particles.filter((p) => p.life > 0);
  if (state.camera.shakeT > 0) {
    state.camera.shakeT -= dt;
    if (state.camera.shakeT <= 0) state.camera.shake = 0;
  }
}

function screenshake(amount, seconds) {
  state.camera.shake = Math.max(state.camera.shake, amount);
  state.camera.shakeT = Math.max(state.camera.shakeT, seconds);
}
