# OGF project conventions — index

This is the contract between Codex and the OGF editor. The editor renders + edits things in the layout these files describe; Codex must keep producing them in this layout so the editor stays useful.

## What's where

```
.ogf/conventions/
  index.md               ← this file (pointers)
  common.md              ← REQUIRED. OGF process, schema, file layout, spec authorship.
  runtime-patterns.md    ← REQUIRED. 8 universal 2D-game runtime patterns
                           (delta time, AABB, anim loop, FSM, pooling, etc.)
                           These are the same across every genre.
  wrap-existing-project.md ← Read ONLY if wrapping/converting an existing
                             non-OGF project (sidecar or migrate mode).
                             NOT for fresh OGF scaffolds.
  genres/
    side-scroll.md       ← if your project genre = side-scroller / platformer
    top-down-rpg.md      ← if your project genre = top-down RPG
    tower-defense.md     ← if your project genre = tower defense
    arena-survivor.md    ← if your project genre = arena survivor (Vampire Survivors)
    shmup.md             ← if your project genre = shoot-em-up (vertical or horizontal)

.agents/skills/          ← codex skills (auto-discovered by codex CLI)
  generate2dmap/
  generate2dsprite/

.ogf/spec.md             ← the game description the agent authors
.ogf/style-anchor.png    ← visual reference for image generation
```

## Read order at every turn

1. `.ogf/conventions/common.md` — always
2. `.ogf/conventions/runtime-patterns.md` — always (these are universal)
3. `.ogf/conventions/genres/<your-genre>.md` — based on spec.md §1 genre
4. `.ogf/conventions/wrap-existing-project.md` — ONLY if the user asked
   you to "wrap / convert / OGF-fy / sidecar" an existing non-OGF
   project. Skip for fresh scaffolds.
5. `.agents/skills/generate2dmap/agents/openai.yaml` — distilled invocation defaults
6. `.agents/skills/generate2dsprite/agents/openai.yaml` — same
7. The relevant `SKILL.md` and `references/*.md` if a deeper question

## Philosophy

OGF is the **shell** + **schema** + **delivery contract**. It does NOT re-derive industry-standard 2D-game patterns — those are linked from each genre file (Mike Hadley's Phaser tilemap series, Itay Keren's camera essay, the Phaser TD tutorial, etc.) The agent already knows these patterns from training; the genre files just point at the canonical implementation so a single project's choices stay consistent.

**If a rule isn't in these files, follow the standard 2D-game pattern for the genre.** If the pattern conflicts with OGF's schema or file layout, OGF wins. Otherwise, just do the obvious thing.

## What you DON'T need to read

- ~~All five genre files~~ — read your project's genre only.
- ~~`runtime-patterns.md` for genre-specific stuff~~ — runtime patterns are universal; genre files don't repeat them.
- ~~Long lists of "anti-patterns to avoid"~~ — they're embedded in the relevant genre file.
