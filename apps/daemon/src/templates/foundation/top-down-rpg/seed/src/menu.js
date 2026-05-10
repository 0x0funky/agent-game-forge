function menuItemDisabled(index) {
  if (index === 4) return !state.partnerId || !isAtRestPoint();
  return false;
}

function renderMenu() {
  if (!dom.menuOptions || !dom.menuStatus) return;
  dom.menuOptions.innerHTML = "";
  MENU_ITEMS.forEach((label, index) => {
    const item = document.createElement("div");
    item.className = "menu-item";
    item.classList.toggle("is-selected", state.mode === "menu" && index === state.menuIndex);
    item.classList.toggle("is-detail-open", state.menuDetail && index === state.menuIndex);
    item.classList.toggle("is-disabled", menuItemDisabled(index));
    item.textContent = label;
    item.addEventListener("click", () => {
      state.menuIndex = index;
      state.menuMessage = "";
      state.menuDetail = null;
      state.menuSubIndex = 0;
      performMenuAction();
    });
    if (index === 4 && !isAtRestPoint()) {
      const tag = document.createElement("span");
      tag.textContent = "手水鉢";
      item.append(tag);
    }
    dom.menuOptions.append(item);
  });
  renderMenuStatus();
}

function renderMenuStatus() {
  const showingScrollableDetail = ["party", "items", "pokedex"].includes(state.menuDetail);
  dom.menuStatus.classList.toggle("is-scrollable", showingScrollableDetail);
  if (!showingScrollableDetail) dom.menuStatus.scrollTop = 0;
  const partner = currentPartner();
  if (!partner) {
    dom.menuStatus.innerHTML = "<h2>御魂狀態</h2><p>尚未締結御魂。</p>";
    return;
  }
  if (state.menuDetail === "party") {
    renderPartyMenu();
    return;
  }
  if (state.menuDetail === "items") {
    renderItemsMenu();
    return;
  }
  if (state.menuDetail === "pokedex") {
    renderPokedex();
    return;
  }
  if (state.menuIndex === 1) {
    renderPartyPreview();
    return;
  }
  if (state.menuIndex === 2) {
    renderItemsPreview();
    return;
  }
  if (state.menuIndex === 3) {
    renderPokedexPreview();
    return;
  }
  const progress = progressFor(partner.id);
  const hp = ensurePartnerHp(partner.id);
  const next = nextLevelXp(progress.level);
  const xpText = Number.isFinite(next) ? `${progress.xp}/${next}` : "滿階";
  const nextEvo = nextEvolutionLevel(mitamaById(partner.id), partner.level);
  const evoText = nextEvo ? `Lv.${nextEvo}` : partner.forms.length > 1 ? "完成" : "無";
  const restText = isAtRestPoint() ? "可在此休息，回復御魂 HP。" : "靠近手水鉢，可在選單中休息。";
  dom.menuStatus.innerHTML = `
    <div class="status-hero">
      <img src="${animationPaths[partner.imageKey]}" alt="${partner.name}" />
      <div>
        <h2>${partner.mark} ${partner.name}</h2>
        <p>Lv.${partner.level} / ${partner.element}屬 / 御術「${partner.skill}」</p>
      </div>
    </div>
    <div class="menu-stat-grid">
      <div class="menu-stat"><span>HP</span><strong>${hp}/${partner.maxHp}</strong></div>
      <div class="menu-stat"><span>御印</span><strong>${xpText}</strong></div>
      <div class="menu-stat"><span>進化</span><strong>${evoText}</strong></div>
      <div class="menu-stat"><span>攻</span><strong>${partner.atk}</strong></div>
      <div class="menu-stat"><span>術</span><strong>${partner.art}</strong></div>
      <div class="menu-stat"><span>守</span><strong>${partner.guard}</strong></div>
    </div>
    <h3>御魂說明</h3>
    <p>${partner.desc}</p>
    <h3>休息</h3>
    <p class="rest-hint">${state.menuMessage || restText}</p>
  `;
}

function renderPartyPreview() {
  const partner = currentPartner();
  const owned = ownedMitamas();
  dom.menuStatus.innerHTML = `
    <h2>御魂編成</h2>
    <p>目前同行是 ${partner.name}。降伏成功的對手會加入名冊，按 Enter 可進入切換。</p>
    <div class="menu-stat-grid">
      <div class="menu-stat"><span>同行</span><strong>${partner.name}</strong></div>
      <div class="menu-stat"><span>名冊</span><strong>${owned.length}</strong></div>
      <div class="menu-stat"><span>操作</span><strong>確認</strong></div>
      <div class="menu-stat"><span>降伏符</span><strong>${inventoryCount("sealCharm")}</strong></div>
    </div>
  `;
}

function renderItemsPreview() {
  dom.menuStatus.innerHTML = `
    <h2>道具</h2>
    <p>道具會在戰鬥與整備時使用。降伏符用來收服對手，療傷丸可以在選單回復同行御魂。</p>
    <div class="menu-stat-grid">
      ${ITEMS.map(
        (item) => `
          <div class="menu-stat item-stat">
            <img src="${item.icon}" alt="${item.name}" />
            <span>${item.name}</span>
            <strong>${inventoryCount(item.id)}</strong>
          </div>
        `,
      ).join("")}
    </div>
  `;
}

function renderPartyMenu() {
  const owned = ownedMitamas();
  state.menuSubIndex = clamp(state.menuSubIndex, 0, Math.max(0, owned.length - 1));
  const rows = owned
    .map((mitama, index) => {
      const hp = ensurePartnerHp(mitama.id);
      const selected = index === state.menuSubIndex;
      const current = mitama.id === state.partnerId;
      return `
        <div class="party-row ${selected ? "is-selected" : ""}">
          <img src="${animationPaths[mitama.imageKey]}" alt="${mitama.name}" />
          <div>
            <strong>${mitama.mark} ${mitama.name}${current ? " / 同行中" : ""}</strong>
            <span>Lv.${mitama.level} HP ${hp}/${mitama.maxHp} / ${mitama.skill}</span>
          </div>
        </div>
      `;
    })
    .join("");
  dom.menuStatus.innerHTML = `
    <h2>御魂編成</h2>
    <p>${state.menuMessage || "方向鍵選擇，Enter 切換同行御魂。"}</p>
    <div class="party-list">${rows}</div>
  `;
}

function renderItemsMenu() {
  state.menuSubIndex = clamp(state.menuSubIndex, 0, ITEMS.length - 1);
  const rows = ITEMS.map((item, index) => {
    const selected = index === state.menuSubIndex;
    return `
      <div class="item-row ${selected ? "is-selected" : ""}">
        <img src="${item.icon}" alt="${item.name}" />
        <div>
          <strong>${item.name}</strong>
          <span>${item.desc}</span>
        </div>
        <b>${inventoryCount(item.id)}</b>
      </div>
    `;
  }).join("");
  dom.menuStatus.innerHTML = `
    <h2>道具</h2>
    <p>${state.menuMessage || "方向鍵選擇，Enter 使用可在整備時使用的道具。"}</p>
    <div class="item-list">${rows}</div>
  `;
}

function switchPartnerFromMenu() {
  const owned = ownedMitamas();
  const selected = owned[state.menuSubIndex];
  if (!selected) return;
  if (ensurePartnerHp(selected.id) <= 0) {
    state.menuMessage = `${selected.name} 已無法戰鬥。請先休息或使用療傷丸。`;
    renderMenu();
    return;
  }
  state.partnerId = selected.id;
  ensurePartnerHp(selected.id);
  saveGame();
  state.menuMessage = `${selected.name} 成為同行御魂。`;
  renderMenu();
}

function useSelectedItem() {
  const item = ITEMS[state.menuSubIndex];
  const partner = currentPartner();
  if (!item || !partner) return;
  if (item.use !== "field") {
    state.menuMessage = `${item.name} 只能在戰鬥中使用。`;
    renderMenu();
    return;
  }
  if (inventoryCount(item.id) <= 0) {
    state.menuMessage = `${item.name} 已用完。`;
    renderMenu();
    return;
  }
  const hp = ensurePartnerHp(partner.id);
  if (hp >= partner.maxHp) {
    state.menuMessage = `${partner.name} 的 HP 已經是滿的。`;
    renderMenu();
    return;
  }
  spendItem(item.id);
  setPartnerHp(partner.id, Math.min(partner.maxHp, hp + item.heal));
  saveGame();
  state.menuMessage = `${partner.name} 使用${item.name}，HP 回復到 ${ensurePartnerHp(partner.id)}/${partner.maxHp}。`;
  renderMenu();
}

function enemyKnown(enemy) {
  return Boolean(
    state.seenDex[enemy.id] ||
      state.ownedMitama.includes(enemy.id) ||
      (enemy.id === GATE_ENEMY.id && state.flags?.gate) ||
      (enemy.id === BOSS_ENEMY.id && state.flags?.boss) ||
      (enemy.id === MARSH_BOSS_ENEMY.id && state.flags?.marshBoss) ||
      (enemy.id === TEMPLE_APPRENTICE_MITAMA.id && state.flags?.templeApprentice) ||
      (enemy.id === TEMPLE_MASTER_MITAMA.id && state.flags?.templeMaster) ||
      (enemy.id === MIST_MASTER_MITAMA.id && state.flags?.mistMaster),
  );
}

function dexFormCount(mitama) {
  return Math.max(1, mitama.forms?.length ?? 1);
}

function knownDexFormCount(mitama, firstFormKnown = false) {
  if (state.ownedMitama.includes(mitama.id)) return formStageFor(mitama, progressFor(mitama.id).level) + 1;
  return firstFormKnown ? 1 : 0;
}

function dexStageRows(mitama, knownStages, singleLabel = "對手") {
  const forms = mitama.forms?.length ? mitama.forms : [{ name: mitama.name, imageKey: mitama.imageKey }];
  return forms
    .map((form, index) => {
      const stage = index + 1;
      const unlocked = stage <= knownStages;
      const label = unlocked ? form.name : "未開通";
      return `
        <div class="dex-stage ${unlocked ? "" : "is-locked"}">
          <img src="${animationPaths[form.imageKey]}" alt="${label}" />
          <span>${forms.length > 1 ? stage : singleLabel}</span>
          <strong>${label}</strong>
        </div>
      `;
    })
    .join("");
}

function renderPokedexPreview() {
  const partner = currentPartner();
  const partnerLevel = partner ? progressFor(partner.id).level : 0;
  const unlockedStarters = STARTERS.reduce((total, starter) => {
    return total + knownDexFormCount(starter, true);
  }, 0);
  const knownEnemyStages = POKEDEX_ENEMIES.reduce((total, enemy) => total + knownDexFormCount(enemy, enemyKnown(enemy)), 0);
  const starterStages = STARTERS.reduce((total, starter) => total + dexFormCount(starter), 0);
  const enemyStages = POKEDEX_ENEMIES.reduce((total, enemy) => total + dexFormCount(enemy), 0);
  const unlocked = unlockedStarters + knownEnemyStages;
  const total = starterStages + enemyStages;
  dom.menuStatus.innerHTML = `
    <h2>御魂圖鑑</h2>
    <p>目前收錄 ${unlocked}/${total}。圖鑑會用動畫預覽御魂與對手，未開通的進化只留下黑影。</p>
    <div class="menu-stat-grid">
      <div class="menu-stat"><span>同行御魂</span><strong>${partner.name}</strong></div>
      <div class="menu-stat"><span>同行等級</span><strong>Lv.${partnerLevel}</strong></div>
      <div class="menu-stat"><span>對手</span><strong>${knownEnemyStages}/${enemyStages}</strong></div>
      <div class="menu-stat"><span>瀏覽</span><strong>確認</strong></div>
    </div>
    <p class="rest-hint">按 Enter 開啟圖鑑，進入後可用方向鍵捲動。</p>
  `;
}

function renderPokedex() {
  const rows = STARTERS.map((starter) => {
    const stages = dexStageRows(starter, knownDexFormCount(starter, true));
    return `
      <section class="dex-row">
        <h3>${starter.name}</h3>
        <div class="dex-stages">${stages}</div>
      </section>
    `;
  });
  for (const enemy of POKEDEX_ENEMIES) {
    const knownStages = knownDexFormCount(enemy, enemyKnown(enemy));
    const unlocked = knownStages > 0;
    const singleLabel = enemy.id === BOSS_ENEMY.id || enemy.id === MARSH_BOSS_ENEMY.id ? "首領" : "對手";
    rows.push(`
      <section class="dex-row">
        <h3>${unlocked ? `${enemy.mark} ${enemy.name}` : "未開通"}</h3>
        <div class="dex-stages ${dexFormCount(enemy) === 1 ? "single" : ""}">${dexStageRows(enemy, knownStages, singleLabel)}</div>
      </section>
    `);
  }

  dom.menuStatus.innerHTML = `
    <h2>御魂圖鑑</h2>
    <p>方向鍵捲動圖鑑。未開通的進化階段與未遭遇的對手只會留下黑影。</p>
    <div class="dex-list">${rows.join("")}</div>
  `;
}

function openMenu() {
  if (state.mode !== "overworld") return;
  state.keys.clear();
  state.mode = "menu";
  state.menuMessage = "";
  state.menuDetail = null;
  setPanels();
}

function closeMenu() {
  if (state.mode !== "menu") return;
  state.mode = "overworld";
  state.menuMessage = "";
  state.menuDetail = null;
  setPanels();
}

function performMenuAction() {
  const index = state.menuIndex;
  if (index === 0) {
    state.menuDetail = null;
    state.menuMessage = "目前同行御魂的狀態如下。";
  } else if (index === 1) {
    state.menuDetail = "party";
    state.menuSubIndex = Math.max(0, ownedMitamas().findIndex((mitama) => mitama.id === state.partnerId));
    state.menuMessage = "";
    renderMenu();
    return;
  } else if (index === 2) {
    state.menuDetail = "items";
    state.menuSubIndex = 0;
    state.menuMessage = "";
    renderMenu();
    return;
  } else if (index === 3) {
    state.menuDetail = "pokedex";
    state.menuMessage = "";
    renderMenu();
    dom.menuStatus.scrollTop = 0;
    return;
  } else if (index === 4) {
    state.menuDetail = null;
    if (menuItemDisabled(index)) {
      state.menuMessage = "這裡無法休息。請靠近神社左前方的手水鉢。";
    } else {
      healPartner();
      return;
    }
  } else if (index === 5) {
    state.menuDetail = null;
    saveGame();
    state.menuMessage = "已在神社札帳中保存進度。";
  } else if (index === 6) {
    resetGame();
    return;
  } else if (index === 7) {
    closeMenu();
    return;
  }
  renderMenu();
}

function scrollMenuStatus(amount) {
  const max = Math.max(0, dom.menuStatus.scrollHeight - dom.menuStatus.clientHeight);
  dom.menuStatus.scrollTop = clamp(dom.menuStatus.scrollTop + amount, 0, max);
}

function handleMenuKey(key) {
  if (state.menuDetail === "party" || state.menuDetail === "items") {
    const count = state.menuDetail === "party" ? ownedMitamas().length : ITEMS.length;
    if (key === "escape" || key === "m" || key === "backspace") {
      state.menuDetail = null;
      renderMenu();
      return true;
    }
    if (key === "arrowdown" || key === "s" || key === "arrowright" || key === "d") {
      state.menuSubIndex = (state.menuSubIndex + 1) % Math.max(1, count);
      renderMenu();
      return true;
    }
    if (key === "arrowup" || key === "w" || key === "arrowleft" || key === "a") {
      state.menuSubIndex = (state.menuSubIndex + Math.max(1, count) - 1) % Math.max(1, count);
      renderMenu();
      return true;
    }
    if (key === "enter" || key === " ") {
      if (state.menuDetail === "party") switchPartnerFromMenu();
      else useSelectedItem();
      return true;
    }
    return false;
  }
  if (state.menuDetail === "pokedex") {
    if (key === "escape" || key === "m" || key === "backspace" || key === "enter" || key === " ") {
      state.menuDetail = null;
      renderMenu();
      return true;
    }
    if (key === "arrowdown" || key === "s") {
      scrollMenuStatus(72);
      return true;
    }
    if (key === "arrowup" || key === "w") {
      scrollMenuStatus(-72);
      return true;
    }
    if (key === "pagedown" || key === "arrowright" || key === "d") {
      scrollMenuStatus(220);
      return true;
    }
    if (key === "pageup" || key === "arrowleft" || key === "a") {
      scrollMenuStatus(-220);
      return true;
    }
    return false;
  }
  if (key === "escape" || key === "m") {
    closeMenu();
    return true;
  }
  if (key === "arrowup" || key === "w" || key === "arrowleft" || key === "a") {
    state.menuIndex = (state.menuIndex + MENU_ITEMS.length - 1) % MENU_ITEMS.length;
    state.menuMessage = "";
    state.menuDetail = null;
    state.menuSubIndex = 0;
    renderMenu();
    return true;
  }
  if (key === "arrowdown" || key === "s" || key === "arrowright" || key === "d") {
    state.menuIndex = (state.menuIndex + 1) % MENU_ITEMS.length;
    state.menuMessage = "";
    state.menuDetail = null;
    state.menuSubIndex = 0;
    renderMenu();
    return true;
  }
  if (key === "enter" || key === " ") {
    performMenuAction();
    return true;
  }
  return false;
}
