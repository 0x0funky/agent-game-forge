<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>本機優先、自選 AI agent 的 2D 遊戲 IDE。</b><br/>
  Codex 或 Claude Code 幫你寫,輸出純 vanilla JS 瀏覽器遊戲。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <b>繁體中文</b> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ar.md">العربية</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.uk.md">Українська</a> ·
  <a href="./README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/0x0funky/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/0x0funky/agent-game-forge?style=flat" alt="stars"/></a>
  <img src="https://img.shields.io/badge/license-pending-lightgrey" alt="license"/>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

---

Agent Game Forge (簡稱 **AGF**) 是一個開源的桌面 IDE,讓 AI coding agent 幫你做出完整的 2D 遊戲 — 角色 sprite、parallax 背景、物理、傷害區、收集物、場景配置 — 同時提供一個視覺編輯器,讓你拖曳調整 agent 沒做對的部分。**你選 agent**(Codex CLI 或 Claude Code)、**你選圖片生成 model**(Gemini 2.5 Flash Image 或 OpenAI gpt-image-1),產出的遊戲是純 JS + Canvas — 任何瀏覽器都能跑,沒有 framework 綁定。

---

## ✨ 核心功能

- 🤖 **Bring Your Own Agent** — Codex CLI 或 Claude Code,在 Settings 即時切換。
- 🎨 **正規 asset pipeline** — sprite-sheet chroma-key、多動作動畫、parallax 4 層 tileable + despill — 都是第一級公民,不是外掛。
- 🖼️ **多供應商 image gen** — Gemini 2.5 Flash Image(便宜、原生 multimodal)或 OpenAI gpt-image-1(高品質)。Key 自帶,完全留在自己機器上。
- 🧱 **視覺場景編輯器** — 拖曳 platform、hazard、pickup、collider;hitbox 紅色虛線可視化;Play tab live reload。
- 📦 **Vanilla JS + Canvas runtime** — 生成的遊戲零 framework 依賴。把資料夾推上 GitHub Pages 直接跑。
- 💻 **本機優先、開源** — daemon + Web UI 跑在 `localhost`;你的專案檔案留在你的硬碟;MIT 取向。
- 💰 **成本透明** — Settings 面板顯示今天 image-gen 次數 + 預估 $ 花費,依供應商分類。

---

## 🎬 Demo

> 即將上線:90 秒 demo 影片,從 prompt → 可玩 platformer → live edit → 切 CLI。

**Hero shot**(AGF 主畫面):

> _尚未截圖_

**Settings — BYOA 證據**:

> _Settings modal 顯示 agent picker + API key + image-gen 預設_

**Scene editor — 拖一個 hazard,Play tab 看見它**:

> _短 GIF_

---

## 🚀 快速開始

**需求**:Node ≥ 20、npm ≥ 10,**至少一個** agent CLI:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

啟動後:

- **Daemon**: <http://localhost:7621>
- **Web UI**: <http://localhost:7620>

打開 Web URL,右上角齒輪 → **Settings**:

1. **Agent CLI** — 選 Codex 或 Claude Code(看你裝了哪個)
2. **API keys**(走 Claude Code 路徑才需要)— 貼上 Gemini 或 OpenAI key。Daemon 寫到 `~/.ogf/secrets.json`(mode 600)。環境變數 (`OPENAI_API_KEY`、`GEMINI_API_KEY`) 會覆蓋檔案值。
3. **Image-gen defaults** — 選預設 provider + model

關掉 Settings,開一個專案資料夾,輸入像這樣的 prompt:

> *「橫向卷軸平台遊戲,主角是要回家的狗狗,有屋頂跟公園大門兩關。」*

送出。看 agent 蓋遊戲。停了之後按 **Play**。

---

## 🧭 怎麼運作

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
你 ─→   │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (router) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │  (圖片生成走
                                    │ (你的 key)  │   daemon HTTP)
                                    └─────────────┘
```

**1. 你在 chat 跟 agent 對話**。Web UI 透過 SSE 即時 stream 每個 token 跟工具呼叫。

**2. Agent 讀 AGF 的 conventions 和 skills**。每個專案都 vendor 一份 `.ogf/conventions/`(通用 + 各 genre 規則)和 `.agents/skills/`(sprite + map 生成程序)。Agent 跟著 recipe 走,不會自己重發明流程。

**3. 圖片生成走 daemon 的 `/api/gen-image`**(透過 `python .agents/tools/gen-image.py` 或直接 `curl`)。Daemon 用你的 API key 路由到 Gemini 或 OpenAI。Codex 用戶可以直接用內建的 `image_gen` — 兩條路徑出來的 PNG 一樣。

**4. Scene editor 跟 agent 讀寫同一份 JSON**。拖一個 platform → editor commit JSON patch;agent 下次看也看得到。

**5. Runtime 就是專案本身**。生成的遊戲是純 JS + Canvas — `index.html`、`src/*.js`、`data/*.json`、`assets/`。推到 GitHub Pages 直接跑。

---

## 📂 專案結構

```
open-game-forge/
├── packages/
│   └── contracts/      # 共用 TypeScript types:API、events、SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express daemon(port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter
│   │       ├── claude-code.ts       # Claude Code adapter
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # ~/.ogf/secrets.json
│   │       ├── prefs.ts             # ~/.ogf/preferences.json
│   │       ├── web-scene.ts         # JSON level → SceneModel
│   │       ├── scenes.ts            # SceneOp applier
│   │       └── templates/           # 內建 skills / conventions / recipes
│   └── web/            # Vite + React UI(port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas 場景編輯器
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ 從原始碼建置

```bash
npm install           # workspace 安裝
npm run build         # build contracts → daemon → web
npm run dev           # 三個都 watch mode(daemon 用 tsx 熱重載)
```

常用指令:

- `npm -w @ogf/daemon run dev` — 只跑 daemon
- `npm -w @ogf/web run dev` — Vite dev server
- `npm -w @ogf/contracts run build` — 編譯 contracts package

---

## 📋 專案狀態

| Genre | 狀態 | 備註 |
|---|---|---|
| **橫向卷軸平台** | ✅ 已 ship | Parallax pipeline、hazards、pickups、enemies、多關卡、sprite chroma-key |
| 俯視 RPG | 🟡 部分 | Foundation seed + recipes 已備;部分 recipe 還在打磨 |
| Tower defense / arena | 🟡 部分 | 從早期 branch 繼承;需要 polish |
| Roguelike / Metroidvania | 🚧 規劃中 | Launch 之後 |

**引擎**:Web(vanilla JS + Canvas)是預設且積極開發的目標。Godot 4 對既有專案仍可用;不再增加 Godot 新功能。

---

## 📚 文件

- [`docs/architecture.md`](docs/architecture.md) — 設計原則、agent-first 思維
- [`docs/roadmap.md`](docs/roadmap.md) — 分階段計畫
- [`docs/genre-support.md`](docs/genre-support.md) — Genre 支援矩陣
- 內建 convention(每個專案隨 vendor)— [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- 內建 recipe — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 貢獻

我們還在 pre-launch。Codebase 小,PR 歡迎,但**請先開 issue 討論 scope**。目前最需要的:

- **試用 + 回報 bug** — 開 issue 附上 daemon log(`~/.ogf/claude-code-debug.jsonl` 或 `npm run dev` 那個 terminal 的輸出)
- **做個遊戲秀給我們看** — 願意收進 README feature
- **macOS / Linux 測試** — 主開發在 Windows,跨平台問題肯定有

---

## 🔐 安全 & 資料

- **程式碼留在你的機器上**。AGF 是本機優先。Daemon bind 到 `127.0.0.1`;只有呼叫 AI 供應商時才會出本機。
- **API keys** 存在 `~/.ogf/secrets.json`,file mode 600(只有 owner 能讀)。永遠不會進 git、不會出現在 AGF 的 log。
- **對話紀錄** 存在 `~/.ogf/ogf.db`(SQLite)。要清空就刪掉這檔案。

---

## 📜 授權

License 待定 — launch 時會用 open-source friendly 的(MIT 或 Apache-2.0)。原始碼是公開的;在 license 確定前請不要做商業 fork。

---

## 🙏 致謝

- Daemon-and-spawn pattern 來自 [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Sprite 生成流程 來自 [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- 用 Codex CLI + Claude Code 建造 — 對,這個工具大多是它自己驅動的 agent 寫出來的

---

<p align="center">
  獻給愛 ship 東西的 indie 開發者。<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">回報 bug</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">討論區</a>
</p>
