function handleChooseKey(key) {
  if (key === "arrowleft" || key === "a" || key === "arrowup" || key === "w") {
    state.choiceIndex = (state.choiceIndex + STARTERS.length - 1) % STARTERS.length;
    updateStarterSelection();
    return true;
  }
  if (key === "arrowright" || key === "d" || key === "arrowdown" || key === "s") {
    state.choiceIndex = (state.choiceIndex + 1) % STARTERS.length;
    updateStarterSelection();
    return true;
  }
  if (key === "enter" || key === " ") {
    chooseStarter(STARTERS[state.choiceIndex].id);
    return true;
  }
  return false;
}

function battleActionEnabled(index) {
  if (state.battle?.menu === "moves") return Boolean(MOVE_ACTIONS[index]);
  return Boolean(MAIN_ACTIONS[index]);
}

function moveBattleActionCursor(dx, dy) {
  const cols = 2;
  const rows = 2;
  const current = clamp(state.battleActionIndex, 0, ACTION_BUTTONS.length - 1);
  const col = current % cols;
  const row = Math.floor(current / cols);
  const nextCol = clamp(col + dx, 0, cols - 1);
  const nextRow = clamp(row + dy, 0, rows - 1);
  const nextIndex = nextRow * cols + nextCol;
  if (battleActionEnabled(nextIndex)) state.battleActionIndex = nextIndex;
}

function moveBattleActionLinear(direction) {
  const actions = state.battle?.menu === "moves" ? MOVE_ACTIONS : MAIN_ACTIONS;
  const enabled = actions.map((action, index) => (action ? index : null)).filter((index) => index !== null);
  if (!enabled.length) return;
  const currentPosition = enabled.includes(state.battleActionIndex) ? enabled.indexOf(state.battleActionIndex) : 0;
  const nextPosition = (currentPosition + direction + enabled.length) % enabled.length;
  state.battleActionIndex = enabled[nextPosition];
  updateBattleActionSelection();
}

function handleTouchBattleKey(key) {
  const battle = state.battle;
  if (battle?.switching) {
    if (key === "arrowleft" || key === "arrowright") return handleBattleKey(key);
    return false;
  }
  if (key === "arrowleft") {
    moveBattleActionLinear(-1);
    return true;
  }
  if (key === "arrowright") {
    moveBattleActionLinear(1);
    return true;
  }
  return false;
}

function handleBattleKey(key) {
  const battle = state.battle;
  if (battle?.switching) {
    const candidates = battleSwitchCandidates();
    if (key === "escape" || key === "backspace" || key === "m") {
      cancelBattleSwitch();
      return true;
    }
    if (key === "arrowleft" || key === "a" || key === "arrowup" || key === "w") {
      state.battleSwitchIndex = (state.battleSwitchIndex + candidates.length - 1) % Math.max(1, candidates.length);
      updateBattleUI();
      return true;
    }
    if (key === "arrowright" || key === "d" || key === "arrowdown" || key === "s") {
      state.battleSwitchIndex = (state.battleSwitchIndex + 1) % Math.max(1, candidates.length);
      updateBattleUI();
      return true;
    }
    if (key === "enter" || key === " ") {
      switchBattlePartner();
      return true;
    }
    return false;
  }
  if (battle?.menu === "moves" && (key === "escape" || key === "backspace" || key === "m")) {
    closeMoveMenu();
    return true;
  }
  if (key === "arrowleft" || key === "a") {
    moveBattleActionCursor(-1, 0);
    updateBattleActionSelection();
    return true;
  }
  if (key === "arrowright" || key === "d") {
    moveBattleActionCursor(1, 0);
    updateBattleActionSelection();
    return true;
  }
  if (key === "arrowup" || key === "w") {
    moveBattleActionCursor(0, -1);
    updateBattleActionSelection();
    return true;
  }
  if (key === "arrowdown" || key === "s") {
    moveBattleActionCursor(0, 1);
    updateBattleActionSelection();
    return true;
  }
  if (key === "enter" || key === " ") {
    const actions = battle?.menu === "moves" ? MOVE_ACTIONS : MAIN_ACTIONS;
    const action = actions[state.battleActionIndex];
    if (action) action();
    return true;
  }
  return false;
}

const HANDLED_KEYS = [
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  "pageup",
  "pagedown",
  "backspace",
  " ",
  "enter",
  "escape",
  "w",
  "a",
  "s",
  "d",
  "m",
];

function handleKeyPress(key) {
  ensureAudio();

  if (state.mode === "choose") {
    if (handleChooseKey(key)) return;
  }
  if (state.mode === "menu") {
    if (handleMenuKey(key)) return;
  }
  if (state.mode === "battle") {
    if (handleBattleKey(key)) return;
  }
  if (state.mode === "dialogue") {
    if (key === " " || key === "enter" || key === "e") {
      advanceDialogue();
      return;
    }
  }
  if (state.mode === "overworld") {
    if (key === "m" || key === "escape") {
      openMenu();
      return;
    }
    if (key === " " || key === "enter" || key === "e") {
      handleAction();
      return;
    }
    if (key === "q") {
      saveGame();
      return;
    }
    if (key === "r") {
      resetGame();
      return;
    }
    if (key === "c") {
      state.debugCollision = !state.debugCollision;
      return;
    }
    state.keys.add(key);
  }
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (HANDLED_KEYS.includes(key)) event.preventDefault();
  handleKeyPress(key);
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.key.toLowerCase());
});

window.addEventListener("resize", updateStageMetrics);
window.addEventListener("orientationchange", () => setTimeout(updateStageMetrics, 120));
