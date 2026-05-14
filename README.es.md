<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>El IDE de juegos 2D local-first y bring-your-own-agent.</b><br/>
  Codex o Claude Code lo conduce. Web hoy, Godot y Unity en el roadmap.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <b>Español</b> ·
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
  🎨 Pipeline de sprites por <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge (**AGF**) es un IDE de escritorio de código abierto que permite a un agente de codificación con IA construir juegos 2D completos por ti — sprites, fondos parallax, físicas, peligros, ítems, disposición de escenas — y te ofrece un editor visual para ajustar arrastrando lo que el agente no haya hecho bien. **Eliges el agente** (Codex CLI o Claude Code) y **eliges el modelo de imagen** (Gemini 2.5 Flash Image u OpenAI gpt-image-1). Hoy la salida por defecto es JS + Canvas puro (cero lock-in de framework, corre en cualquier navegador); los targets de motor Godot 4 y Unity están en el roadmap.

---

## ✨ De un vistazo

- 🤖 **Trae tu propio agente** — Codex CLI o Claude Code. Cámbialo en Settings. En vivo.
- 🎨 **Pipeline de assets de nivel producción** — chroma-key de sprite sheets, animación multi-acción, parallax de 4 capas tileable + despill — todo de primera clase, no pegado a posteriori.
- 🖼️ **Generación de imágenes multi-proveedor** — Gemini 2.5 Flash Image (barato, multimodal nativo) o OpenAI gpt-image-1 (premium). Aportas la API key; se queda en tu máquina.
- 🧱 **Editor visual de escenas** — arrastra plataformas, peligros, ítems, colisionadores; visualización de hitbox; recarga en vivo en la pestaña Play.
- 📦 **Multi-motor en el roadmap** — Web (vanilla JS + Canvas) se entrega hoy con cero lock-in de framework (sube a GitHub Pages y funciona). Targets Godot 4 y Unity planeados.
- 💻 **Local-first, código abierto** — daemon + UI web en `localhost`; tus archivos de proyecto se quedan en tu disco; intención estilo MIT.
- 💰 **Costos transparentes** — el panel de Settings muestra el número de llamadas de gen-image de hoy y el gasto estimado en $ por proveedor.

---

## 🎬 Demo

**Hero shot** — la ventana de AGF:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF main window" width="800" />
</p>

**Settings** — elige tu agente + API keys + image-gen defaults:

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF Settings modal" width="800" />
</p>

**Editor de escenas** — arrastra plataformas, peligros, ítems, colisionadores:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF Scene editor" width="800" />
</p>

---

## 🚀 Inicio rápido

**Requisitos**: Node ≥ 20, npm ≥ 10, y **al menos uno** de:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

Esto lanza:

- **Daemon** en <http://localhost:7621>
- **Web UI** en <http://localhost:7620>

Abre la URL web. Haz clic en el ícono de engranaje (esquina superior derecha) → **Settings**:

1. **Agent CLI** — elige Codex o Claude Code (el que tengas instalado).
2. **API keys** (solo necesario para la ruta Claude Code) — pega tu key de Gemini o OpenAI. El daemon las escribe en `~/.ogf/secrets.json` (mode 600). Las variables de entorno (`OPENAI_API_KEY`, `GEMINI_API_KEY`) anulan el archivo.
3. **Image-gen defaults** — elige proveedor + modelo preferidos.

Cierra Settings. Abre una carpeta de proyecto. Escribe un prompt como:

> *"Plataforma de scroll lateral sobre un perro yendo a casa, con niveles de tejado y de puerta del parque."*

Pulsa enviar. Mira al agente construirlo. Presiona **Play** cuando termine.

---

## 🧭 Cómo funciona

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
Tú ─→   │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (router) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (gen-image vía
                                    │ (tu key)    │    daemon HTTP)
                                    └─────────────┘
```

**1. Hablas con el agente en chat.** La UI web hace streaming de la conversación; SSE retransmite cada token + llamada de herramienta.

**2. El agente lee las conventions y skills de AGF.** Cada proyecto tiene vendored `.ogf/conventions/` (reglas universales + por género) y `.agents/skills/` (procedimientos de generación de sprite + map). El agente sigue las recipes — no reinventa la pipeline.

**3. Para imágenes, el agente llama al `/api/gen-image` del daemon** (vía `python .agents/tools/gen-image.py` o `curl` directo). El daemon enruta a Gemini u OpenAI usando tu API key guardada. Los usuarios de Codex con la herramienta `image_gen` integrada pueden usar esa en su lugar — ambas rutas producen PNGs equivalentes.

**4. El editor de escenas lee + escribe los mismos archivos JSON** que el agente crea. Arrastra una plataforma; el editor commitea un parche JSON. Refresca la vista del agente; verá la actualización.

**5. El runtime es el proyecto mismo.** Los juegos generados son JS + Canvas puro — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Sube la carpeta a GitHub Pages. Listo.

---

## 📂 Estructura del repositorio

```
open-game-forge/
├── packages/
│   └── contracts/      # tipos TypeScript compartidos: API, events, SceneModel
├── apps/
│   ├── daemon/         # daemon Node.js + Express (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (mismo patrón)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # almacén ~/.ogf/secrets.json
│   │       ├── prefs.ts             # almacén ~/.ogf/preferences.json
│   │       ├── web-scene.ts         # loader JSON level → SceneModel
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # skills / conventions / recipes vendored
│   └── web/            # UI Vite + React (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # editor de escenas basado en Canvas
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ Compilar desde fuente

```bash
npm install           # instalación del workspace
npm run build         # build contracts → daemon → web
npm run dev           # modo watch para los tres (daemon hot-reload vía tsx)
```

Comandos útiles:

- `npm -w @ogf/daemon run dev` — solo daemon, con `tsx watch`
- `npm -w @ogf/web run dev` — servidor dev Vite
- `npm -w @ogf/contracts run build` — type-check del paquete contracts

---

## 📋 Estado del proyecto

| Género | Estado | Notas |
|---|---|---|
| **Plataforma de scroll lateral** | ✅ entregado | Pipeline parallax, peligros, ítems, enemigos, multi-nivel, chroma-key de sprites |
| RPG cenital | 🟡 parcial | Foundation seed + recipes; algunas recipes aún madurando |
| Tower defense / arena | 🟡 parcial | Heredado de branches anteriores; necesita polish |
| Roguelike / Metroidvania | 🟡 parcial | Después del launch |

**Targets de motor**:

| Motor | Estado | Notas |
|---|---|---|
| **Web** (vanilla JS + Canvas) | ✅ por defecto | En desarrollo activo. Cero dependencia de framework; sube a GitHub Pages y funciona. |
| **Godot 4** | 🟡 legacy + roadmap | Los proyectos Godot existentes aún cargan + editan. Reinversión first-class en el roadmap post-launch. |
| **Unity** | 🚧 planeado | Apuntado para después de que Godot llegue a first-class. |

---

## 📚 Documentación

- [`docs/architecture.md`](docs/architecture.md) — principios de diseño, paradigma agent-first
- [`docs/roadmap.md`](docs/roadmap.md) — plan por fases
- [`docs/genre-support.md`](docs/genre-support.md) — matriz de géneros
- Archivos de convention (vendored por proyecto) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipes (vendored por proyecto) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 Contribuir

Estamos en pre-launch. El codebase es lo suficientemente pequeño como para aceptar PRs, pero por favor abre un issue primero para discutir el scope. Las mejores formas de ayudar ahora:

- **Pruébalo y reporta bugs** — abre un issue con el log del daemon (`~/.ogf/claude-code-debug.jsonl` o tu terminal donde corre `npm run dev`)
- **Construye un juego** y muéstranoslo — feliz de incluirlo en el README
- **Prueba en macOS / Linux** — el dev principal está en Windows; los problemas multiplataforma probablemente acechan

---

## 🔐 Seguridad y datos

- **Tu código se queda en tu máquina.** AGF es local-first. El daemon hace bind a `127.0.0.1`; nada sale de tu máquina excepto las llamadas al proveedor de IA que elegiste.
- **Las API keys** se almacenan en `~/.ogf/secrets.json` con file mode 600 (solo el dueño). Nunca entran en git, nunca aparecen en los logs de AGF.
- **Las conversaciones** se guardan en `~/.ogf/ogf.db` (SQLite). Elimina el archivo para resetear.

---

## 📜 Licencia

Licenciado bajo la [Apache License, Versión 2.0](LICENSE). Puedes usar, modificar, hacer fork y distribuir libremente — comercial o no. Solo conserva el aviso de copyright y licencia.

---

## 🙏 Créditos

- Patrón daemon-and-spawn adaptado de [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Pipeline de generación de sprites adaptado de [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- Construido con Codex CLI + Claude Code — sí, este proyecto está escrito en gran parte por los mismos agentes que conduce

---

<p align="center">
  Hecho para indie game devs que aman shipping.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Reportar un bug</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
