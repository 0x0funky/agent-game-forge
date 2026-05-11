let lastFrame = 0;

async function boot() {
  initDom();
  initInput();
  await loadConfigs();
  await loadCatalogs();
  await loadGameData();
  await switchScene(GAME.startScene, { newPlayer: true, keepMode: true });
  state.mode = GAME.startMode;
  requestAnimationFrame(frame);
}

function frame(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.05, lastFrame ? now - lastFrame : 0);
  lastFrame = now;
  state.time += dt;
  state.titleBlink += dt;
  updateInput();
  handleGlobalInput();
  updateScene(dt);
  updateDialogue(dt);
  updateParticles(dt);
  tickMusic(dt);
  renderFrame();
  requestAnimationFrame(frame);
}

function handleGlobalInput() {
  if (state.mode === "title" && wasPressed("start")) {
    startNewRun();
    return;
  }
  if ((state.mode === "gameover" || state.mode === "win") && wasPressed("start")) {
    startNewRun();
    return;
  }
  if ((state.mode === "playing" || state.mode === "paused") && wasPressed("pause")) {
    state.mode = state.mode === "paused" ? "playing" : "paused";
  }
  if (state.message && wasPressed("interact")) state.message = null;
}

boot().catch((err) => {
  console.error(err);
  state.error = err;
  if (dom.ctx) {
    dom.ctx.fillStyle = "#300";
    dom.ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    dom.ctx.fillStyle = "#f2e7d0";
    dom.ctx.font = "18px monospace";
    dom.ctx.fillText("Boot failed: " + (err.message || err), 30, 60);
  }
});
