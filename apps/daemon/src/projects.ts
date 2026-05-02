import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';

export type EngineKind = 'godot' | 'unity' | 'web' | 'unknown';

export interface ProjectRow {
  path: string;
  name: string;
  engine: EngineKind;
  last_opened_at: number;
  created_at: number;
}

export function detectEngine(dir: string): EngineKind {
  if (existsSync(path.join(dir, 'project.godot'))) return 'godot';
  if (existsSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'))) return 'unity';
  if (existsSync(path.join(dir, 'package.json'))) return 'web';
  return 'unknown';
}

function normalizePath(p: string): string {
  return path.resolve(p);
}

export function upsertProject(absPath: string): ProjectRow {
  const db = getDb();
  const norm = normalizePath(absPath);
  const now = Date.now();
  const engine = detectEngine(norm);
  const name = path.basename(norm) || norm;

  const existing = db
    .prepare('SELECT * FROM projects WHERE path = ?')
    .get(norm) as ProjectRow | undefined;

  if (existing) {
    db.prepare('UPDATE projects SET last_opened_at = ?, engine = ? WHERE path = ?').run(
      now,
      engine,
      norm,
    );
    return { ...existing, last_opened_at: now, engine };
  }

  db.prepare(
    `INSERT INTO projects (path, name, engine, last_opened_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(norm, name, engine, now, now);

  return { path: norm, name, engine, last_opened_at: now, created_at: now };
}

export function listProjects(): ProjectRow[] {
  return getDb()
    .prepare('SELECT * FROM projects ORDER BY last_opened_at DESC')
    .all() as ProjectRow[];
}

export function getProject(absPath: string): ProjectRow | undefined {
  return getDb()
    .prepare('SELECT * FROM projects WHERE path = ?')
    .get(normalizePath(absPath)) as ProjectRow | undefined;
}

export function deleteProject(absPath: string): void {
  getDb().prepare('DELETE FROM projects WHERE path = ?').run(normalizePath(absPath));
}

export function renameProject(absPath: string, newName: string): void {
  getDb()
    .prepare('UPDATE projects SET name = ? WHERE path = ?')
    .run(newName, normalizePath(absPath));
}
