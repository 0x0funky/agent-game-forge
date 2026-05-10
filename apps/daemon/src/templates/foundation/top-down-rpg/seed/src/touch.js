const touchState = {
  joystickPointerId: null,
  navKey: null,
  navTimer: null,
  lastNavKey: null,
};

function clearTouchMoveKeys() {
  for (const key of TOUCH_MOVE_KEYS) state.keys.delete(key);
}

function setTouchStick(x = 0, y = 0) {
  if (!dom.touchJoystick) return;
  dom.touchJoystick.style.setProperty("--stick-x", `${x}px`);
  dom.touchJoystick.style.setProperty("--stick-y", `${y}px`);
}

function dominantTouchKey(x, y) {
  if (Math.abs(x) < 0.32 && Math.abs(y) < 0.32) return null;
  if (state.mode === "battle") {
    if (Math.abs(x) < 0.32) return null;
    return x < 0 ? "arrowleft" : "arrowright";
  }
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? "arrowleft" : "arrowright";
  return y < 0 ? "arrowup" : "arrowdown";
}

function updateTouchJoystick(clientX, clientY) {
  const rect = dom.touchJoystick.getBoundingClientRect();
  const radius = rect.width / 2;
  const centerX = rect.left + radius;
  const centerY = rect.top + radius;
  const rawX = (clientX - centerX) / radius;
  const rawY = (clientY - centerY) / radius;
  const distanceValue = Math.min(1, Math.hypot(rawX, rawY));
  const angle = Math.atan2(rawY, rawX);
  const x = Math.cos(angle) * distanceValue;
  const y = Math.sin(angle) * distanceValue;
  setTouchStick(x * radius * 0.48, y * radius * 0.48);

  if (state.mode === "overworld") {
    touchState.navKey = null;
    clearTouchMoveKeys();
    if (x < -0.28) state.keys.add("arrowleft");
    if (x > 0.28) state.keys.add("arrowright");
    if (y < -0.28) state.keys.add("arrowup");
    if (y > 0.28) state.keys.add("arrowdown");
    return;
  }

  clearTouchMoveKeys();
  touchState.navKey = dominantTouchKey(x, y);
  if (touchState.navKey && touchState.navKey !== touchState.lastNavKey) {
    if (state.mode === "battle") handleTouchBattleKey(touchState.navKey);
    else handleKeyPress(touchState.navKey);
    touchState.lastNavKey = touchState.navKey;
  }
}

function stopTouchJoystick() {
  touchState.joystickPointerId = null;
  touchState.navKey = null;
  touchState.lastNavKey = null;
  if (touchState.navTimer) clearInterval(touchState.navTimer);
  touchState.navTimer = null;
  clearTouchMoveKeys();
  setTouchStick(0, 0);
}

function pressTouchKey(key) {
  handleKeyPress(key);
}

function bindTouchControls() {
  if (!dom.touchJoystick) return;
  dom.touchJoystick.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    ensureAudio();
    touchState.joystickPointerId = event.pointerId;
    dom.touchJoystick.setPointerCapture(event.pointerId);
    updateTouchJoystick(event.clientX, event.clientY);
    if (!touchState.navTimer) {
      touchState.navTimer = setInterval(() => {
        if (!touchState.navKey) return;
        if (state.mode === "battle") handleTouchBattleKey(touchState.navKey);
        else handleKeyPress(touchState.navKey);
      }, 190);
    }
  });
  dom.touchJoystick.addEventListener("pointermove", (event) => {
    if (event.pointerId !== touchState.joystickPointerId) return;
    event.preventDefault();
    updateTouchJoystick(event.clientX, event.clientY);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    dom.touchJoystick.addEventListener(eventName, stopTouchJoystick);
  }
  dom.touchAction?.addEventListener("click", () => pressTouchKey("enter"));
  dom.touchBack?.addEventListener("click", () => pressTouchKey("escape"));
  dom.touchMenu?.addEventListener("click", () => pressTouchKey("m"));
  ACTION_BUTTONS.forEach((button, index) => {
    button.addEventListener("click", () => {
      if (state.mode !== "battle" || !state.battle || button.disabled) return;
      ensureAudio();
      state.battleActionIndex = index;
      updateBattleActionSelection();
      handleBattleKey("enter");
    });
  });
}
