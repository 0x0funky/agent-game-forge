function updateBattleAnimations(dt) {
  const battle = state.battle;
  if (!battle) return;
  battle.allyHop = Math.max(0, battle.allyHop - dt * 2.8);
  battle.enemyHop = Math.max(0, battle.enemyHop - dt * 2.8);
  battle.effects.forEach((effect) => {
    effect.t += dt;
  });
  battle.effects = battle.effects.filter((effect) => effect.t < effect.duration);
}

function updateTransition(dt) {
  const transition = state.transition;
  if (!transition) return;
  transition.t += dt;
  if (transition.t < transition.duration) return;
  if (transition.kind === "battleStart") {
    const kind = transition.battleKind;
    state.transition = null;
    beginBattle(kind);
    return;
  }
  state.transition = null;
}

function drawTransition() {
  const transition = state.transition;
  if (!transition) return;
  const p = clamp(transition.t / transition.duration, 0, 1);
  ctx.save();
  if (transition.kind === "battleStart") {
    ctx.fillStyle = `rgba(5, 6, 6, ${0.18 + p * 0.52})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    const stripeCount = 9;
    const stripeH = VIEW.h / stripeCount;
    for (let i = 0; i < stripeCount; i += 1) {
      const offset = (1 - p) * VIEW.w * (i % 2 === 0 ? -1 : 1);
      ctx.fillStyle = i % 2 === 0 ? "rgba(12, 14, 13, 0.94)" : "rgba(45, 24, 20, 0.94)";
      ctx.fillRect(offset, i * stripeH - 1, VIEW.w, stripeH + 2);
    }
    ctx.globalAlpha = Math.sin(p * Math.PI);
    ctx.strokeStyle = "rgba(213, 166, 63, 0.72)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(VIEW.w / 2, VIEW.h / 2, 70 + p * 260, 0, Math.PI * 2);
    ctx.stroke();
  } else if (transition.kind === "battleReveal") {
    ctx.fillStyle = `rgba(5, 6, 6, ${1 - p})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  } else if (transition.kind === "battleEnd") {
    ctx.fillStyle = `rgba(213, 166, 63, ${(1 - p) * 0.22})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }
  ctx.restore();
}
