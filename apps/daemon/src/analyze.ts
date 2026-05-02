import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { EngineKind } from './projects.js';

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.ogf',
  '.next',
  '.vite',
  '.cache',
  '.godot',
  '.import',
  'dist',
  'build',
  '.idea',
  '.vscode',
]);

const MAX_FILES_TO_SCAN = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // skip files bigger than 5 MB

export interface AnalyzeResult {
  engine: EngineKind;
  /** Relative POSIX paths (without engine prefix) that are referenced from somewhere. */
  usedAssets: string[];
  /** Total scanned source files (.tscn / .tres / .gd / etc.). */
  scanned: number;
}

export function analyzeProject(rootAbs: string, engine: EngineKind): AnalyzeResult {
  const used = new Set<string>();
  let scanned = 0;
  const seen = { count: 0 };

  function walk(dirAbs: string) {
    if (seen.count >= MAX_FILES_TO_SCAN) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return;
    }
    for (const name of entries) {
      if (IGNORED.has(name)) continue;
      const childAbs = path.join(dirAbs, name);
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childAbs);
      } else if (st.isFile()) {
        seen.count++;
        if (seen.count >= MAX_FILES_TO_SCAN) return;
        if (st.size > MAX_FILE_BYTES) continue;
        scanFile(childAbs);
      }
    }
  }

  function scanFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (engine === 'godot') {
      if (ext !== '.tscn' && ext !== '.tres' && ext !== '.gd' && ext !== '.gdshader') return;
    } else if (engine === 'unity') {
      // Unity asset references use GUIDs in YAML — proper resolution requires .meta lookups.
      // Skip for v1; Unity analyzer is on the roadmap.
      return;
    } else if (engine === 'web') {
      if (ext !== '.html' && ext !== '.htm' && ext !== '.js' && ext !== '.jsx' && ext !== '.ts' && ext !== '.tsx' && ext !== '.css') return;
    } else {
      return;
    }

    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    scanned++;

    if (engine === 'godot') {
      // path="res://assets/foo.png"
      const re1 = /res:\/\/([^"\s)]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re1.exec(content)) !== null) {
        const p = m[1].replace(/\\/g, '/').replace(/\/+$/, '');
        if (p) used.add(p);
      }
    } else if (engine === 'web') {
      // Naive: catch import './foo.png' / from "./foo.svg" / src="./foo.gif"
      const re = /["']\.{0,2}\/?([^"'\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg|mp3|wav|ogg|webm|mp4))["']/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        used.add(m[1].replace(/\\/g, '/'));
      }
    }
  }

  walk(rootAbs);
  return {
    engine,
    usedAssets: [...used].sort(),
    scanned,
  };
}
