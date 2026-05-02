// Smoke test: parse and round-trip the meadow scene from skill_generatemap_test.
// Run: npx tsx apps/daemon/src/scenes.smoke.ts
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyOps, loadScene } from './scenes.js';
import { parseTscn, joinTscn } from './tscn-parse.js';

const ROOT = 'D:\\skill_generatemap_test';
const REL = 'scenes/meadow_map.tscn';

async function main() {
  // ---------- Round-trip ----------
  const before = readFileSync(path.join(ROOT, REL), 'utf8');
  const parsed = parseTscn(before);
  const after = joinTscn(parsed);
  assert.strictEqual(after, before, 'parseTscn → joinTscn must be byte-identical');
  console.log('[ok] round-trip is byte-identical');

  // ---------- Load ----------
  const r = loadScene({ rootAbs: ROOT, relPath: REL });
  console.log(`[ok] loaded scene: root=${r.scene.rootName} props=${r.scene.props.length}`);
  console.log(`     background: ${r.scene.background?.relPath ?? 'none'} (${r.scene.background?.source ?? '-'})`);
  console.log(`     notes: ${r.scene.notes.join(' | ') || 'none'}`);

  assert.ok(r.scene.props.length > 0, 'should detect at least one prop');
  const tree = r.scene.props.find((p) => p.name === 'tree_north_1');
  assert.ok(tree, 'expected tree_north_1 prop');
  assert.strictEqual(tree.position.x, 640);
  assert.strictEqual(tree.position.y, 300);
  assert.ok(tree.texture?.endsWith('young-broadleaf-tree/prop.png'));
  console.log(`[ok] tree_north_1 at (${tree.position.x},${tree.position.y}) tex=${tree.texture}`);

  // ---------- Image payloads ----------
  console.log(`[ok] image payloads: ${r.images.length}`);
  for (const img of r.images.slice(0, 3)) {
    console.log(`     - ${img.relPath} ${img.width}x${img.height}`);
  }

  // ---------- Apply move + check diff ----------
  const NEW_POS = { x: 700, y: 350 };
  applyOps({
    rootAbs: ROOT,
    relPath: REL,
    ops: [{ kind: 'move-prop', nodePath: tree.nodePath, position: NEW_POS }],
  });
  const reloaded = loadScene({ rootAbs: ROOT, relPath: REL });
  const tree2 = reloaded.scene.props.find((p) => p.name === 'tree_north_1');
  assert.strictEqual(tree2?.position.x, 700);
  assert.strictEqual(tree2?.position.y, 350);
  console.log(`[ok] write-back: tree_north_1 now at (${tree2.position.x},${tree2.position.y})`);

  // ---------- Diff size ----------
  const after2 = readFileSync(path.join(ROOT, REL), 'utf8');
  const linesBefore = before.split('\n');
  const linesAfter = after2.split('\n');
  let differing = 0;
  for (let i = 0; i < Math.max(linesBefore.length, linesAfter.length); i++) {
    if (linesBefore[i] !== linesAfter[i]) differing++;
  }
  console.log(`[ok] diff: ${differing} differing line(s) (expected: 1)`);
  assert.strictEqual(differing, 1, 'a single move should change exactly one line');

  // ---------- Restore ----------
  applyOps({
    rootAbs: ROOT,
    relPath: REL,
    ops: [{ kind: 'move-prop', nodePath: tree.nodePath, position: { x: 640, y: 300 } }],
  });
  const after3 = readFileSync(path.join(ROOT, REL), 'utf8');
  assert.strictEqual(after3, before, 'restore should produce byte-identical original');
  console.log('[ok] restore produced byte-identical original');

  console.log('\n--- kindomrush ForestPass.tscn ---');
  const KR_ROOT = 'D:\\kindomrush';
  const KR_REL = 'scenes/ForestPass.tscn';
  const krBefore = readFileSync(path.join(KR_ROOT, KR_REL), 'utf8');
  const krParsed = parseTscn(krBefore);
  const krAfter = joinTscn(krParsed);
  assert.strictEqual(krAfter, krBefore, 'kr round-trip must be byte-identical');
  console.log('[ok] kr round-trip identical');

  const kr = loadScene({ rootAbs: KR_ROOT, relPath: KR_REL });
  console.log(`[ok] kr scene: root=${kr.scene.rootName} props=${kr.scene.props.length}`);
  console.log(`     bg: ${kr.scene.background?.relPath ?? 'none'} (${kr.scene.background?.source ?? '-'})`);
  assert.ok(kr.scene.props.length > 0, 'should detect kindomrush props');
  const oak = kr.scene.props.find((p) => p.name === 'OakTree_Northwest');
  assert.ok(oak, 'expected OakTree_Northwest');
  assert.strictEqual(oak.position.x, 126);
  assert.strictEqual(oak.position.y, 163);
  console.log(`[ok] OakTree_Northwest at (${oak.position.x},${oak.position.y})`);

  // kindomrush write-back + restore
  applyOps({
    rootAbs: KR_ROOT,
    relPath: KR_REL,
    ops: [{ kind: 'move-prop', nodePath: oak.nodePath, position: { x: 200, y: 200 } }],
  });
  const krMoved = loadScene({ rootAbs: KR_ROOT, relPath: KR_REL });
  const oak2 = krMoved.scene.props.find((p) => p.name === 'OakTree_Northwest');
  assert.strictEqual(oak2?.position.x, 200);
  assert.strictEqual(oak2?.position.y, 200);
  applyOps({
    rootAbs: KR_ROOT,
    relPath: KR_REL,
    ops: [{ kind: 'move-prop', nodePath: oak.nodePath, position: { x: 126, y: 163 } }],
  });
  const krRestored = readFileSync(path.join(KR_ROOT, KR_REL), 'utf8');
  assert.strictEqual(krRestored, krBefore, 'kr restore must be byte-identical');
  console.log('[ok] kr write/restore byte-identical');

  console.log('\n[PASS] all smoke checks');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
