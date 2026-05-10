function spriteFrame(sheet, cols, rows, index) {
  const cellW = sheet.width / cols;
  const cellH = sheet.height / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { sx: col * cellW, sy: row * cellH, sw: cellW, sh: cellH };
}

function drawSheetFrame(sheet, cols, rows, index, x, y, mapHeight, alpha = 1, tint = null) {
  const frame = spriteFrame(sheet, cols, rows, index);
  const screenH = mapHeight * CAMERA.scale;
  const screenW = screenH * (frame.sw / frame.sh);
  const px = sx(x) - screenW / 2;
  const py = sy(y) - screenH;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sheet, frame.sx, frame.sy, frame.sw, frame.sh, px, py, screenW, screenH);
  if (tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = tint;
    ctx.fillRect(px, py, screenW, screenH);
  }
  ctx.restore();
}

function drawMapProp(prop) {
  // JSON props use `image` (path); legacy hardcoded ones used `imageKey`.
  const image = images[prop.image] ?? images[prop.imageKey];
  if (!image) return;
  const screenW = prop.w * CAMERA.scale;
  const screenH = prop.h * CAMERA.scale;
  ctx.drawImage(image, sx(prop.x) - screenW / 2, sy(prop.y) - screenH, screenW, screenH);
}

function drawFullSheetFrame(sheet, cols, rows, index, x, y, mapHeight, alpha = 1) {
  const frame = spriteFrame(sheet, cols, rows, index);
  const screenH = (mapHeight / MAP.h) * VIEW.h;
  const screenW = screenH * (frame.sw / frame.sh);
  const px = fullSx(x) - screenW / 2;
  const py = fullSy(y) - screenH;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sheet, frame.sx, frame.sy, frame.sw, frame.sh, px, py, screenW, screenH);
  ctx.restore();
}

function drawShadow(x, y, w, h, alpha = 0.28) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#050505";
  ctx.beginPath();
  ctx.ellipse(sx(x), sy(y), w * CAMERA.scale, h * CAMERA.scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFullShadow(x, y, w, h, alpha = 0.28) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#050505";
  ctx.beginPath();
  ctx.ellipse(fullSx(x), fullSy(y), (w / MAP.w) * VIEW.w, (h / MAP.h) * VIEW.h, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOverworld(now) {
  updateCamera();
  ctx.drawImage(images[currentSceneMapKey()], CAMERA.x, CAMERA.y, CAMERA.w, CAMERA.h, 0, 0, VIEW.w, VIEW.h);

  const renderables = [];
  const props = collisionMaps[state.scene]?.props ?? [];
  if (props.length || collisionMap.npc || collisionMap.boss) {
    if (collisionMap.zones?.grass) drawZoneGlimmer(now, collisionMap.zones.grass, "rgba(80, 171, 93, 0.26)");
    if (collisionMap.zones?.grassEast) drawZoneGlimmer(now, collisionMap.zones.grassEast, "rgba(80, 171, 93, 0.2)");
    if (collisionMap.zones?.hidden) drawZoneGlimmer(now, collisionMap.zones.hidden, "rgba(155, 116, 205, 0.16)");
    if (state.scene === "outdoor" && !state.flags?.gate) drawZoneGlimmer(now, collisionMap.zones.training, "rgba(197, 64, 50, 0.22)");
    if (collisionMap.rest) drawRestPoint(now);
    renderables.push(
      ...props.map((prop) => ({
        sortY: prop.sortY ?? prop.y,
        draw: () => drawMapProp(prop),
      })),
    );
    if (collisionMap.npc) {
      const npcFrame = animFrame(now, "npc");
      renderables.push({
        sortY: collisionMap.npc.y,
        draw: () => {
          drawShadow(collisionMap.npc.x, collisionMap.npc.y, 20, 8, 0.22);
          drawSheetFrame(images.aoi, 4, 4, npcFrame, collisionMap.npc.x, collisionMap.npc.y, 86);
        },
      });
    }
    if (collisionMap.boss && !bossDefeated(collisionMap.boss)) {
      const bossFrame = animFrame(now, "boss");
      const bossImage = images[collisionMap.boss.imageKey || "oniDaishoMap"];
      const mapHeight = collisionMap.boss.mapHeight ?? 112;
      renderables.push({
        sortY: collisionMap.boss.y,
        draw: () => {
          drawShadow(collisionMap.boss.x, collisionMap.boss.y, 28, 11, 0.28);
          drawSheetFrame(bossImage, 2, 2, bossFrame, collisionMap.boss.x, collisionMap.boss.y, mapHeight);
        },
      });
    }
  } else {
    for (const trainer of collisionMap.trainers ?? []) {
      const frame = animFrame(now, "trainer");
      const mapHeight = trainer.mapHeight ?? 88;
      const cols = trainer.cols ?? 2;
      const rows = trainer.rows ?? 2;
      const frameIndex = rows === 4 ? frame : frame % 4;
      renderables.push({
        sortY: trainer.y,
        draw: () => {
          drawShadow(trainer.x, trainer.y, trainer.shadowW ?? 22, trainer.shadowH ?? 9, 0.24);
          drawSheetFrame(images[trainer.imageKey], cols, rows, frameIndex, trainer.x, trainer.y, mapHeight);
        },
      });
    }
  }
  renderables.push({
    sortY: state.player.y,
    draw: () => {
      const playerRow = DIR_ROWS[state.player.dir] ?? 0;
      const frame = state.player.moving ? animFrame(now, "playerWalk") : 0;
      drawShadow(state.player.x, state.player.y, 22, 9, 0.24);
      drawSheetFrame(images.player, 4, 4, playerRow * 4 + frame, state.player.x, state.player.y, 86);
    },
  });
  renderables.sort((a, b) => a.sortY - b.sortY).forEach((item) => item.draw());

  if (state.debugCollision) drawCollisionDebug();
  if (state.lastSavedAt && now - state.lastSavedAt < 1150) {
    drawToast("已存檔", now - state.lastSavedAt);
  }
}

function drawZoneGlimmer(now, rect, color) {
  const pulse = 0.45 + Math.sin(now / 430) * 0.18;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(
    sx(rect.x + rect.w / 2),
    sy(rect.y + rect.h / 2),
    rect.w * CAMERA.scale * 0.48,
    rect.h * CAMERA.scale * 0.43,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

function drawCollisionDebug() {
  ctx.save();
  for (const shape of collisionMap.walkBounds) drawShape(shape, "rgba(85, 169, 96, 0.16)", "rgba(85, 169, 96, 0.48)");
  for (const shape of collisionMap.blockers) drawShape(shape, "rgba(185, 65, 42, 0.24)", "rgba(236, 114, 77, 0.62)");
  if (collisionMap.npc) {
    const radius = collisionMap.npc.collisionRadius ?? 20;
    drawShape({ type: "ellipse", x: collisionMap.npc.x, y: collisionMap.npc.y, rx: radius, ry: radius }, "rgba(213, 166, 63, 0.16)", "rgba(213, 166, 63, 0.62)");
  }
  if (collisionMap.boss && !bossDefeated(collisionMap.boss)) {
    const radius = collisionMap.boss.collisionRadius ?? 28;
    drawShape({ type: "ellipse", x: collisionMap.boss.x, y: collisionMap.boss.y, rx: radius, ry: radius }, "rgba(185, 65, 42, 0.24)", "rgba(236, 114, 77, 0.72)");
  }
  for (const trainer of collisionMap.trainers ?? []) {
    const radius = trainer.collisionRadius ?? 24;
    drawShape({ type: "ellipse", x: trainer.x, y: trainer.y, rx: radius, ry: radius }, "rgba(213, 166, 63, 0.16)", "rgba(213, 166, 63, 0.66)");
  }
  ctx.restore();
}

function drawShape(shape, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (shape.type === "rect") {
    ctx.rect(sx(shape.x), sy(shape.y), shape.w * CAMERA.scale, shape.h * CAMERA.scale);
  } else if (shape.type === "ellipse") {
    ctx.ellipse(sx(shape.x), sy(shape.y), shape.rx * CAMERA.scale, shape.ry * CAMERA.scale, 0, 0, Math.PI * 2);
  } else if (shape.type === "polygon") {
    shape.points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(sx(x), sy(y));
      else ctx.lineTo(sx(x), sy(y));
    });
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
}

function drawToast(text, age) {
  const alpha = clamp(1 - age / 1150, 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(20, 22, 21, 0.72)";
  ctx.strokeStyle = "rgba(244, 230, 201, 0.24)";
  ctx.lineWidth = 1;
  roundRect(572, 92, 136, 38, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f4e6c9";
  ctx.font = "700 18px serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 640, 117);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBattle(now) {
  ctx.drawImage(images.battleBg, 0, 0, VIEW.w, VIEW.h);
  ctx.save();
  ctx.fillStyle = "rgba(10, 11, 10, 0.2)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  const gradient = ctx.createRadialGradient(645, 368, 50, 645, 380, 480);
  gradient.addColorStop(0, "rgba(213, 166, 63, 0.2)");
  gradient.addColorStop(0.62, "rgba(49, 129, 145, 0.08)");
  gradient.addColorStop(1, "rgba(15, 17, 16, 0.2)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.fillStyle = "rgba(236, 217, 173, 0.18)";
  ctx.strokeStyle = "rgba(244, 230, 201, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(420, 502, 250, 76, -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(870, 294, 245, 70, -0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const battle = state.battle;
  if (!battle) return;
  const idleFrame = animFrame(now, "starterIdle");
  const allyLift = battle.allyHop > 0 ? Math.sin(battle.allyHop * Math.PI) * 22 : 0;
  const enemyLift = battle.enemyHop > 0 ? Math.sin(battle.enemyHop * Math.PI) * 18 : 0;

  drawFullShadow(548, 655, 140, 32, 0.35);
  drawFullSheetFrame(images[battle.ally.imageKey], 2, 2, idleFrame, 548, 626 - allyLift, 210);
  drawFullShadow(1136, 410, 138, 32, 0.35);
  drawFullSheetFrame(images[battle.enemy.imageKey], 2, 2, idleFrame, 1136, 386 - enemyLift, battle.enemy.battleSize ?? 210);

  for (const effect of battle.effects) drawEffect(effect);
}

function drawRestPoint(now) {
  const rest = collisionMap.rest;
  const pulse = 0.32 + Math.sin(now / 520) * 0.1;
  const rx = rest.rx ?? rest.radius;
  const ry = rest.ry ?? rest.radius;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = "rgba(213, 166, 63, 0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(sx(rest.x), sy(rest.y), rx * CAMERA.scale, ry * CAMERA.scale, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawEffect(effect) {
  const progress = clamp(effect.t / effect.duration, 0, 0.999);
  const frame = Math.floor(progress * 4);
  const alpha = 1 - Math.max(0, progress - 0.72) / 0.28;
  drawFullSheetFrame(images[FX_KEYS[effect.kind]], 2, 2, frame, effect.x, effect.y, effect.size, alpha);
}

function drawChoose() {
  ctx.drawImage(images.map, 0, 0, VIEW.w, VIEW.h);
  ctx.save();
  ctx.fillStyle = "rgba(10, 11, 10, 0.48)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.restore();
}
