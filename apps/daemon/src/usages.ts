import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const IGNORED = new Set([
  'node_modules', '.git', '.svn', '.hg', '.ogf', '.next', '.vite',
  '.cache', '.godot', '.import', 'dist', 'build', '.idea', '.vscode',
]);

const SEARCHABLE_EXT = new Set([
  '.tscn', '.tres', '.gd', '.gdshader', '.gdshaderinc',
  '.cs', '.shader', '.compute',
  '.json', '.yaml', '.yml',
  '.unity', '.prefab', '.asset', '.meta',
  '.html', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss',
]);

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_HITS_PER_FILE = 5;
const MAX_TOTAL_HITS = 500;

export interface UsageHit {
  file: string;       // relative POSIX path
  line: number;       // 1-based
  col: number;        // 1-based byte index of match
  snippet: string;    // the matched line, trimmed/clipped
}

/**
 * Find references to an asset across the project.
 * Matches:
 *   - Plain filename ("sheet-transparent.png")
 *   - res:// path ("res://assets/foo/sheet.png")
 *   - relative POSIX path ("assets/foo/sheet.png")
 * Skips the file itself.
 */
export function findUsages(rootAbs: string, relTarget: string): UsageHit[] {
  const targetRel = relTarget.replace(/\\/g, '/').replace(/^\//, '');
  const targetAbs = path.resolve(rootAbs, targetRel);

  // Only match full paths — bare filenames produce false positives when
  // multiple assets share the same name (e.g. each enemy has its own
  // sheet-transparent.png in its own folder).
  const patterns = [
    `res://${targetRel}`,
    targetRel,
  ].filter((p, i, arr) => arr.indexOf(p) === i);

  const hits: UsageHit[] = [];
  const seenLine = new Set<string>();
  const seen = { count: 0 };

  function walk(dirAbs: string) {
    if (seen.count >= MAX_FILES || hits.length >= MAX_TOTAL_HITS) return;
    let entries: string[] = [];
    try { entries = readdirSync(dirAbs); } catch { return; }
    for (const name of entries) {
      if (IGNORED.has(name)) continue;
      const childAbs = path.join(dirAbs, name);
      let st;
      try { st = statSync(childAbs); } catch { continue; }
      if (st.isDirectory()) {
        walk(childAbs);
      } else if (st.isFile()) {
        seen.count++;
        if (seen.count >= MAX_FILES) return;
        if (st.size > MAX_FILE_BYTES) continue;
        const ext = path.extname(name).toLowerCase();
        if (!SEARCHABLE_EXT.has(ext)) continue;
        if (childAbs === targetAbs) continue; // skip self
        if (name.endsWith('.ogf-slice.json')) continue; // skip our own metadata
        scan(childAbs);
        if (hits.length >= MAX_TOTAL_HITS) return;
      }
    }
  }

  function scan(filePath: string) {
    let content: string;
    try { content = readFileSync(filePath, 'utf8'); } catch { return; }
    const lines = content.split(/\r?\n/);
    let perFile = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let bestPos = -1;
      for (const p of patterns) {
        const idx = line.indexOf(p);
        if (idx >= 0 && (bestPos < 0 || idx < bestPos)) {
          bestPos = idx;
        }
      }
      if (bestPos < 0) continue;

      const rel = path.relative(rootAbs, filePath).replace(/\\/g, '/');
      const key = `${rel}:${i + 1}`;
      if (seenLine.has(key)) continue;
      seenLine.add(key);

      hits.push({
        file: rel,
        line: i + 1,
        col: bestPos + 1,
        snippet: clipSnippet(line, bestPos),
      });

      perFile++;
      if (perFile >= MAX_HITS_PER_FILE) return;
      if (hits.length >= MAX_TOTAL_HITS) return;
    }
  }

  walk(rootAbs);
  return hits;
}

function clipSnippet(line: string, _pos: number, maxLen = 200): string {
  const t = line.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + '…';
}
