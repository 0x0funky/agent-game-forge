function nearestSceneExit() {
  const exits = Object.values(collisionMap?.exits ?? {});
  return (
    exits.find((exit) => distance(state.player.x, state.player.y, exit.x, exit.y) < (exit.interactRadius ?? 82)) ||
    null
  );
}

function trySceneExit() {
  if (state.sceneExitCooldown > 0) return false;
  const sceneExit = nearestSceneExit();
  if (!sceneExit) return false;
  state.keys.clear();
  setScene(sceneExit.target, sceneExit.spawn);
  saveGame();
  return true;
}

function trainerDefeated(trainer) {
  return Boolean(trainer.flagKey && state.flags?.[trainer.flagKey]);
}

function nearestTrainer() {
  let nearest = null;
  for (const trainer of collisionMap?.trainers ?? []) {
    const gap = distance(state.player.x, state.player.y, trainer.x, trainer.y);
    if (gap < (trainer.interactRadius ?? 112) && (!nearest || gap < nearest.gap)) nearest = { trainer, gap };
  }
  return nearest?.trainer ?? null;
}

function handleTrainerAction() {
  const trainer = nearestTrainer();
  if (!trainer) return false;
  if (trainer.id === "templeMaster" && !state.flags?.templeApprentice) {
    showDialogue("玄真館主：先通過我弟子的木杖，再到我面前。");
    return true;
  }
  if (trainer.id === "mistGuard" && !state.flags?.mistScout) {
    showDialogue("霧切館守衛：先聽過前庭的水聲，再走到我這裡。");
    return true;
  }
  if (trainer.id === "mistMaster" && (!state.flags?.mistScout || !state.flags?.mistGuard)) {
    showDialogue("霧切館主：霧裡不可急行。兩名門人都認可你的步法後，再到我面前。");
    return true;
  }
  if (trainerDefeated(trainer)) {
    showDialogue(
      trainer.id === "templeMaster"
        ? "玄真館主：內殿已認得你的御魂。往後若要試煉，晴嵐之門仍會為你開著。"
        : trainer.id === "mistMaster"
          ? "霧切館主：霧雨已替你讓路。若右側古戰場仍有甲聲，就去讓它沉下。"
          : trainer.id === "mistGuard"
            ? "霧切館守衛：你的御魂站得很穩。館主會喜歡這種步法。"
          : trainer.id === "mistScout"
            ? "霧切館門人：你的步法沒有被霧吃掉。館主在高台等你。"
        : "寺門修行僧：你的御魂步伐很穩。館主就在神前等你。",
    );
    return true;
  }
  state.pendingBattle = trainer.battleKind;
  showDialogue(
    trainer.id === "templeMaster"
      ? [
          "玄真館主：能走到此處，御魂已有根。",
          "玄真館主：梵鐘鵺，試他心火。",
        ]
      : trainer.id === "mistMaster"
        ? [
            "霧切館主：你從晴嵐神社走到霧沼，腳下已經帶著兩種風。",
            "霧切館主：霧雨大蛇，替他量一量這條路的深淺。",
          ]
        : trainer.id === "mistScout"
          ? [
              "霧切館門人：霧裡出刀，先聽水聲，再看影子。",
              "霧切館門人：影螢斥候，點燈。",
            ]
          : trainer.id === "mistGuard"
            ? [
                "霧切館守衛：前庭靠眼，內庭靠腳。你的腳步夠沉嗎？",
                "霧切館守衛：細石蟹，守住水道。",
              ]
      : [
          "寺門修行僧：想見館主，先讓我看看你的御魂是否穩得住。",
          "寺門修行僧：木蓮狛，上前。",
        ],
  );
  return true;
}

function handleAction() {
  if (state.mode === "dialogue") {
    advanceDialogue();
    return;
  }
  if (state.mode !== "overworld") return;
  if (["temple", "mistDojo"].includes(state.scene)) {
    handleTrainerAction();
    return;
  }
  const npc = collisionMap.npc;
  const interactRadius = npc?.interactRadius ?? 112;
  const npcDistance = npc ? distance(state.player.x, state.player.y, npc.x, npc.y) : Infinity;
  const rest = collisionMap.rest;
  const atRestPoint = isAtRestPoint();
  const restDistance = rest ? distance(state.player.x, state.player.y, rest.x, rest.y) : Infinity;
  const restPriorityRadius = rest?.interactRadius ?? 76;
  const boss = collisionMap.boss;
  if (boss && !bossDefeated(boss) && distance(state.player.x, state.player.y, boss.x, boss.y) < (boss.interactRadius ?? 112)) {
    state.pendingBattle = boss.battleKind || "boss";
    showDialogue(
      state.pendingBattle === "marshBoss"
        ? [
            "沼鎧蜈蚣：……甲……泥……百足不退。",
            "葵：它不是守路，是被古戰場困在這裡。小心，它比朱角更硬。",
          ]
        : [
            "朱角鬼大將：晴嵐的小御魂使啊，你也想替敗軍收魂嗎？",
            "朱角鬼大將：拔出符紙。讓我看看這座神社還剩多少風。",
          ],
    );
    return;
  }
  if (atRestPoint && (restDistance <= restPriorityRadius || restDistance + 16 < npcDistance)) {
    healPartner();
    showDialogue(state.scene === "mistMarsh" ? "你在霧沼邊的水鉢旁整備。濕冷霧氣替御魂壓住躁動。" : "你在神社前的手水鉢旁整備。御魂的氣息重新穩住了。");
    return;
  }
  if (npcDistance < interactRadius) {
    if (state.scene === "outdoor" && state.flags?.templeMaster) {
      state.pendingSceneChange = { target: "mistMarsh", spawn: collisionMaps.mistMarsh?.spawn };
      showDialogue([
        "葵：玄真館主已經承認你了。神社外的霧沼古戰場，也開始傳來御魂的聲音。",
        "葵：那裡有新的草叢、新的道館，還有一隻藏在霧裡的稀有御魂。要換地圖過去嗎？",
        "葵：如果準備好了，按「續」。我帶你走霧沼那條舊軍道。",
      ]);
    } else if (state.scene === "mistMarsh") {
      state.pendingSceneChange = { target: "outdoor", spawn: { x: 836, y: 470 } };
      showDialogue([
        state.flags?.mistMaster
          ? "葵：霧切館的霧雨停了。右側古戰場若還有甲片聲，之後再回來處理也行。"
          : "葵：左側葦草有新的御魂，西南小島的霧最怪。上方霧切館是這片濕地的道館。",
        "葵：要回晴嵐神社的話，我帶你走舊軍道。霧沼的路不能只靠腳記。",
      ]);
    } else {
      showDialogue(
        state.flags?.boss
          ? "葵：朱角退去後，山風變輕了。先去內殿打完館主，再來找我談下一張地圖。"
          : state.flags?.gate
            ? "葵：山道已開。瀑布旁有一股更重的戰意，別讓御魂空著血量去碰它。"
            : "葵：左側草深處能磨練御魂，右側演武場的黑鎧怨靈才是封住山道的主因。",
      );
    }
    return;
  }
  if (atRestPoint) {
    healPartner();
    showDialogue(state.scene === "mistMarsh" ? "你在霧沼邊的水鉢旁整備。濕冷霧氣替御魂壓住躁動。" : "你在神社前的手水鉢旁整備。御魂的氣息重新穩住了。");
  }
}
