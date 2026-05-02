import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

let db: Database.Database | null = null;

export interface DbOptions {
  /** Absolute path where the SQLite file should live. */
  filePath: string;
}

export function openDb(opts: DbOptions): Database.Database {
  if (db) return db;

  mkdirSync(path.dirname(opts.filePath), { recursive: true });
  const handle = new Database(opts.filePath);
  handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');

  migrate(handle);
  db = handle;
  return handle;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('db not opened');
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = d.prepare('SELECT MAX(version) as v FROM schema_version').get() as
    | { v: number | null }
    | undefined;
  const current = row?.v ?? 0;

  if (current < 1) {
    d.exec(`
      CREATE TABLE projects (
        path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        engine TEXT NOT NULL,
        last_opened_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        title TEXT,
        codex_thread_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_path) REFERENCES projects(path) ON DELETE CASCADE
      );
      CREATE INDEX idx_conversations_project ON conversations(project_path, updated_at DESC);

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        events_json TEXT,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_messages_conversation ON messages(conversation_id, position);

      INSERT INTO schema_version (version) VALUES (1);
    `);
  }
}
