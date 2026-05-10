function showDialogue(lines) {
  state.mode = state.mode === "battle" ? "battle" : "dialogue";
  state.dialogueQueue = Array.isArray(lines) ? [...lines] : [lines];
  advanceDialogue();
}

function advanceDialogue() {
  const next = state.dialogueQueue.shift();
  if (next) {
    dom.dialogueText.textContent = next;
    dom.dialogue.classList.remove("hidden");
    return;
  }
  dom.dialogue.classList.add("hidden");
  if (state.pendingBattle && !state.battle) {
    const kind = state.pendingBattle;
    state.pendingBattle = null;
    state.mode = "overworld";
    setPanels();
    startBattle(kind);
    return;
  }
  if (state.pendingSceneChange) {
    const nextScene = state.pendingSceneChange;
    state.pendingSceneChange = null;
    state.mode = "overworld";
    setScene(nextScene.target, nextScene.spawn);
    saveGame();
    setPanels();
    return;
  }
  if (!state.battle) state.mode = "overworld";
  setPanels();
}

function setPanels() {
  const choosing = state.mode === "choose";
  updateStageMetrics();
  dom.choicePanel.classList.toggle("hidden", !choosing);
  dom.hud.classList.toggle("hidden", choosing || state.mode === "battle" || state.mode === "menu" || state.mode === "transition");
  dom.menuPanel.classList.toggle("hidden", state.mode !== "menu");
  dom.battlePanel.classList.toggle("hidden", state.mode !== "battle");
  dom.mobileControls?.classList.toggle(
    "hidden",
    choosing || state.mode === "dialogue" || state.mode === "transition",
  );
  dom.mobileControls?.setAttribute("data-mode", state.mode);
  updateHud();
  updateStarterSelection();
  renderMenu();
  updateBattleActionSelection();
}

function updateStageMetrics() {
  if (!dom.gameStage) return;
  const stageRect = dom.gameStage.getBoundingClientRect();
  const gameRect = canvas.getBoundingClientRect();
  dom.gameStage.style.setProperty("--game-top", `${gameRect.top - stageRect.top}px`);
  dom.gameStage.style.setProperty("--game-bottom", `${gameRect.bottom - stageRect.top}px`);
  dom.gameStage.style.setProperty("--game-width", `${gameRect.width}px`);
}

function updateHud() {
  if (dom.areaName) dom.areaName.textContent = currentSceneName();
  if (!state.partnerId) {
    dom.partnerBadge.textContent = "";
    return;
  }
  const partner = currentPartner();
  if (!partner) return;
  const progress = progressFor(state.partnerId);
  const hp = ensurePartnerHp(state.partnerId);
  const next = nextLevelXp(progress.level);
  const growth = Number.isFinite(next) ? ` 御印 ${progress.xp}/${next}` : " 御印滿階";
  dom.partnerBadge.textContent = `${partner.mark} ${partner.name} Lv.${progress.level} HP ${hp}/${partner.maxHp}${growth}`;
}

function renderStarterCards() {
  dom.starterGrid.innerHTML = "";
  for (const starter of STARTERS) {
    const card = document.createElement("article");
    card.className = "starter-card";
    card.dataset.type = starter.type;
    card.dataset.starterId = starter.id;
    card.setAttribute("role", "option");

    const img = document.createElement("img");
    img.src = `assets/sprites/${starter.id}/animation.gif`;
    img.alt = starter.name;

    const title = document.createElement("h2");
    title.textContent = `${starter.mark} ${starter.name}`;

    const desc = document.createElement("p");
    desc.textContent = starter.desc;

    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.textContent = "候補";

    card.addEventListener("click", () => {
      state.choiceIndex = STARTERS.findIndex((candidate) => candidate.id === starter.id);
      updateStarterSelection();
      chooseStarter(starter.id);
    });

    card.append(img, title, desc, button);
    dom.starterGrid.append(card);
  }
  updateStarterSelection();
}

function updateStarterSelection() {
  const cards = [...dom.starterGrid.querySelectorAll(".starter-card")];
  cards.forEach((card, index) => {
    const selected = index === state.choiceIndex;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", String(selected));
    const button = card.querySelector("button");
    if (button) button.textContent = selected ? "締結" : "候補";
  });
}

function chooseStarter(id) {
  ensureAudio();
  playSound("confirm");
  setScene("outdoor", collisionMaps.outdoor?.spawn);
  state.partnerId = id;
  state.ownedMitama = [id];
  state.inventory = defaultInventory();
  progressFor(id);
  ensurePartnerHp(id);
  state.mode = "overworld";
  const spawn = collisionMap?.spawn ?? fallbackSpawn();
  state.player.x = spawn.x;
  state.player.y = spawn.y;
  saveGame();
  setPanels();
  const partner = starterById(id);
  showDialogue([
    `葵：${partner.name} 願意與你同路。左側草深處有騷動，右側演武場則被黑鎧怨靈鎮住。`,
    "葵：御魂會在戰鬥後累積御印。御印升階時，御術也會跟著改變形態。",
  ]);
}

function startLoadedGame() {
  if (loadSave()) {
    state.mode = "overworld";
    setPanels();
    showDialogue("葵：你回來了。御魂仍在你身邊，山道的封印也記得你的戰績。");
  } else {
    state.mode = "choose";
    setPanels();
  }
}

function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(PREVIOUS_SAVE_KEY);
  localStorage.removeItem(OLD_SAVE_KEY);
  localStorage.removeItem("seiran-mitama-save-v1");
  state.partnerId = null;
  state.scene = "outdoor";
  collisionMap = collisionMaps.outdoor || collisionMap;
  state.flags = {};
  state.choiceIndex = 0;
  state.battleActionIndex = 0;
  state.menuIndex = 0;
  state.menuSubIndex = 0;
  state.menuDetail = null;
  state.partnerProgress = {};
  state.partnerHp = {};
  state.ownedMitama = [];
  state.inventory = defaultInventory();
  state.seenDex = {};
  const spawn = collisionMap?.spawn ?? fallbackSpawn();
  state.player.x = spawn.x;
  state.player.y = spawn.y;
  state.mode = "choose";
  state.battle = null;
  state.pendingBattle = null;
  state.pendingSceneChange = null;
  state.menuMessage = "";
  dom.dialogue.classList.add("hidden");
  setPanels();
}
