<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>Локальная 2D-IDE для игр с принципом bring-your-own-agent.</b><br/>
  Codex или Claude Code за рулём. Web сегодня, Godot и Unity — в roadmap.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.pt-BR.md">Português (Brasil)</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.zh-TW.md">繁體中文</a> ·
  <a href="./README.ko.md">한국어</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.ar.md">العربية</a> ·
  <b>Русский</b> ·
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
  🎨 Конвейер спрайтов от <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a>
</p>

---

Agent Game Forge (**AGF**) — это десктопная IDE с открытым исходным кодом, которая позволяет ИИ-агенту по коду собрать для вас полноценные 2D-игры — спрайты, parallax-фоны, физику, опасности, подбираемые предметы, расстановку сцен — и предоставляет визуальный редактор, чтобы перетаскиванием подправить то, что агент сделал не так. **Вы выбираете агента** (Codex CLI или Claude Code) и **вы выбираете модель изображений** (Gemini 2.5 Flash Image или OpenAI gpt-image-1). Сегодня выходной формат по умолчанию — vanilla JS + Canvas (нулевая привязка к фреймворку, запускается в любом браузере); таргеты движков Godot 4 и Unity — в roadmap.

---

## ✨ Кратко

- 🤖 **Свой агент** — Codex CLI или Claude Code. Переключение в Settings. На лету.
- 🎨 **Production-grade пайплайн ассетов** — хромакей sprite-листов, мульти-экшен анимации, parallax из 4 тайлящихся слоёв + despill — всё первоклассное, не прикручено сбоку.
- 🖼️ **Мульти-провайдерная генерация изображений** — Gemini 2.5 Flash Image (дёшево, нативно мультимодально) или OpenAI gpt-image-1 (премиум). API-ключ вы предоставляете сами; он остаётся на вашей машине.
- 🧱 **Визуальный редактор сцен** — перетаскивайте платформы, опасности, предметы, коллайдеры; оверлей hitbox; live reload во вкладке Play.
- 📦 **Мульти-движковая поддержка в roadmap** — Web (vanilla JS + Canvas) выходит уже сегодня с нулевой привязкой к фреймворку (залейте на GitHub Pages — работает). Таргеты Godot 4 и Unity запланированы.
- 💻 **Local-first, open source** — daemon + web UI на `localhost`; файлы проекта остаются на вашем диске; намерение в духе MIT.
- 💰 **Прозрачность расходов** — панель Settings показывает количество вызовов генерации изображений за сегодня и оценочные траты в $ по каждому провайдеру.

---

## 🎬 Демо

**Hero shot** — окно AGF:

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="Главное окно AGF" width="800" />
</p>

**Settings** — выберите агента + API-ключи + настройки генерации изображений:

<p align="center">
  <img src="apps/web/public/setting.png" alt="Модальное окно AGF Settings" width="800" />
</p>

**Редактор сцен** — перетаскивайте платформы, опасности, предметы, коллайдеры:

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="Редактор сцен AGF" width="800" />
</p>

---

## 🚀 Быстрый старт

**Требования**: Node ≥ 20, npm ≥ 10 и **как минимум одно** из:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

Это запускает:

- **Daemon** по адресу <http://localhost:7621>
- **Web UI** по адресу <http://localhost:7620>

Откройте веб-URL. Кликните по иконке шестерёнки (вверху справа) → **Settings**:

1. **Agent CLI** — выберите Codex или Claude Code (тот, который установили).
2. **API keys** (нужны только для пути Claude Code) — вставьте ключ Gemini или OpenAI. Daemon запишет их в `~/.ogf/secrets.json` (mode 600). Переменные окружения (`OPENAI_API_KEY`, `GEMINI_API_KEY`) переопределяют файл.
3. **Image-gen defaults** — выберите предпочтительного провайдера + модель.

Закройте Settings. Откройте папку проекта. Введите prompt вроде:

> *"Сайд-скролл платформер про собаку, идущую домой, с уровнями на крышах и у ворот парка."*

Нажмите отправить. Смотрите, как агент его собирает. Нажмите **Play**, когда он остановится.

---

## 🧭 Как это работает

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
Вы ─→   │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (routed) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (генерация изображений
                                    │ (ваш ключ)  │    через daemon HTTP)
                                    └─────────────┘
```

**1. Вы общаетесь с агентом в чате.** Web UI стримит беседу; SSE передаёт каждый токен + вызов инструмента.

**2. Агент читает conventions и skills AGF.** В каждый проект вендорятся `.ogf/conventions/` (универсальные правила + по жанрам) и `.agents/skills/` (процедуры генерации спрайтов + карт). Агент следует recipes — он не переизобретает пайплайн.

**3. Для изображений агент вызывает `/api/gen-image` daemon'а** (через `python .agents/tools/gen-image.py` или прямой `curl`). Daemon маршрутизирует в Gemini или OpenAI, используя сохранённый вами API-ключ. Пользователи Codex со встроенным инструментом `image_gen` могут использовать его — оба пути дают эквивалентные PNG.

**4. Редактор сцен читает + пишет те же JSON-файлы**, которые создаёт агент. Перетащите платформу; редактор зафиксирует JSON-патч. Обновите вид агента; он увидит изменения.

**5. Runtime — это сам проект.** Сгенерированные игры — это чистый JS + Canvas — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Залейте папку на GitHub Pages. Готово.

---

## 📂 Структура репозитория

```
open-game-forge/
├── packages/
│   └── contracts/      # общие TypeScript-типы: API, events, SceneModel
├── apps/
│   ├── daemon/         # daemon Node.js + Express (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (тот же паттерн)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # хранилище ~/.ogf/secrets.json
│   │       ├── prefs.ts             # хранилище ~/.ogf/preferences.json
│   │       ├── web-scene.ts         # JSON level → SceneModel loader
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # вендоренные skills / conventions / recipes
│   └── web/            # UI Vite + React (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # редактор сцен на Canvas
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ Сборка из исходников

```bash
npm install           # установка workspace
npm run build         # сборка contracts → daemon → web
npm run dev           # watch-режим для всех трёх (daemon hot-reload через tsx)
```

Полезные команды:

- `npm -w @ogf/daemon run dev` — только daemon, с `tsx watch`
- `npm -w @ogf/web run dev` — Vite dev-сервер
- `npm -w @ogf/contracts run build` — type-check пакета contracts

---

## 📋 Статус проекта

| Жанр | Статус | Заметки |
|---|---|---|
| **Сайд-скролл платформер** | ✅ выпущен | Parallax-пайплайн, опасности, предметы, враги, мульти-уровни, хромакей спрайтов |
| Top-down RPG | 🟡 частично | Foundation seed + recipes; некоторые recipes ещё дозревают |
| Tower defense / arena | 🟡 частично | Унаследовано из ранних веток; нужна шлифовка |
| Roguelike / Metroidvania | 🟡 частично | После запуска |

**Таргеты движков**:

| Движок | Статус | Заметки |
|---|---|---|
| **Web** (vanilla JS + Canvas) | ✅ по умолчанию | Активно развивается. Нулевая привязка к фреймворку; залейте папку на GitHub Pages — и работает. |
| **Godot 4** | 🟡 legacy + roadmap | Существующие проекты Godot по-прежнему открываются и редактируются. Полноценные инвестиции — на пост-релизном roadmap. |
| **Unity** | 🚧 запланировано | Целевая работа начнётся после того, как Godot выйдет на первоклассный уровень. |

---

## 📚 Документация

- [`docs/architecture.md`](docs/architecture.md) — принципы проектирования, парадигма agent-first
- [`docs/roadmap.md`](docs/roadmap.md) — поэтапный план
- [`docs/genre-support.md`](docs/genre-support.md) — матрица жанров
- Файлы convention (вендорятся по проектам) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipes (вендорятся по проектам) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 Контрибьютинг

Мы в pre-launch. Кодовая база достаточно мала, чтобы принимать PR, но, пожалуйста, сначала откройте issue для обсуждения scope. Лучшие способы помочь прямо сейчас:

- **Попробуйте и сообщайте о багах** — откройте issue с логом daemon (`~/.ogf/claude-code-debug.jsonl` или ваш терминал, где запущен `npm run dev`)
- **Соберите игру** и покажите нам — с радостью покажем её в README
- **Тестируйте на macOS / Linux** — основная разработка идёт на Windows; кросс-платформенные проблемы наверняка где-то скрываются

---

## 🔐 Безопасность и данные

- **Ваш код остаётся на вашей машине.** AGF — local-first. Daemon биндится на `127.0.0.1`; ничего не покидает вашу машину, кроме вызовов выбранного вами провайдера ИИ.
- **API-ключи** хранятся в `~/.ogf/secrets.json` с file mode 600 (только владелец). Они никогда не попадают в git и никогда не появляются в логах AGF.
- **Разговоры** хранятся в `~/.ogf/ogf.db` (SQLite). Удалите файл, чтобы сбросить.

---

## 📜 Лицензия

Лицензировано под [Apache License, Version 2.0](LICENSE). Вы можете свободно использовать, изменять, форкать и распространять — в том числе коммерчески. Просто сохраняйте уведомление о copyright и лицензии.

---

## 🙏 Благодарности

- Паттерн daemon-and-spawn адаптирован из [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Пайплайн генерации спрайтов адаптирован из [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- Собрано с помощью Codex CLI + Claude Code — да, этот проект в значительной мере написан теми самыми агентами, которыми он управляет

---

<p align="center">
  Сделано для инди-геймдевов, которые любят выпускать.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Сообщить о баге</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
