function showMessage(text, seconds = 3) {
  state.message = { text, t: seconds, max: seconds };
}

function updateDialogue(dt) {
  if (!state.message) return;
  state.message.t -= dt;
  if (state.message.t <= 0) state.message = null;
}

function triggerStory(id, text) {
  if (state.storyTriggers[id]) return;
  state.storyTriggers[id] = true;
  showMessage(text, 4);
}
