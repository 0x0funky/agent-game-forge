import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AgentId } from '@ogf/contracts';
import { getDb } from './db.js';

export interface ConversationRow {
  id: string;
  project_path: string;
  title: string | null;
  codex_thread_id: string | null;
  /** Which agent CLI created this conversation. Locked at create time so
   *  selecting an old conversation snaps the active CLI back. Backfilled
   *  to 'codex' on schema migration v3 for pre-multi-CLI rows. */
  agent_id: AgentId;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  conversation_id: string;
  role: 'user' | 'agent';
  content: string;
  events_json: string | null;
  position: number;
  created_at: number;
}

function normalize(p: string): string {
  return path.resolve(p);
}

export function createConversation(
  projectPath: string,
  agentId: AgentId,
  title?: string,
): ConversationRow {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO conversations
       (id, project_path, title, codex_thread_id, agent_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(id, normalize(projectPath), title ?? null, agentId, now, now);
  return {
    id,
    project_path: normalize(projectPath),
    title: title ?? null,
    codex_thread_id: null,
    agent_id: agentId,
    created_at: now,
    updated_at: now,
  };
}

export function listConversations(projectPath: string): ConversationRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM conversations
       WHERE project_path = ?
       ORDER BY updated_at DESC`,
    )
    .all(normalize(projectPath)) as ConversationRow[];
}

export function getConversation(id: string): ConversationRow | undefined {
  return getDb()
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(id) as ConversationRow | undefined;
}

export function setConversationThreadId(id: string, threadId: string): void {
  getDb()
    .prepare('UPDATE conversations SET codex_thread_id = ?, updated_at = ? WHERE id = ?')
    .run(threadId, Date.now(), id);
}

export function setConversationTitle(id: string, title: string): void {
  getDb()
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, Date.now(), id);
}

export function touchConversation(id: string): void {
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id);
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function listMessages(conversationId: string): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY position ASC`,
    )
    .all(conversationId) as MessageRow[];
}

export function appendMessage(
  conversationId: string,
  role: 'user' | 'agent',
  content: string,
  eventsJson?: unknown,
): MessageRow {
  const db = getDb();
  const now = Date.now();

  const lastPos = db
    .prepare(
      `SELECT MAX(position) as p FROM messages WHERE conversation_id = ?`,
    )
    .get(conversationId) as { p: number | null };
  const position = (lastPos.p ?? -1) + 1;

  const result = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, content, events_json, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conversationId,
      role,
      content,
      eventsJson ? JSON.stringify(eventsJson) : null,
      position,
      now,
    );

  touchConversation(conversationId);

  return {
    id: result.lastInsertRowid as number,
    conversation_id: conversationId,
    role,
    content,
    events_json: eventsJson ? JSON.stringify(eventsJson) : null,
    position,
    created_at: now,
  };
}
