<p align="center">
  <img src="apps/web/public/ogf-logo-256.png" alt="Open Game Forge" width="128" height="128" />
</p>

<h1 align="center">Open Game Forge</h1>

<p align="center">
  <b>The local-first, bring-your-own-agent 2D game IDE.</b><br/>
  Codex or Claude Code drives. You ship vanilla browser JS.
</p>

<p align="center">
  <b>English</b> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/0x0funky/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/0x0funky/agent-game-forge?style=flat" alt="stars"/></a>
  <img src="https://img.shields.io/badge/license-pending-lightgrey" alt="license"/>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

---

Open Game Forge (**OGF**) is an open-source desktop IDE that lets an AI coding agent build complete 2D games for you — sprites, parallax backgrounds, physics, hazards, pickups, scene layouts — and gives you a visual editor to drag-tweak whatever the agent got wrong. **You pick the agent** (Codex CLI or Claude Code), **you pick the image model** (Gemini 2.5 Flash Image or OpenAI gpt-image-1), and the resulting game is plain JS + Canvas — runs in any browser, no framework lock-in.

> No other 2D game IDE does this combination today: agent-agnostic + local-first + BYO API keys + open source. GDevelop locks you to GDevelop AI; Rosebud / Bolt are cloud-only; Cursor doesn't ship game pipelines; Unity Muse is engine-locked.

---

## ✨ At a glance

- 🤖 **Bring your own agent** — Codex CLI or Claude Code. Switch in Settings. Live.
- 🎨 **Production-grade asset pipeline** — sprite-sheet chroma-key, multi-action animation, parallax 4-layer tileable + despill — all first-class, not bolted on.
- 🖼️ **Multi-provider image gen** — Gemini 2.5 Flash Image (cheap, native multimodal) or OpenAI gpt-image-1 (premium). You supply the API key; it stays on your machine.
- 🧱 **Visual scene editor** — drag platforms, hazards, pickups, colliders; hitbox overlay; live reload to the Play tab.
- 📦 **Vanilla JS + Canvas runtime** — generated games have zero framework dependency. Push the folder to GitHub Pages and it just runs.
- 💻 **Local-first, open source** — daemon + web UI on `localhost`; your project files stay on your disk; MIT-style intent.
- 💰 **Cost-transparent** — Settings panel shows today's image-gen call count and estimated $ spend per provider.

---

## 🎬 Demo

> Coming soon: 90-second demo video showing prompt → playable platformer → live edit → CLI switch.

**Hero shot** (the OGF window):

> _Insert hero screenshot here once available_

**Settings — BYOA proof**:

> _Insert Settings modal screenshot showing agent picker + API keys + image-gen defaults_

**Scene editor — drag a hazard, see it in Play**:

> _Insert short GIF_

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

**2. The agent reads OGF conventions and skills.** Each project is vendored with `.ogf/conventions/` (universal + per-genre rules) and `.agents/skills/` (sprite + map generation procedures). The agent follows the recipes — it doesn't reinvent the pipeline.

**3. For images, the agent calls the daemon's `/api/gen-image`** (via `python .agents/tools/gen-image.py` or direct `curl`). The daemon routes to Gemini or OpenAI using your saved API key. Codex users with the built-in `image_gen` tool can use that instead — both paths produce equivalent PNGs.

**4. The scene editor reads + writes the same JSON files** the agent creates. Drag a platform; the editor commits a JSON patch. Refresh the agent's view; it sees the update.

**5. The runtime is the project itself.** Generated games are pure JS + Canvas — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Push the folder to GitHub Pages. Done.

---

## 🆚 vs other 2D game tools

| | OGF | Rosebud | Bolt / Lovable | Replit Agent | GDevelop AI | OpenGame |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Local-first | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Open source | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Pick your agent CLI | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| BYO API keys | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sprite + parallax pipeline | ✅ | partial | ❌ | partial | partial | ❌ |
| Visual scene editor | ✅ | hosted | ❌ | hosted | ✅ | ❌ |
| Output portable (vanilla JS) | ✅ | partial | n/a | partial | ❌ (GDevelop runtime) | ✅ |
| Cost-transparent | ✅ | ❌ | ❌ | ❌ | n/a | n/a |

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
| Roguelike / Metroidvania | 🚧 planned | After launch |

**Engines**: Web (vanilla JS + Canvas) is the default and the actively-developed target. Godot 4 still works for legacy projects; no new Godot features added.

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

- **Your code stays on your machine.** OGF is local-first. Daemon binds to `127.0.0.1`; nothing leaves your machine except calls to the AI provider you chose.
- **API keys** are stored at `~/.ogf/secrets.json` with file mode 600 (owner-only). They never enter git, never appear in OGF's logs.
- **Conversations** are stored in `~/.ogf/ogf.db` (SQLite). Delete the file to reset.

---

## 📜 License

License pending — will be open-source-friendly (MIT or Apache-2.0) at launch. Source is public; please don't redistribute commercial forks before the license is set.

---

## 🙏 Credits

- Daemon-and-spawn pattern adapted from [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Foundation seed derived from [`Sengoku-Era-ogf`](https://github.com/0x0funky/Sengoku-Era-ogf) (Sengoku-era RPG reference project)
- Built with Codex CLI + Claude Code — yes, this project is largely written by the same agents it drives

---

<p align="center">
  Made for indie game devs who like to ship.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Report a bug</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
