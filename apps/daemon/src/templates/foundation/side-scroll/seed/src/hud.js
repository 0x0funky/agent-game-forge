function drawHud(ctx) {
  if (!state.player) return;
  const hud = cfg("hud");
  const p = state.player;
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(24, 20, 286, 76);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.strokeRect(24.5, 20.5, 286, 76);
  ctx.fillStyle = COLORS.text;
  ctx.font = "18px monospace";
  ctx.fillText("RONIN", 42, 46);
  ctx.fillStyle = COLORS.hpBack;
  ctx.fillRect(112, 32, hud.hpBarWidth, 16);
  ctx.fillStyle = COLORS.hp;
  ctx.fillRect(112, 32, hud.hpBarWidth * (p.hp / p.maxHp), 16);
  ctx.strokeStyle = COLORS.text;
  ctx.strokeRect(112.5, 32.5, hud.hpBarWidth, 16);
  ctx.fillStyle = COLORS.gold;
  ctx.fillText("Lives " + p.lives, 42, 76);
  ctx.fillText("Score " + state.score, 164, 76);
  if (state.mode === "paused") drawCenteredPanel(ctx, "PAUSED", "Press P or Esc to resume");
  if (state.mode === "gameover") drawCenteredPanel(ctx, "GAME OVER", "Press Enter to restart");
  if (state.mode === "win") drawCenteredPanel(ctx, "GATE SECURED", state.endingText || "Press Enter to restart");
  drawMessage(ctx);
  ctx.restore();
}

function drawMessage(ctx) {
  if (!state.message) return;
  const pad = 24;
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(180, VIEW.h - 120, VIEW.w - 360, 76);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.strokeRect(180.5, VIEW.h - 120.5, VIEW.w - 360, 76);
  ctx.fillStyle = COLORS.text;
  ctx.font = "20px monospace";
  wrapText(ctx, state.message.text, 204, VIEW.h - 82, VIEW.w - 408, 26);
}

function drawCenteredPanel(ctx, title, subtitle) {
  ctx.fillStyle = "rgba(0,0,0,0.68)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(370, 246, 540, 180);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.strokeRect(370.5, 246.5, 540, 180);
  ctx.fillStyle = COLORS.gold;
  ctx.font = "42px monospace";
  ctx.textAlign = "center";
  ctx.fillText(title, VIEW.w / 2, 318);
  ctx.fillStyle = COLORS.text;
  ctx.font = "20px monospace";
  ctx.fillText(subtitle, VIEW.w / 2, 368);
  ctx.textAlign = "left";
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
}
