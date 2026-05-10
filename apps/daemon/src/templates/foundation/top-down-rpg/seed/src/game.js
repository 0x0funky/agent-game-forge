const ACTION_BUTTONS = [dom.attackBtn, dom.bindBtn, dom.switchBtn, dom.runBtn];
const MAIN_ACTIONS = [openMoveMenu, performBind, openBattleSwitch, runBattle];
const MOVE_ACTIONS = [performAttack, performSkill, closeMoveMenu, null];

function update(dt) {
  if (state.transition) updateTransition(dt);
  if (state.mode === "overworld") updateOverworld(dt);
  if (state.mode === "battle") updateBattleAnimations(dt);
}

function draw(now) {
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);
  if (state.mode === "choose") drawChoose();
  else if (state.mode === "battle") drawBattle(now);
  else drawOverworld(now);
  drawTransition();
}

let previous = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  update(dt);
  draw(now);
  requestAnimationFrame(loop);
}

window.addEventListener("pointerdown", ensureAudio);
dom.dialogueNext.addEventListener("click", () => {
  ensureAudio();
  playSound("confirm");
  advanceDialogue();
});
bindTouchControls();
updateStageMetrics();

loadAssets()
  .then(() => {
    renderStarterCards();
    startLoadedGame();
    requestAnimationFrame(loop);
  })
  .catch((error) => {
    dom.choicePanel.classList.remove("hidden");
    dom.starterGrid.textContent = error.message;
  });
