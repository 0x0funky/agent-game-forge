// OGF project conventions — split as of feature/skill-bundle-spec-slim
// branch into multiple genre-aware .md files under templates/conventions/.
// Bootstrap copies them all into <project>/.ogf/conventions/.
//
// This file now ONLY exports thin pointer strings — the authoritative
// content lives in:
//
//   templates/conventions/
//     index.md
//     common.md
//     runtime-patterns.md
//     genres/
//       side-scroll.md
//       top-down-rpg.md
//       tower-defense.md
//       arena-survivor.md
//       shmup.md
//
// Why split:
// - Old monolithic conventions.ts was ~1700 lines, mixed common rules
//   with side-scroll-specific rules, contaminated other genres.
// - Each project now bootstraps with all of them, but only reads the
//   genre file matching the user's choice. Effective context is ~600
//   lines instead of ~1700.
// - Industry-standard 2D-game patterns (camera, parallax, AABB, FSM)
//   are now in runtime-patterns.md with citations rather than
//   re-derived in every section.
// - Skill-specific rules live in .agents/skills/ and are read by codex
//   directly when invoking the skill.

const POINTER = `# OGF project conventions — index

This shim file points at the actual conventions, which now live at:

  .ogf/conventions/
    index.md             ← read this first; explains what's where
    common.md            ← REQUIRED. Schema, file layout, spec authorship,
                           skill invocation rules.
    runtime-patterns.md  ← REQUIRED. 8 universal 2D-game runtime patterns
                           (delta time, AABB, animation loop, FSM, pooling,
                           Y-sort, scroll factor).
    genres/
      side-scroll.md     ← if your project genre = side-scroller / platformer
      top-down-rpg.md    ← if your project genre = top-down RPG
      tower-defense.md   ← if your project genre = tower defense
      arena-survivor.md  ← if your project genre = arena survivor (Vampire Survivors)
      shmup.md           ← if your project genre = shoot-em-up

  .agents/skills/        ← codex skill bundle (auto-discovered)
    generate2dmap/
    generate2dsprite/

## Read order at every turn

1. \`.ogf/conventions/common.md\` — always
2. \`.ogf/conventions/runtime-patterns.md\` — always
3. \`.ogf/conventions/genres/<your-genre>.md\` — based on spec.md §1 genre
4. \`.agents/skills/generate2dmap/agents/openai.yaml\` — distilled invocation defaults
5. \`.agents/skills/generate2dsprite/agents/openai.yaml\` — same
6. SKILL.md / references/*.md if a deeper question

If a rule isn't in these files, follow the standard 2D-game pattern for the genre. The conventions point at canonical reference repos rather than re-deriving — Mike Hadley's Phaser tilemap series, Itay Keren's Scroll Back camera essay, etc.
`;

/** Bootstrap writes this short pointer to \`.ogf/conventions.md\`.
 *  The real content is at \`.ogf/conventions/\` (split files).
 *
 *  The function still exists as the same name for backwards compat —
 *  bootstrap.ts and server.ts (composePrompt) both call it. Both
 *  callers benefit from a short string here because composePrompt
 *  also pulls the relevant convention files into context separately.
 */
export function godotConventions(): string {
  return POINTER;
}

export function webConventions(): string {
  return POINTER;
}

/** Loaded by composePrompt — short summary, not the full doc. The full
 *  docs are in .ogf/conventions/ (split into common + runtime-patterns +
 *  genre-specific) for projects bootstrapped with the new layout. */
export function summarizeConventions(): string {
  return `# OGF conventions (full docs at .ogf/conventions/)

The conventions are split into multiple files under .ogf/conventions/.
Read this file order at every turn:

1. .ogf/conventions/common.md           — schema, file layout, spec rules
2. .ogf/conventions/runtime-patterns.md — universal 2D-game patterns
3. .ogf/conventions/genres/<genre>.md   — genre-specific (read your project's only)

Plus the skill bundles at .agents/skills/{generate2dmap,generate2dsprite}/.

Quick reminders:

- Data and code SEPARATE. Numbers in JSON under data/, never inline.
- Spatial shapes: { x, y } point / { x, y, w, h } rect / { x, y, radius } circle / { points: [[x,y]...] } polygon.
- Visual assets ALWAYS via $generate2dsprite or $generate2dmap — never raw image_gen.
- Every gen call after the first MUST view_image a prior asset and pass reference: 'generated_image' for visual consistency.
- Generating ≠ done. After the skill writes assets, you MUST edit level / catalog JSON to reference them.
- Live editor state at .ogf/scene-context.json — read it for spatial questions.
- Spec.md describes WHAT the game IS, not HOW to render it. Skill defaults handle the HOW.
`;
}
