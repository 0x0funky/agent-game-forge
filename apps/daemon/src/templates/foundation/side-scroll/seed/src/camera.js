function updateCamera(dt) {
  const level = state.level;
  const p = state.player;
  if (!level || !p) return;
  const camCfg = cfg("camera");
  const boundsW = level.mapSize.width;
  const boundsH = level.mapSize.height;
  if (level.camera?.mode === "locked") {
    state.camera.x = clamp(level.camera.x || 0, 0, Math.max(0, boundsW - VIEW.w));
    state.camera.y = clamp(level.camera.y || 0, 0, Math.max(0, boundsH - VIEW.h));
    return;
  }
  const desiredLook = p.facing * camCfg.lookahead;
  state.camera.lookahead += (desiredLook - state.camera.lookahead) * Math.min(1, dt * camCfg.lookaheadLerp);
  const targetX = p.x + p.w / 2 - VIEW.w / 2 + state.camera.lookahead;
  if (p.grounded) state.camera.snapY = p.y + p.h / 2 - VIEW.h / 2;
  state.camera.x += (targetX - state.camera.x) * Math.min(1, dt * camCfg.followLerp);
  state.camera.y += (state.camera.snapY - state.camera.y) * Math.min(1, dt * camCfg.verticalLerp);
  state.camera.x = clamp(state.camera.x, 0, Math.max(0, boundsW - VIEW.w));
  state.camera.y = clamp(state.camera.y, 0, Math.max(0, boundsH - VIEW.h));
}

function worldToScreenX(x, scroll = 1) {
  return Math.round(x - state.camera.x * scroll + shakeOffset().x);
}

function worldToScreenY(y, scroll = 1) {
  return Math.round(y - state.camera.y * scroll + shakeOffset().y);
}

function shakeOffset() {
  if (state.camera.shakeT <= 0 || state.camera.shake <= 0) return { x: 0, y: 0 };
  return {
    x: (Math.random() * 2 - 1) * state.camera.shake,
    y: (Math.random() * 2 - 1) * state.camera.shake
  };
}
