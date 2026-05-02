import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.ogf',
  '.next',
  '.vite',
  '.cache',
  'dist',
  'build',
  '.DS_Store',
  '.idea',
  '.vscode',
]);

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env', '.log',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.cs', '.gd', '.gdshader', '.shader',
  '.tscn', '.tres', '.import', '.godot', '.csproj', '.sln', '.unity', '.prefab', '.asset', '.meta',
  '.html', '.css', '.scss', '.svg', '.xml',
  '.py', '.rb', '.go', '.rs', '.lua', '.sh', '.bat', '.cmd', '.ps1',
]);

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico']);

export type FileKind = 'text' | 'image' | 'binary';

export interface FileNode {
  name: string;
  relPath: string; // POSIX, empty string for root
  kind: 'dir' | 'file';
  fileKind?: FileKind;
  size?: number;
  mtimeMs?: number;
  children?: FileNode[]; // present on dir
}

export function classifyFile(name: string): FileKind {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTS.has(ext)) return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'binary';
}

function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error('path escapes project root');
  }
  return abs;
}

const MAX_FILES = 5000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function walkProject(rootAbs: string): FileNode {
  const seen = { count: 0 };

  function walk(dirAbs: string, relPosix: string): FileNode {
    const name = path.basename(dirAbs);
    const node: FileNode = {
      name: relPosix === '' ? path.basename(rootAbs) : name,
      relPath: relPosix,
      kind: 'dir',
      children: [],
    };

    let entries: string[] = [];
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return node;
    }

    entries.sort((a, b) => a.localeCompare(b));

    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry)) continue;
      if (seen.count >= MAX_FILES) break;

      const childAbs = path.join(dirAbs, entry);
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }

      const childRel = relPosix === '' ? entry : `${relPosix}/${entry}`;

      if (st.isDirectory()) {
        node.children!.push(walk(childAbs, childRel));
      } else if (st.isFile()) {
        seen.count++;
        node.children!.push({
          name: entry,
          relPath: childRel,
          kind: 'file',
          fileKind: classifyFile(entry),
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }

    // dirs first then files, both alpha-sorted
    node.children!.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return node;
  }

  return walk(path.resolve(rootAbs), '');
}

export interface ReadFileResult {
  kind: FileKind;
  content?: string; // when text
  base64?: string; // when image
  size: number;
  truncated?: boolean;
}

export function readProjectFile(rootAbs: string, relPath: string): ReadFileResult {
  const abs = safeJoin(rootAbs, relPath);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error('not a file');

  const kind = classifyFile(abs);

  if (kind === 'text') {
    if (st.size > MAX_TEXT_BYTES) {
      return { kind, size: st.size, truncated: true };
    }
    const content = readFileSync(abs, 'utf8');
    return { kind, content, size: st.size };
  }

  if (kind === 'image') {
    if (st.size > MAX_IMAGE_BYTES) {
      return { kind, size: st.size, truncated: true };
    }
    const buf = readFileSync(abs);
    return { kind, base64: buf.toString('base64'), size: st.size };
  }

  return { kind: 'binary', size: st.size };
}

export function writeProjectFile(
  rootAbs: string,
  relPath: string,
  content: string,
): { size: number } {
  const abs = safeJoin(rootAbs, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  const st = statSync(abs);
  return { size: st.size };
}

export function deleteProjectFile(rootAbs: string, relPath: string): void {
  const abs = safeJoin(rootAbs, relPath);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error('not a file');
  unlinkSync(abs);
}

const REF_DIR = '.ogf/refs';
const ALLOWED_REF_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

export function saveRefImage(
  rootAbs: string,
  filename: string,
  base64: string,
): { relPath: string; absPath: string; size: number } {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_REF_EXT.has(ext)) {
    throw new Error(`unsupported image extension: ${ext || '(none)'}`);
  }
  // sanitize: strip directory parts, keep base
  const safeName = path.basename(filename).replace(/[^A-Za-z0-9._-]+/g, '_');
  const relPath = `${REF_DIR}/${Date.now()}_${safeName}`;
  const abs = safeJoin(rootAbs, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });

  const buf = Buffer.from(base64, 'base64');
  writeFileSync(abs, buf);
  return { relPath, absPath: abs, size: buf.length };
}

/**
 * Walk the project to find every *.ogf-slice.json sidecar file.
 * Each represents a "pending" slicing change the user made in OGF that is
 * not yet applied to the engine config.
 */
export function listSliceMetadataFiles(rootAbs: string): { relPath: string; mtimeMs: number; size: number }[] {
  const out: { relPath: string; mtimeMs: number; size: number }[] = [];
  const seen = { count: 0 };
  const MAX_FILES = 5000;

  function walk(dirAbs: string, relDir: string) {
    if (seen.count >= MAX_FILES) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return;
    }
    for (const name of entries) {
      if (IGNORED_NAMES.has(name)) continue;
      const childAbs = path.join(dirAbs, name);
      let st;
      try {
        st = statSync(childAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(childAbs, relDir ? `${relDir}/${name}` : name);
      } else if (st.isFile()) {
        seen.count++;
        if (seen.count >= MAX_FILES) return;
        if (!name.endsWith('.ogf-slice.json')) continue;
        out.push({
          relPath: relDir ? `${relDir}/${name}` : name,
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
    }
  }

  walk(rootAbs, '');
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function listRefImages(rootAbs: string): { relPath: string; size: number; mtimeMs: number }[] {
  const refsDir = path.join(rootAbs, REF_DIR);
  if (!existsSync(refsDir)) return [];
  return readdirSync(refsDir)
    .map((name) => {
      const abs = path.join(refsDir, name);
      try {
        const st = statSync(abs);
        if (!st.isFile()) return null;
        return { relPath: `${REF_DIR}/${name}`, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { relPath: string; size: number; mtimeMs: number } => x !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}
