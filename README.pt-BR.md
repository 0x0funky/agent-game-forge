<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>A IDE de jogos 2D local-first e bring-your-own-agent.</b><br/>
  Codex ou Claude Code conduz. Você entrega JS de navegador vanilla.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.es.md">Español</a> ·
  <b>Português (Brasil)</b> ·
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
  <img src="https://img.shields.io/badge/license-pending-lightgrey" alt="license"/>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

---

Agent Game Forge (**AGF**) é uma IDE desktop open source que permite que um agente de codificação com IA construa jogos 2D completos por você — sprites, fundos parallax, física, perigos, itens coletáveis, layout de cenas — e te entrega um editor visual para ajustar arrastando aquilo que o agente não acertou. **Você escolhe o agente** (Codex CLI ou Claude Code), **você escolhe o modelo de imagem** (Gemini 2.5 Flash Image ou OpenAI gpt-image-1), e o jogo resultante é JS + Canvas puro — roda em qualquer navegador, sem lock-in de framework.

---

## ✨ Em resumo

- 🤖 **Traga seu próprio agente** — Codex CLI ou Claude Code. Troque em Settings. Ao vivo.
- 🎨 **Pipeline de assets nível produção** — chroma-key de sprite sheets, animação multi-ação, parallax de 4 camadas tileable + despill — tudo de primeira classe, não enxertado.
- 🖼️ **Geração de imagens multi-provedor** — Gemini 2.5 Flash Image (barato, multimodal nativo) ou OpenAI gpt-image-1 (premium). Você fornece a API key; ela fica na sua máquina.
- 🧱 **Editor visual de cenas** — arraste plataformas, perigos, itens, colisores; overlay de hitbox; reload ao vivo na aba Play.
- 📦 **Runtime Vanilla JS + Canvas** — os jogos gerados têm zero dependência de framework. Suba a pasta no GitHub Pages e simplesmente funciona.
- 💻 **Local-first, open source** — daemon + UI web em `localhost`; seus arquivos de projeto ficam no seu disco; intenção no estilo MIT.
- 💰 **Custo transparente** — o painel de Settings mostra a quantidade de chamadas de gen-image do dia e o gasto estimado em $ por provedor.

---

## 🎬 Demo

> Em breve: vídeo demo de 90 segundos mostrando prompt → plataforma jogável → edição ao vivo → troca de CLI.

**Hero shot** (a janela do AGF):

> _Inserir screenshot hero quando disponível_

**Settings — prova de BYOA**:

> _Inserir screenshot do modal Settings mostrando agent picker + API keys + image-gen defaults_

**Editor de cenas — arraste um perigo, veja no Play**:

> _Inserir GIF curto_

---

## 🚀 Início rápido

**Requisitos**: Node ≥ 20, npm ≥ 10, e **pelo menos um** de:

- [Codex CLI](https://github.com/openai/codex) — `npm i -g @openai/codex`
- [Claude Code](https://github.com/anthropics/claude-code) — `npm i -g @anthropic-ai/claude-code`

```bash
git clone https://github.com/0x0funky/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

Isso inicia:

- **Daemon** em <http://localhost:7621>
- **Web UI** em <http://localhost:7620>

Abra a URL web. Clique no ícone de engrenagem (canto superior direito) → **Settings**:

1. **Agent CLI** — escolha Codex ou Claude Code (o que você tiver instalado).
2. **API keys** (só necessário para o caminho Claude Code) — cole sua key do Gemini ou da OpenAI. O daemon grava em `~/.ogf/secrets.json` (mode 600). Variáveis de ambiente (`OPENAI_API_KEY`, `GEMINI_API_KEY`) têm prioridade sobre o arquivo.
3. **Image-gen defaults** — escolha o provedor + modelo preferidos.

Feche Settings. Abra uma pasta de projeto. Digite um prompt como:

> *"Plataforma de scroll lateral sobre um cachorro voltando para casa, com fases de telhado e portão do parque."*

Aperte enviar. Veja o agente construir. Pressione **Play** quando ele parar.

---

## 🧭 Como funciona

```
        ┌──────────────┐    ┌──────────────────────────┐    ┌─────────────┐
Você ─→ │  Web UI      │ ←→ │  Daemon (Node + SQLite)  │ ←→ │  Agent CLI  │
        │  React canvas│    │  /api/runs, /api/scenes  │    │  (Codex /   │
        │  Scene editor│    │  /api/gen-image (routed) │    │   Claude    │
        └──────────────┘    └──────────────┬───────────┘    │   Code)     │
                                           │                 └─────┬───────┘
                                           ↓                       │
                                    ┌──────┴──────┐                │
                                    │ Gemini /    │ ←──────────────┘
                                    │ OpenAI API  │   (gen-image via
                                    │ (sua key)   │    daemon HTTP)
                                    └─────────────┘
```

**1. Você conversa com o agente no chat.** A UI web faz streaming da conversa; SSE retransmite cada token + chamada de ferramenta.

**2. O agente lê as conventions e skills do AGF.** Cada projeto é vendored com `.ogf/conventions/` (regras universais + por gênero) e `.agents/skills/` (procedimentos de geração de sprite + map). O agente segue as recipes — não reinventa a pipeline.

**3. Para imagens, o agente chama o `/api/gen-image` do daemon** (via `python .agents/tools/gen-image.py` ou `curl` direto). O daemon roteia para Gemini ou OpenAI usando sua API key salva. Usuários de Codex com a ferramenta `image_gen` integrada podem usar essa no lugar — ambos os caminhos produzem PNGs equivalentes.

**4. O editor de cenas lê + escreve os mesmos arquivos JSON** que o agente cria. Arraste uma plataforma; o editor commita um patch JSON. Atualize a visão do agente; ele vê a mudança.

**5. O runtime é o próprio projeto.** Os jogos gerados são JS + Canvas puro — `index.html`, `src/*.js`, `data/*.json`, `assets/`. Suba a pasta no GitHub Pages. Pronto.

---

## 📂 Estrutura do repositório

```
open-game-forge/
├── packages/
│   └── contracts/      # tipos TypeScript compartilhados: API, events, SceneModel
├── apps/
│   ├── daemon/         # daemon Node.js + Express (port 7621)
│   │   └── src/
│   │       ├── server.ts            # HTTP routes
│   │       ├── codex.ts             # Codex CLI adapter (spawn + stream-json)
│   │       ├── claude-code.ts       # Claude Code adapter (mesmo padrão)
│   │       ├── agents.ts            # AgentAdapter dispatcher
│   │       ├── gen-image.ts         # Gemini + OpenAI router
│   │       ├── secrets.ts           # store ~/.ogf/secrets.json
│   │       ├── prefs.ts             # store ~/.ogf/preferences.json
│   │       ├── web-scene.ts         # loader JSON level → SceneModel
│   │       ├── scenes.ts            # SceneOp applier (move/scale/add/remove)
│   │       └── templates/           # skills / conventions / recipes vendored
│   └── web/            # UI Vite + React (port 7620)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           │   ├── SceneEditor.tsx  # editor de cenas baseado em Canvas
│           │   ├── SettingsModal.tsx
│           │   └── PlayPane.tsx
│           └── lib/api.ts
└── docs/
    ├── architecture.md
    ├── roadmap.md
    └── genre-support.md
```

---

## 🛠️ Compilar do código-fonte

```bash
npm install           # install do workspace
npm run build         # build contracts → daemon → web
npm run dev           # modo watch para os três (daemon faz hot-reload via tsx)
```

Comandos úteis:

- `npm -w @ogf/daemon run dev` — apenas o daemon, com `tsx watch`
- `npm -w @ogf/web run dev` — dev server do Vite
- `npm -w @ogf/contracts run build` — type-check do pacote contracts

---

## 📋 Status do projeto

| Gênero | Status | Notas |
|---|---|---|
| **Plataforma side-scroll** | ✅ entregue | Pipeline parallax, perigos, itens, inimigos, multi-fase, chroma-key de sprites |
| RPG top-down | 🟡 parcial | Foundation seed + recipes; algumas recipes ainda amadurecendo |
| Tower defense / arena | 🟡 parcial | Herdado de branches anteriores; precisa de polish |
| Roguelike / Metroidvania | 🚧 planejado | Após o launch |

**Engines**: Web (vanilla JS + Canvas) é o target padrão e ativamente desenvolvido. Godot 4 ainda funciona para projetos legados; nenhuma feature nova de Godot está sendo adicionada.

---

## 📚 Documentação

- [`docs/architecture.md`](docs/architecture.md) — princípios de design, paradigma agent-first
- [`docs/roadmap.md`](docs/roadmap.md) — plano por fases
- [`docs/genre-support.md`](docs/genre-support.md) — matriz de gêneros
- Arquivos de convention (vendored por projeto) — [`apps/daemon/src/templates/conventions/`](apps/daemon/src/templates/conventions)
- Recipes (vendored por projeto) — [`apps/daemon/src/templates/recipes/`](apps/daemon/src/templates/recipes)

---

## 🤝 Contribuindo

Estamos em pre-launch. O codebase é pequeno o suficiente para receber PRs, mas por favor abra uma issue antes para discutir escopo. Melhores formas de ajudar agora:

- **Teste e reporte bugs** — abra uma issue com o log do daemon (`~/.ogf/claude-code-debug.jsonl` ou seu terminal onde `npm run dev` está rodando)
- **Construa um jogo** e mostre pra gente — feliz em destacar no README
- **Teste em macOS / Linux** — o dev principal está em Windows; problemas multiplataforma provavelmente espreitam

---

## 🔐 Segurança e dados

- **Seu código fica na sua máquina.** AGF é local-first. O daemon faz bind em `127.0.0.1`; nada sai da sua máquina exceto chamadas para o provedor de IA escolhido.
- **API keys** ficam guardadas em `~/.ogf/secrets.json` com file mode 600 (só o dono). Nunca entram no git, nunca aparecem nos logs do AGF.
- **Conversas** são armazenadas em `~/.ogf/ogf.db` (SQLite). Apague o arquivo para resetar.

---

## 📜 Licença

Licença pendente — será amigável a open source (MIT ou Apache-2.0) no launch. O código é público; por favor não redistribua forks comerciais antes da licença ser definida.

---

## 🙏 Créditos

- Padrão daemon-and-spawn adaptado de [`nexu-io/open-design`](https://github.com/nexu-io/open-design)
- Pipeline de geração de sprites adaptado de [`0x0funky/agent-sprite-forge`](https://github.com/0x0funky/agent-sprite-forge)
- Construído com Codex CLI + Claude Code — sim, este projeto é em grande parte escrito pelos mesmos agentes que ele conduz

---

<p align="center">
  Feito para indie game devs que gostam de shippar.<br/>
  <a href="https://github.com/0x0funky/agent-game-forge/issues">Reportar um bug</a> ·
  <a href="https://github.com/0x0funky/agent-game-forge/discussions">Discussions</a>
</p>
