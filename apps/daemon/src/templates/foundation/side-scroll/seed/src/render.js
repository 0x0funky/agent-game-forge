function renderFrame() {
  const ctx = dom.ctx;
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "loading") {
    drawLoading(ctx);
    return;
  }
  if (state.mode === "title") {
    drawTitle(ctx);
    return;
  }
  drawLevel(ctx);
  drawHud(ctx);
}

function drawLoading(ctx) {
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.text;
  ctx.font = "24px monospace";
  ctx.fillText("Loading Ash Banner Road...", 420, 360);
}

function drawTitle(ctx) {
  drawLevel(ctx);
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.gold;
  ctx.font = "56px monospace";
  ctx.textAlign = "center";
  ctx.fillText(GAME.title.toUpperCase(), VIEW.w / 2, 255);
  ctx.fillStyle = COLORS.text;
  ctx.font = "22px monospace";
  ctx.fillText("A Sengoku side-scroll action road", VIEW.w / 2, 304);
  if (Math.floor(state.titleBlink * 2) % 2 === 0) {
    ctx.fillText("Press Enter / Start", VIEW.w / 2, 392);
  }
  ctx.textAlign = "left";
}

function drawLevel(ctx) {
  if (!state.level) {
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    return;
  }
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  drawParallax(ctx, state.level);
  drawPlatforms(ctx, state.level);
  drawHazards(ctx);
  drawPickups(ctx);
  drawProjectiles(ctx);
  drawEnemies(ctx);
  drawPlayer(ctx);
  drawAttacks(ctx);
  drawParticles(ctx);
}

function drawPlatforms(ctx, level) {
  for (const platform of level.platforms || []) {
    const x = worldToScreenX(platform.x);
    const y = worldToScreenY(platform.y);
    const lib = level.shared_platform_library?.[platform.tile];
    if (lib && lib.left && lib.mid && lib.right) {
      drawPlatformStrip(ctx, platform, lib, x, y);
    } else {
      ctx.fillStyle = COLORS.platformFace;
      ctx.fillRect(x, y, platform.w, platform.h);
      ctx.fillStyle = COLORS.platformTop;
      ctx.fillRect(x, y, platform.w, Math.min(14, platform.h));
      ctx.strokeStyle = "#7b6046";
      ctx.strokeRect(x + 0.5, y + 0.5, platform.w, platform.h);
    }
  }
}

function drawPlatformStrip(ctx, platform, lib, x, y) {
  const left = resolvedImage(lib.left.image);
  const mid = resolvedImage(lib.mid.image);
  const right = resolvedImage(lib.right.image);
  if (!left || !mid || !right) {
    ctx.fillStyle = COLORS.platformFace;
    ctx.fillRect(x, y, platform.w, platform.h);
    return;
  }
  const tileW = lib.mid.tileW || 64;
  const h = platform.h;
  ctx.drawImage(left, x, y, tileW, h);
  for (let tx = x + tileW; tx < x + platform.w - tileW; tx += tileW) {
    ctx.drawImage(mid, tx, y, Math.min(tileW, x + platform.w - tileW - tx), h);
  }
  ctx.drawImage(right, x + platform.w - tileW, y, tileW, h);
}

function drawPlayer(ctx) {
  const p = state.player;
  if (!p) return;
  const flicker = p.invuln > 0 && Math.floor(state.time * 18) % 2 === 0;
  if (flicker) return;
  drawEntityAnimation(ctx, p, p.anim, p.facing, COLORS.jade);
}

function drawEnemies(ctx) {
  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    drawEntityAnimation(ctx, enemy, enemy.anim, enemy.facing, enemy.kind === "boss" ? COLORS.hp : COLORS.gold);
    if (enemy.kind === "boss") drawBossBar(ctx, enemy);
  }
}

function drawBossBar(ctx, enemy) {
  const w = 520;
  const x = (VIEW.w - w) / 2;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(x, 106, w, 34);
  ctx.fillStyle = COLORS.hpBack;
  ctx.fillRect(x + 12, 118, w - 24, 10);
  ctx.fillStyle = COLORS.hp;
  ctx.fillRect(x + 12, 118, (w - 24) * (enemy.hp / enemy.maxHp), 10);
  ctx.fillStyle = COLORS.text;
  ctx.font = "14px monospace";
  ctx.fillText(enemy.name.toUpperCase(), x + 12, 132);
}

function drawEntityAnimation(ctx, entity, animName, facing, fallbackColor) {
  const anim = entity.animations?.[animName] || entity.animations?.idle;
  const image = anim?.image || resolvedImage(anim?.sprite);
  const meta = anim?.meta || DEFAULT_ANIM;
  // Sprite cell size dictates how big the rendered sprite is. Falls back
  // to per-entity override, then a boss/non-boss heuristic so legacy
  // entries without meta still draw at a sensible size.
  const drawSize = entity.drawSize || meta.cellSize || (entity.kind === "boss" ? 170 : 128);
  const drawX = entity.x + entity.w / 2 - drawSize / 2;
  const drawY = entity.y + entity.h - drawSize;
  const sx = worldToScreenX(drawX);
  const sy = worldToScreenY(drawY);
  if (!image) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(worldToScreenX(entity.x), worldToScreenY(entity.y), entity.w, entity.h);
    return;
  }
  const frame = Math.floor(state.time * meta.fps) % Math.max(1, meta.frames);
  const col = frame % meta.cols;
  const row = Math.floor(frame / meta.cols);
  ctx.save();
  if (facing < 0) {
    ctx.translate(worldToScreenX(drawX + drawSize), sy);
    ctx.scale(-1, 1);
    ctx.drawImage(image, col * meta.frameW, row * meta.frameH, meta.frameW, meta.frameH, 0, 0, drawSize, drawSize);
  } else {
    ctx.drawImage(image, col * meta.frameW, row * meta.frameH, meta.frameW, meta.frameH, sx, sy, drawSize, drawSize);
  }
  ctx.restore();
}

function drawAttacks(ctx) {
  for (const atk of state.attacks) {
    // Progress 0→1 across the active window. sin(pi*t) gives a 0→1→0
    // envelope so the slash brightens at the start, peaks mid-swing,
    // and fades out — feels like a chunky pixel-style swipe rather
    // than a flat rect.
    const dur = atk.dur || 0.12;
    const progress = Math.max(0, Math.min(1, 1 - atk.ttl / dur));
    const fade = Math.sin(progress * Math.PI);
    if (fade <= 0) continue;

    const dir = atk.dir || 1;
    const baseX = worldToScreenX(atk.x);
    const baseY = worldToScreenY(atk.y);
    const w = atk.w;
    const h = atk.h;

    ctx.save();

    // 4 chunky parallel slashes — top→bottom rake. Each band sweeps
    // forward as progress advances so it reads as motion across cells.
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1); // 0 (top) .. 1 (bottom)
      const yOffset = h * (0.1 + t * 0.75);
      const bandH = 5;
      // Sweep: stroke starts near the player, extends to range tip as
      // progress increases. Length shrinks at the tail of the swing.
      const sweepStart = (dir > 0) ? 0 : w;
      const sweepEnd   = (dir > 0) ? w * (0.25 + progress * 0.85) : w * (0.75 - progress * 0.85);
      const strokeX = dir > 0 ? sweepStart : Math.min(sweepStart, sweepEnd);
      const strokeW = Math.abs(sweepEnd - sweepStart) * (1 - 0.5 * Math.abs(progress - 0.5));
      // Hot white in the middle bands, gold on the edges.
      const isMid = i === 1 || i === 2;
      const baseAlpha = fade * (isMid ? 0.95 : 0.65);
      ctx.fillStyle = isMid
        ? `rgba(255, 240, 210, ${baseAlpha})`
        : `rgba(229, 184, 74, ${baseAlpha * 0.85})`;
      ctx.fillRect(Math.round(baseX + strokeX), Math.round(baseY + yOffset - bandH / 2), Math.round(strokeW), bandH);
    }

    // Leading-edge spark — a small white pixel cluster at the swing
    // frontier. Visible only during the first 40% of the swing so it
    // doesn't trail behind the arc when the slash fades.
    if (progress < 0.45) {
      const sparkAlpha = fade * 0.85;
      ctx.fillStyle = `rgba(255, 255, 255, ${sparkAlpha})`;
      const sparkX = dir > 0
        ? baseX + Math.round(w * (0.25 + progress * 0.85)) - 6
        : baseX + Math.round(w * (0.75 - progress * 0.85)) - 2;
      ctx.fillRect(sparkX, Math.round(baseY + h * 0.32), 8, Math.round(h * 0.36));
    }

    ctx.restore();
  }
}

function drawProjectiles(ctx) {
  for (const p of state.projectiles) {
    const img = resolvedImage(p.sprite);
    if (img) {
      ctx.save();
      if (p.facing < 0) {
        ctx.translate(worldToScreenX(p.x + p.w), worldToScreenY(p.y));
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, p.w, p.h);
      } else {
        ctx.drawImage(img, worldToScreenX(p.x), worldToScreenY(p.y), p.w, p.h);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = COLORS.jade;
      ctx.fillRect(worldToScreenX(p.x), worldToScreenY(p.y), p.w, p.h);
    }
  }
}

function drawPickups(ctx) {
  for (const pickup of state.pickups) {
    if (pickup.collected) continue;
    const img = resolvedImage(pickup.sprite);
    const bob = Math.sin(state.time * 5 + pickup.x * 0.01) * 4;
    if (img) ctx.drawImage(img, worldToScreenX(pickup.x), worldToScreenY(pickup.y + bob), pickup.w, pickup.h);
    else {
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(worldToScreenX(pickup.x), worldToScreenY(pickup.y + bob), pickup.w, pickup.h);
    }
  }
}

function drawHazards(ctx) {
  for (const hazard of state.hazards) {
    const img = resolvedImage(hazard.sprite);
    if (img) ctx.drawImage(img, worldToScreenX(hazard.x), worldToScreenY(hazard.y), hazard.w, hazard.h);
    else {
      ctx.fillStyle = COLORS.hp;
      ctx.fillRect(worldToScreenX(hazard.x), worldToScreenY(hazard.y), hazard.w, hazard.h);
    }
  }
}

function drawParticles(ctx) {
  for (const p of state.particles) {
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(worldToScreenX(p.x), worldToScreenY(p.y), p.size, p.size);
    ctx.globalAlpha = 1;
  }
}

function resolvedImage(path) {
  if (!path) return null;
  const value = assetCache.images.get(path);
  if (!value || value instanceof Promise) return null;
  return value;
}
