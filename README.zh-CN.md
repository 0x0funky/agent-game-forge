<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>本地优先、自选 AI agent 的 2D 游戏 IDE。</b><br/>
  Codex 或 Claude Code 帮你写。Web 已就绪,Godot 和 Unity 在路线图上。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <b>简体中文</b> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ar.md">العربية</a> ·
  <a href="./README.ru.md">Русский</a> ·
  <a href="./README.uk.md">Українська</a> ·
  <a href="./README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="https://github.com/0x0funky/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/0x0funky/agent-game-forge?style=flat" alt="stars"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"/></a>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

<p align="center">
  🎨 精灵图生成流程由 <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a> 提供
</p>

---

Agent Game Forge (简称 **AGF**) 是一个开源的桌面 IDE,让 AI coding agent 帮你做出完整的 2D 游戏 — 角色 sprite、parallax 背景、物理、伤害区、收集物、场景配置 — 同时提供一个可视化编辑器,让你拖拽调整 agent 没做对的部分。**你选 agent**(Codex CLI 或 Claude Code)、**你选图片生成模型**(Gemini 2.5 Flash Image 或 OpenAI gpt-image-1)。目前默认输出是纯 vanilla JS + Canvas(零 framework 绑定,任何浏览器都能跑);Godot 4 和 Unity 引擎目标都在路线图上。

---

## ✨ 核心功能

- 🤖 **Bring Your Own Agent** — Codex CLI 或 Claude Code,在 Settings 实时切换。
- 🎨 **正规 asset pipeline** — sprite-sheet chroma-key、多动作动画、parallax 4 层 tileable + despill — 都是第一级公民,不是外挂。
- 🖼️ **多供应商 image gen** — Gemini 2.5 Flash Image(便宜、原生 multimodal)或 OpenAI gpt-image-1(高品质)。Key 自带,完全留在自己机器上。
- 🧱 **可视化场景编辑器** — 拖拽 platform、hazard、pickup、collider;hitbox 红色虚线可视化;Play tab live reload。
- 📦 **多引擎路线图** — Web(vanilla JS + Canvas)今天就能用,零 framework 绑定(推到 GitHub Pages 直接跑)。Godot 4 和 Unity 目标在规划中。
- 💻 **本地优先、开源** — daemon + Web UI 跑在 `localhost`;你的项目文件留在你的硬盘;MIT 取向。
- 💰 **成本透明** — Settings 面板显示今天 image-gen 次数 + 预估 $ 花费,按供应商分类。

---

## 🎬 Demo

**主视图** — AGF 主界面:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF main window" width="800" />
</p>

**Settings** — 选择 agent + API keys + image-gen 默认值:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modal" width="800" />
</p>

**Scene editor** — 拖拽 platform、hazard、pickup、collider:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Scene editor" width="800" />
</p>

---

## 🚀 快速开始

**需求**:Node ≥ 20、npm ≥ 10,**至少一个** agent CLI:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

启动后:

- **Daemon**: <http://localhost:7621>
- **Web UI**: <http://localhost:7620>

打开 Web URL,右上角齿轮 → **Settings**:

1. **Agent CLI** — 选 Codex 或 Claude Code(看你装了哪个)
2. **API keys**(走 Claude Code 路径才需要)— 粘贴 Gemini 或 OpenAI key。Daemon 写到 `~/.ogf/secrets.json`(mode 600)。环境变量 (`OPENAI_API_KEY`、`GEMINI_API_KEY`) 会覆盖文件值。
3. **Image-gen defaults** — 选默认 provider + model

关掉 Settings,打开一个项目文件夹,输入像这样的 prompt:

> *“横版卷轴平台游戏,主角是要回家的狗狗,有屋顶和公园大门两关。”*

发送。看 agent 构建游戏。停下来后按 **Play**。

---

## 🧭 工作原理

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
                                    │ OpenAI API  │  (图片生成走
                                    │ (你的 key)  │   daemon HTTP)
                                    └─────────────┘
```

**1. 你在 chat 跟 agent 对话**。Web UI 通过 SSE 实时 stream 每个 token 和工具调用。

**2. Agent 读 AGF 的 conventions 和 skills**。每个项目都 vendor 一份 `.ogf/conventions/`(通用 + 各 genre 规则)和 `.agents/skills/`(sprite + map 生成程序)。Agent 跟着 recipe 走,不会自己重新发明流程。

**3. 图片生成走 daemon 的 `/api/gen-image`**(通过 `python .agents/tools/gen-image.py` 或直接 `curl`)。Daemon 用你的 API key 路由到 Gemini 或 OpenAI。Codex 用户可以直接用内置的 `image_gen` — 两条路径出来的 PNG 一样。

**4. Scene editor 跟 agent 读写同一份 JSON**。拖一个 platform → editor commit JSON patch;agent 下次查看也能看到。

**5. Runtime 就是项目本身**。生成的游戏是纯 JS + Canvas — `index.html`、`src/*.js`、`data/*.json`、`assets/`。推到 GitHub Pages 直接跑。

---

## 📂 项目结构

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
│   │       └── templates/           # 内置 skills / conventions / recipes
│   └── web/            # Vite + React UI(port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas 场景编辑器
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ 从源码构建

```bash
npm install           # workspace 安装
npm run build         # build contracts → daemon → web
npm run dev           # 三个都 watch mode(daemon 用 tsx 热重载)
```

常用命令:

- `npm -w @ogf/daemon run dev` — 只跑 daemon
- `npm -w @ogf/web run dev` — Vite dev server
- `npm -w @ogf/contracts run build` — 编译 contracts package

---

## 📋 项目状态

| Genre | 状态 | 备注 |
|---|---|---|
| **横版卷轴平台** | ✅ 已 ship | Parallax pipeline、hazards、pickups、enemies、多关卡、sprite chroma-key |
| 俯视 RPG | 🟡 部分 | Foundation seed + recipes 已备;部分 recipe 还在打磨 |
| Tower defense / arena | 🟡 部分 | 从早期 branch 继承;需要 polish |
| Roguelike / Metroidvania | 🟡 部分 | Launch 之后 |

**引擎目标**:

| 引擎 | 状态 | 备注 |
|---|---|---|
| **Web**(vanilla JS + Canvas) | ✅ 默认 | 积极开发中。零 framework 依赖;推到 GitHub Pages 直接跑。 |
| **Godot 4** | 🟡 遗留 + 路线图 | 既有 Godot 项目仍可加载 + 编辑。launch 后路线图上的一等公民重投资目标。 |
| **Unity** | 🚧 规划中 | 安排在 Godot 一等公民支持落地之后。 |

---

## 📚 文档

- [`docs/architecture.md`](docs/architecture.md) — 设计原则、agent-first 理念
- [`docs/roadmap.md`](docs/roadmap.md) — 分阶段计划
- [`docs/genre-support.md`](docs/genre-support.md) — Genre 支持矩阵
- 内置 convention(每个项目随 vendor)— [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- 内置 recipe — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 贡献

我们还在 pre-launch。Codebase 小,PR 欢迎,但**请先开 issue 讨论 scope**。目前最需要的:

- **试用 + 反馈 bug** — 开 issue 附上 daemon log(`~/.ogf/claude-code-debug.jsonl` 或 `npm run dev` 那个 terminal 的输出)
- **做个游戏秀给我们看** — 愿意收进 README feature
- **macOS / Linux 测试** — 主开发在 Windows,跨平台问题肯定存在

---

## 🔐 安全 & 数据

- **代码留在你的机器上**。AGF 是本地优先。Daemon bind 到 `127.0.0.1`;只有调用 AI 供应商时才会出本机。
- **API keys** 存在 `~/.ogf/secrets.json`,file mode 600(只有 owner 能读)。永远不会进 git、不会出现在 AGF 的 log。
- **对话记录** 存在 `~/.ogf/ogf.db`(SQLite)。要清空就删掉这个文件。

---

## 📜 授权

采用 [Apache License, Version 2.0](LICENSE) 授权。可自由使用、修改、fork、发布 —— 商用或非商用都可以。只要保留 copyright 与 license 声明即可。

---

## 🙏 致谢

- Daemon-and-spawn pattern 来自 [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Sprite 生成流程 来自 [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- 用 Codex CLI + Claude Code 构建 — 对,这个工具大多是它自己驱动的 agent 写出来的

---

<p align="center">
  献给爱 ship 东西的 indie 开发者。<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">反馈 bug</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">讨论区</a>
</p>
