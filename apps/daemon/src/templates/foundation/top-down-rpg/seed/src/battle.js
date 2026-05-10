// ----- Battle-kind tables -----
// Boss kinds set a permanent state.flags entry. Adding a new boss is now
// a 3-step pure-data task:
//   1. Add `flagKey` to the boss/trainer entry in the level's collision-map.json
//   2. Add the kind to BOSS_KIND_FLAGS below
//   3. Add a runDialogue + victoryDialogue entry to data/battle-strings.json
// No JS code path changes.

const BOSS_KIND_FLAGS = new Set([
  "gate", "boss", "marshBoss",
  "templeApprentice", "templeMaster",
  "mistScout", "mistGuard", "mistMaster",
]);

const TEMPLE_BATTLE_KINDS = new Set([
  "templeApprentice", "templeMaster",
  "mistScout", "mistGuard", "mistMaster",
]);

// xpKind keys used by battleConfig.xpRewards. Same as battle.kind for boss
// kinds; falls through to grass-tier keys for wild encounters.
function resolveXpKind(kind) {
  if (BOSS_KIND_FLAGS.has(kind)) return kind;
  if (kind === "mistHidden") return "mistHidden";
  if (kind === "mistGrass") return "mistGrass";
  return "grass";
}

// Run-away dialogue for the given battle kind, with sensible fallback.
function resolveRunMessage(kind) {
  return battleString(`runDialogue.${kind}`)
    ?? (TEMPLE_BATTLE_KINDS.has(kind) ? battleString("runDialogue.templeBattle") : null)
    ?? battleString("runDialogue.default")
    ?? "你後退離開戰場。";
}

// Victory dialogue for the given battle kind, with default fallback.
// Returns string OR array (multi-line).
function resolveVictoryMessage(kind, growthText, enemyName) {
  const specific = battleString(`victoryDialogue.${kind}`, { growth: growthText, enemy: enemyName });
  if (specific) return specific;
  return battleString("victoryDialogue.default", { growth: growthText, enemy: enemyName })
    ?? `${enemyName} 散去。${growthText}`;
}

// Capture-success dialogue, branching on whether spirit was already in roster.
function resolveCaptureMessage(growthText, enemyName, alreadyOwned) {
  const path = alreadyOwned ? "captureCircle.duplicate" : "captureCircle.added";
  return battleString(path, { growth: growthText, enemy: enemyName })
    ?? `${enemyName} 被降伏。${growthText}`;
}

// Loss dialogue branches on indoor vs outdoor scene.
function resolveLossMessage() {
  const indoor = ["temple", "mistDojo"].includes(state.scene);
  return battleString(indoor ? "lossDialogue.indoor" : "lossDialogue.default")
    ?? "你的御魂倒下，回神社整備。";
}

function startBattle(kind) {
  if (!state.partnerId || state.battle || state.mode === "transition") return;
  if (!ensureBattleReadyPartner()) {
    showDialogue(battleString("noPartner") ?? "同行御魂都已無法戰鬥。");
    return;
  }
  state.keys.clear();
  state.transition = { kind: "battleStart", t: 0, duration: BATTLE_CONFIG.transitions?.start ?? 0, battleKind: kind };
  state.mode = "transition";
  setPanels();
}

function beginBattle(kind) {
  if (!state.partnerId || state.battle) return;
  startMusic("battle");
  playSound("scene");
  const allyTemplate = ensureBattleReadyPartner();
  if (!allyTemplate) return;
  const enemyBase = enemyTemplateForBattle(kind);
  const enemyTemplate = scaledEnemy(enemyBase, enemyLevelFor(kind, enemyBase));
  state.seenDex[enemyTemplate.id] = true;
  const enemy = makeCombatant(enemyTemplate);

  state.battle = {
    kind,
    returnPoint: battleReturnPoint(kind),
    ally: { ...makeCombatant(allyTemplate), hp: ensurePartnerHp(allyTemplate.id) },
    enemy,
    locked: false,
    menu: "main",
    switching: false,
    forceSwitch: false,
    switchMessage: "",
    log: enemy.intro,
    allyHop: 0,
    enemyHop: 0,
    effects: [],
  };
  state.mode = "battle";
  state.battleActionIndex = 0;
  state.battleSwitchIndex = 0;
  dom.dialogue.classList.add("hidden");
  setPanels();
  updateBattleUI();
  state.transition = { kind: "battleReveal", t: 0, duration: BATTLE_CONFIG.transitions?.reveal ?? 0 };
}

function typeBonus(attacker, defender) {
  const advantage = BATTLE_CONFIG.typeAdvantage ?? {};
  const bonus = BATTLE_CONFIG.typeBonus ?? {};
  if (advantage[attacker.type] === defender.type) return Number(bonus.strong) || 1;
  if (advantage[defender.type] === attacker.type) return Number(bonus.weak) || 1;
  return Number(bonus.neutral) || 1;
}

function damage(attacker, defender, power, variance = null) {
  const config = BATTLE_CONFIG.damage ?? {};
  const effectiveVariance = variance ?? (Number(config.defaultVariance) || 0);
  const roll = Math.floor(Math.random() * effectiveVariance);
  return Math.max(
    Number(config.minimum) || 0,
    Math.floor(
      power +
        attacker.atk * (Number(config.atkScale) || 0) +
        attacker.art * (Number(config.artScale) || 0) +
        attacker.level * (Number(config.levelScale) || 0) -
        defender.guard * (Number(config.guardScale) || 0) +
        roll,
    ),
  );
}

function spawnFx(kind, x, y, size, duration) {
  const battle = state.battle;
  if (!battle) return;
  battle.effects.push({ kind, x, y, size, duration, t: 0 });
}

function openMoveMenu() {
  const battle = state.battle;
  if (!battle || battle.locked || battle.switching) return;
  playSound("confirm");
  battle.menu = "moves";
  state.battleActionIndex = 0;
  battle.log = "選擇招式。";
  updateBattleUI();
}

function closeMoveMenu() {
  const battle = state.battle;
  if (!battle || battle.locked || battle.switching) return;
  playSound("confirm");
  battle.menu = "main";
  state.battleActionIndex = 0;
  battle.log = "選擇行動。";
  updateBattleUI();
}

function performAttack() {
  const battle = state.battle;
  if (!battle || battle.locked || battle.switching) return;
  battle.menu = "main";
  state.battleActionIndex = 0;
  battle.locked = true;
  const action = BATTLE_CONFIG.actions?.attack ?? {};
  const effect = BATTLE_CONFIG.effects?.attack ?? {};
  const dealt = damage(battle.ally, battle.enemy, Number(action.power) || 0);
  battle.enemy.hp = Math.max(0, battle.enemy.hp - dealt);
  battle.allyHop = 1;
  spawnFx(effect.kind ?? "shadow", effect.x, effect.y, effect.size, effect.duration);
  playSound("attack");
  battle.log = `${battle.ally.name} 以短斬破陣，造成 ${dealt} 點傷害。`;
  updateBattleUI();
  if (battle.enemy.hp <= 0) return finishBattle("defeat");
  setTimeout(enemyTurn, Number(action.enemyDelay) || 0);
}

function performSkill() {
  const battle = state.battle;
  if (!battle || battle.locked || battle.switching) return;
  battle.menu = "main";
  state.battleActionIndex = 0;
  battle.locked = true;
  const action = BATTLE_CONFIG.actions?.skill ?? {};
  const effect = BATTLE_CONFIG.effects?.skill ?? {};
  const bonus = typeBonus(battle.ally, battle.enemy);
  const levelBoost = (Number(action.levelBoostBase) || 0) + (battle.ally.level - 1) * (Number(action.levelBoostPerLevel) || 0);
  const dealt = Math.floor(
    damage(battle.ally, battle.enemy, (Number(action.basePower) || 0) + battle.ally.level * (Number(action.levelPower) || 0), Number(action.variance) || 0) *
      bonus *
      levelBoost,
  );
  battle.enemy.hp = Math.max(0, battle.enemy.hp - dealt);
  battle.allyHop = 1;
  spawnFx(battle.ally.type, effect.x, effect.y, effect.size, effect.duration);
  playSound("skill");
  if (battle.ally.type === "water") {
    const heal = Math.min((Number(action.waterHealBase) || 0) + battle.ally.level * (Number(action.waterHealPerLevel) || 0), battle.ally.maxHp - battle.ally.hp);
    battle.ally.hp += heal;
    battle.log = `${battle.ally.name} 施展${battle.ally.skill}，造成 ${dealt} 點傷害並回穩 ${heal} 點。`;
  } else if (battle.ally.type === "earth") {
    battle.ally.guard += Number(action.earthGuard) || 0;
    battle.log = `${battle.ally.name} 施展${battle.ally.skill}，造成 ${dealt} 點傷害並強化守勢。`;
  } else {
    battle.log = `${battle.ally.name} 施展${battle.ally.skill}，造成 ${dealt} 點傷害。`;
  }
  updateBattleUI();
  if (battle.enemy.hp <= 0) return finishBattle("defeat");
  setTimeout(enemyTurn, Number(action.enemyDelay) || 0);
}

function performBind() {
  const battle = state.battle;
  if (!battle || battle.locked || battle.switching) return;
  battle.menu = "main";
  if (!battle.enemy.capturable) {
    battle.log = `${battle.enemy.name} 的戰意太重，現在只能擊退，無法降伏。`;
    updateBattleUI();
    return;
  }
  if (state.ownedMitama.includes(battle.enemy.id)) {
    battle.log = `${battle.enemy.name} 已在你的御魂名冊中。`;
    updateBattleUI();
    return;
  }
  if (!spendItem("sealCharm")) {
    battle.log = "降伏符已用完。回神社手水鉢休息，可以補到 5 張。";
    updateBattleUI();
    return;
  }
  battle.locked = true;
  const action = BATTLE_CONFIG.actions?.bind ?? {};
  const effect = BATTLE_CONFIG.effects?.bind ?? {};
  const missing = 1 - battle.enemy.hp / battle.enemy.maxHp;
  const threshold = Number(action.lowHpThreshold) || 0;
  const chance =
    battle.enemy.hp <= battle.enemy.maxHp * threshold
      ? (Number(action.lowHpBase) || 0) + missing * (Number(action.lowHpMissingScale) || 0)
      : (Number(action.base) || 0) + missing * (Number(action.missingScale) || 0);
  spawnFx(effect.kind ?? "earth", effect.x, effect.y, effect.size, effect.duration);
  if (Math.random() < chance) {
    playSound("capture");
    battle.log = `降伏符鎖住氣脈，${battle.enemy.name} 低頭受令。`;
    updateBattleUI();
    return setTimeout(() => finishBattle("capture"), Number(action.successDelay) || 0);
  }
  playSound("fail");
  battle.log = `降伏符被震開，還需要再削弱它。剩餘 ${inventoryCount("sealCharm")} 張。`;
  updateBattleUI();
  setTimeout(enemyTurn, Number(action.enemyDelay) || 0);
}

function enemyTurn() {
  const battle = state.battle;
  if (!battle || state.mode !== "battle") return;
  const action = BATTLE_CONFIG.actions?.enemyTurn ?? {};
  const effect = BATTLE_CONFIG.effects?.enemyTurn ?? {};
  const heavy = Math.random() < (Number(action.heavyChance) || 0);
  const dealt = Math.floor(
    damage(battle.enemy, battle.ally, heavy ? Number(action.heavyPower) || 0 : Number(action.normalPower) || 0, Number(action.variance) || 0) *
      typeBonus(battle.enemy, battle.ally),
  );
  battle.ally.hp = Math.max(0, battle.ally.hp - dealt);
  battle.enemyHop = 1;
  spawnFx(battle.enemy.skillFx ?? "shadow", effect.x, effect.y, heavy ? effect.heavySize : effect.normalSize, effect.duration);
  playSound(heavy ? "skill" : "hit");
  battle.log = heavy
    ? `${battle.enemy.name} 施展${battle.enemy.skill}，造成 ${dealt} 點傷害。`
    : `${battle.enemy.name} 逼近一擊，造成 ${dealt} 點傷害。`;
  battle.locked = false;
  updateBattleUI();
  if (battle.ally.hp <= 0) handleAllyFaint();
}

function runBattle() {
  const battle = state.battle;
  if (!battle || battle.locked || battle.switching) return;
  battle.menu = "main";
  finishBattle("run");
}

function battleSwitchCandidates() {
  return aliveOwnedMitamas(state.battle?.ally?.id);
}

function switchListText() {
  const candidates = battleSwitchCandidates();
  if (!candidates.length) return "沒有可換上的御魂。";
  state.battleSwitchIndex = clamp(state.battleSwitchIndex, 0, candidates.length - 1);
  return candidates
    .map((mitama, index) => {
      const hp = ensurePartnerHp(mitama.id);
      const pointer = index === state.battleSwitchIndex ? "▶ " : "   ";
      return `${pointer}${mitama.mark} ${mitama.name} Lv.${mitama.level} HP ${hp}/${mitama.maxHp}`;
    })
    .join("\n");
}

function openBattleSwitch(force = false, message = "") {
  const battle = state.battle;
  if (!battle || battle.locked) return;
  const candidates = battleSwitchCandidates();
  if (!candidates.length) {
    battle.switching = false;
    battle.forceSwitch = false;
    battle.menu = "main";
    battle.log = "沒有其他能戰鬥的御魂。";
    updateBattleUI();
    return;
  }
  battle.menu = "main";
  battle.switching = true;
  battle.forceSwitch = force;
  battle.switchMessage = message || "選擇要換上的御魂。";
  state.battleSwitchIndex = clamp(state.battleSwitchIndex, 0, candidates.length - 1);
  updateBattleUI();
}

function cancelBattleSwitch() {
  const battle = state.battle;
  if (!battle || battle.forceSwitch) return;
  battle.switching = false;
  battle.switchMessage = "";
  updateBattleUI();
}

function switchBattlePartner() {
  const battle = state.battle;
  if (!battle || !battle.switching) return;
  const candidates = battleSwitchCandidates();
  const selected = candidates[state.battleSwitchIndex];
  if (!selected) return;
  const previousId = battle.ally.id;
  if (previousId) setPartnerHp(previousId, battle.ally.hp);
  state.partnerId = selected.id;
  const next = scaledMitama(mitamaById(selected.id));
  battle.ally = { ...makeCombatant(next), hp: ensurePartnerHp(selected.id) };
  const wasForced = battle.forceSwitch;
  battle.switching = false;
  battle.forceSwitch = false;
  battle.switchMessage = "";
  battle.menu = "main";
  battle.allyHop = 1;
  battle.log = `${next.name} 上前接戰。`;
  playSound("confirm");
  if (!wasForced) battle.locked = true;
  saveGame();
  updateBattleUI();
  if (!wasForced) {
    setTimeout(enemyTurn, Number(BATTLE_CONFIG.actions?.switch?.enemyDelay) || 0);
  }
}

function handleAllyFaint() {
  const battle = state.battle;
  if (!battle) return;
  setPartnerHp(battle.ally.id, 0);
  const candidates = battleSwitchCandidates();
  if (!candidates.length) return finishBattle("lose");
  battle.locked = false;
  openBattleSwitch(true, `${battle.ally.name} 倒下了。選擇下一隻御魂。`);
}

function battleXpReward(kind, enemy) {
  const levelPart = Math.max(0, enemy?.level ?? 1);
  const reward = BATTLE_CONFIG.xpRewards?.[kind] ?? BATTLE_CONFIG.xpRewards?.default ?? {};
  return Math.floor((Number(reward.base) || 0) + levelPart * (Number(reward.levelScale) || 0));
}

function awardExperience(kind, enemy = null) {
  if (!state.partnerId) return "";
  const progress = progressFor(state.partnerId);
  if (progress.level >= MAX_LEVEL) return "御印已達滿階。";
  const gained = battleXpReward(kind, enemy);
  progress.xp += gained;
  const partner = mitamaById(state.partnerId);
  const messages = [`${partner.name} 得到 ${gained} 枚御印。`];
  let leveled = false;
  let evolved = false;
  while (progress.level < MAX_LEVEL && progress.xp >= nextLevelXp(progress.level)) {
    const previousSkill = skillFor(partner, progress.level);
    const previousForm = formFor(partner, progress.level).name;
    progress.xp -= nextLevelXp(progress.level);
    progress.level += 1;
    const nextSkill = skillFor(partner, progress.level);
    const nextForm = formFor(partner, progress.level).name;
    leveled = true;
    if (previousForm !== nextForm) {
      evolved = true;
      messages.push(`${previousForm} 進化為「${nextForm}」。`);
    }
    messages.push(
      previousSkill === nextSkill
        ? `${partner.name} 升至 Lv.${progress.level}，氣勢更穩。`
        : `${partner.name} 升至 Lv.${progress.level}，御術化為「${nextSkill}」。`,
    );
  }
  if (evolved) playSound("evolve");
  else if (leveled) playSound("level");
  return messages.join(" ");
}

function finishBattle(result) {
  const battle = state.battle;
  if (!battle) return;
  battle.locked = true;
  updateBattleUI();
  setTimeout(() => {
    const kind = battle.kind;
    if (state.partnerId) setPartnerHp(state.partnerId, battle.ally.hp);
    state.battle = null;
    state.mode = "overworld";
    setPanels();
    state.transition = { kind: "battleEnd", t: 0, duration: BATTLE_CONFIG.transitions?.end ?? 0 };
    if (result === "lose") {
      playSound("lose");
      startSceneMusic();
      const point = defeatReturnPoint();
      state.player.x = point.x;
      state.player.y = point.y;
      saveGame();
      showDialogue(resolveLossMessage());
    } else if (result === "run") {
      startSceneMusic();
      const point = battle.returnPoint || findSafePoint(state.player.x, state.player.y);
      state.player.x = point.x;
      state.player.y = point.y;
      state.encounterCharge = 0;
      saveGame();
      showDialogue(resolveRunMessage(kind));
    } else if (result === "capture") {
      const growthText = awardExperience(resolveXpKind(kind), battle.enemy);
      const alreadyOwned = !addOwnedMitama(battle.enemy.id);
      if (BOSS_KIND_FLAGS.has(kind)) state.flags[kind] = true;
      saveGame();
      startSceneMusic();
      showDialogue(resolveCaptureMessage(growthText, battle.enemy.name, alreadyOwned));
    } else {
      const growthText = awardExperience(resolveXpKind(kind), battle.enemy);
      if (BOSS_KIND_FLAGS.has(kind)) state.flags[kind] = true;
      for (const reward of BATTLE_CONFIG.itemRewards?.[kind] ?? []) addItem(reward.item, reward.amount);
      saveGame();
      playSound("victory");
      startSceneMusic();
      showDialogue(resolveVictoryMessage(kind, growthText, battle.enemy.name));
    }
  }, result === "lose" ? Number(BATTLE_CONFIG.finishDelays?.lose) || 0 : Number(BATTLE_CONFIG.finishDelays?.default) || 0);
}

function updateBattleUI() {
  const battle = state.battle;
  if (!battle) return;
  dom.allyName.textContent = `${battle.ally.name} Lv.${battle.ally.level}`;
  dom.enemyName.textContent = `${battle.enemy.name} Lv.${battle.enemy.level ?? 1}`;
  dom.allyHpText.textContent = `${battle.ally.hp}/${battle.ally.maxHp}`;
  dom.enemyHpText.textContent = `${battle.enemy.hp}/${battle.enemy.maxHp}`;
  dom.allyHpBar.style.width = `${(battle.ally.hp / battle.ally.maxHp) * 100}%`;
  dom.enemyHpBar.style.width = `${(battle.enemy.hp / battle.enemy.maxHp) * 100}%`;
  dom.battleLog.textContent = battle.switching ? `${battle.switchMessage}\n${switchListText()}` : battle.log;
  if (battle.menu === "moves") {
    dom.attackBtn.textContent = "斬擊";
    dom.bindBtn.textContent = battle.ally.skill;
    dom.switchBtn.textContent = "返回";
    dom.runBtn.textContent = "　";
  } else {
    dom.attackBtn.textContent = "攻擊";
    dom.bindBtn.textContent = `道具 ${inventoryCount("sealCharm")}`;
    dom.switchBtn.textContent = `換御魂 ${aliveOwnedMitamas(battle.ally.id).length}`;
    dom.runBtn.textContent = "撤退";
  }
  for (const button of ACTION_BUTTONS) button.disabled = battle.locked || battle.switching;
  if (battle.menu === "moves") dom.runBtn.disabled = true;
  updateBattleActionSelection();
}

function updateBattleActionSelection() {
  ACTION_BUTTONS.forEach((button, index) => {
    const selected = state.mode === "battle" && !state.battle?.switching && index === state.battleActionIndex;
    button.classList.toggle("is-selected", selected);
    button.tabIndex = selected ? 0 : -1;
  });
}
