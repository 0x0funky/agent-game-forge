<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>The local-first, bring-your-own-agent 2D game IDE.</b><br/>
  Codex or Claude Code drives. Web today, Godot and Unity on the roadmap.
</p>

<p align="center">
  <b>English</b> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
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
  🎨 Sprite pipeline powered by <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge (**AGF**) is an open-source desktop IDE that lets an AI coding agent build complete 2D games for you — sprites, parallax backgrounds, physics, hazards, pickups, scene layouts — and gives you a visual editor to drag-tweak whatever the agent got wrong. **You pick the agent** (Codex CLI or Claude Code) and **you pick the image model** (Gemini 2.5 Flash Image or OpenAI gpt-image-1). Today the default output is vanilla JS + Canvas (zero framework lock-in, runs in any browser); Godot 4 and Unity engine targets are on the roadmap.

---

## ✨ At a glance

- 🤖 **Bring your own agent** — Codex CLI or Claude Code. Switch in Settings. Live.
- 🎨 **Production-grade asset pipeline** — sprite-sheet chroma-key, multi-action animation, parallax 4-layer tileable + despill — all first-class, not bolted on.
- 🖼️ **Multi-provider image gen** — Gemini 2.5 Flash Image (cheap, native multimodal) or OpenAI gpt-image-1 (premium). You supply the API key; it stays on your machine.
- 🧱 **Visual scene editor** — drag platforms, hazards, pickups, colliders; hitbox overlay; live reload to the Play tab.
- 📦 **Multi-engine on the roadmap** — Web (vanilla JS + Canvas) ships today with zero framework lock-in (push to GitHub Pages, it runs). Godot 4 and Unity targets planned.
- 💻 **Local-first, open source** — daemon + web UI on `localhost`; your project files stay on your disk; MIT-style intent.
- 💰 **Cost-transparent** — Settings panel shows today's image-gen call count and estimated $ spend per provider.

---

## 🎬 Demo

**Hero shot** — the AGF window:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF main window" width="800" />
</p>

**Settings** — pick your agent + API keys + image-gen defaults:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modal" width="800" />
</p>

**Scene editor** — drag platforms, hazards, pickups, colliders:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Scene editor" width="800" />
</p>

---

## 🚀 Quick start

**Requirements**: Node ≥ 20, npm ≥ 10, and **at least one** of:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

This launches:

- **Daemon** at <http://localhost:7621>
- **Web UI** at <http://localhost:7620>

Open the web URL. Click the gear icon (top-right) → **Settings**:

1. **Agent CLI** — pick Codex or Claude Code (whichever you installed).
2. **API keys** (only needed for Claude Code path) — paste your Gemini or OpenAI key. Daemon writes them to `~/.ogf/secrets.json` (mode 600). Env vars (`OPENAI_API_KEY`, `GEMINI_API_KEY`) override the file.
3. **Image-gen defaults** — choose preferred provider + model.

Close Settings. Open a project folder. Type a prompt like:

> *"Side-scroll platformer about a dog going home, with rooftop and park gate levels."*

Hit send. Watch the agent build it. Press **Play** when it stops.

---

## 🧭 How it works

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
You ─→  │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (routed) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (image gen via
                                    │ (your key)  │    daemon HTTP)
                                    └─────────────┘
```

**1. You talk to the agent in chat.** The web UI streams the conversation; SSE relays every token + tool call.

**2. The agent reads AGF conventions and skills.** Each project is vendored with `.ogf/conventions/` (universal + per-genre rules) and `.agents/skills/` (sprite + map generation procedures). The agent follows the recipes — it doesn't reinvent the pipeline.

**3. For images, the agent calls the daemon's `/api/gen-image`** (via `python .agents/tools/gen-image.py` or direct `curl`). The daemon routes to Gemini or OpenAI using your saved API key. Codex users with the built-in `image_gen` tool can use that instead — both paths produce equivalent PNGs.

**4. The scene editor reads + writes the same JSON files** the agent creates. Drag a platform; the editor commits a JSON patch. Refresh the agent's view; it sees the update.

**5. The runtime is the project itself.** Generated games are pure JS + Canvas — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Push the folder to GitHub Pages. Done.

---

## 📂 Repository layout

```
open-game-forge/
├── packages/
│   └── contracts/      # shared TypeScript types: API, events, SceneModel
├── apps/
│   ├── daemon/         # Node.js + Express daemon (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (same pattern)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # ~/.ogf/secrets.json store
│   │       ├── prefs.ts             # ~/.ogf/preferences.json store
│   │       ├── web-scene.ts         # JSON level → SceneModel loader
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # vendored skills / conventions / recipes
│   └── web/            # Vite + React UI (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # Canvas-based scene editor
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ Build from source

```bash
npm install           # workspace install
npm run build         # build contracts → daemon → web
npm run dev           # watch mode for all three (daemon hot-reloads via tsx)
```

Useful commands:

- `npm -w @ogf/daemon run dev` — daemon only, with `tsx watch`
- `npm -w @ogf/web run dev` — Vite dev server
- `npm -w @ogf/contracts run build` — type-check contracts package

---

## 📋 Project status

| Genre | Status | Notes |
|---|---|---|
| **Side-scroll platformer** | ✅ shipped | Parallax pipeline, hazards, pickups, enemies, multi-level, sprite chroma-key |
| Top-down RPG | 🟡 partial | Foundation seed + recipes; some recipes still maturing |
| Tower defense / arena | 🟡 partial | Inherited from earlier branches; needs polish |
| Roguelike / Metroidvania | 🟡 partial | After launch |

**Engine targets**:

| Engine | Status | Notes |
|---|---|---|
| **Web** (vanilla JS + Canvas) | ✅ default | Actively developed. Zero framework dependency; push to GitHub Pages and it runs. |
| **Godot 4** | 🟡 legacy + roadmap | Existing Godot projects still load + edit. First-class re-investment on the post-launch roadmap. |
| **Unity** | 🚧 planned | Targeted for after Godot first-class lands. |

---

## 📚 Documentation

- [`docs/architecture.md`](docs/architecture.md) — design principles, agent-first paradigm
- [`docs/roadmap.md`](docs/roadmap.md) — phased plan
- [`docs/genre-support.md`](docs/genre-support.md) — genre matrix
- Convention files (vendored per-project) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipes (vendored per-project) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 Contributing

We're pre-launch. The codebase is small enough that PRs are welcome, but please file an issue first to discuss scope. Best ways to help right now:

- **Try it and report bugs** — file an issue with the daemon log (`~/.ogf/claude-code-debug.jsonl` or your shell terminal where `npm run dev` runs)
- **Build a game** and show us — happy to feature it in the README
- **Test on macOS / Linux** — primary dev is on Windows; cross-platform issues likely lurk

---

## 🔐 Security & data

- **Your code stays on your machine.** AGF is local-first. Daemon binds to `127.0.0.1`; nothing leaves your machine except calls to the AI provider you chose.
- **API keys** are stored at `~/.ogf/secrets.json` with file mode 600 (owner-only). They never enter git, never appear in AGF's logs.
- **Conversations** are stored in `~/.ogf/ogf.db` (SQLite). Delete the file to reset.

---

## 📜 License

Licensed under the [Apache License, Version 2.0](LICENSE). You're free to use, modify, fork, and ship — commercial or not. Just keep the copyright + license notice.

---

## 🙏 Credits

- Daemon-and-spawn pattern adapted from [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Sprite generation pipeline adapted from [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- Built with Codex CLI + Claude Code — yes, this project is largely written by the same agents it drives

---

<p align="center">
  Made for indie game devs who like to ship.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Report a bug</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
