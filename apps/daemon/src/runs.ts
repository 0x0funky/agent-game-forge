import type { ChildProcess } from 'node:child_process';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AgentEvent, RunStatus } from '@ogf/contracts';

export interface RunEventRecord {
  id: number;
  event: 'start' | 'agent' | 'stdout' | 'stderr' | 'error' | 'end';
  data: unknown;
}

export interface Run {
  id: string;
  status: RunStatus;
  events: RunEventRecord[];
  clients: Set<Response>;
  child?: ChildProcess;
  createdAt: number;
  meta: {
    agentId: string;
    bin: string;
    cwd: string;
    model?: string;
    reasoning?: string;
  };
}

const MAX_EVENTS = 2000;

export class RunManager {
  private runs = new Map<string, Run>();

  create(meta: Run['meta']): Run {
    const run: Run = {
      id: randomUUID(),
      status: 'queued',
      events: [],
      clients: new Set(),
      createdAt: Date.now(),
      meta,
    };
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  emit(run: Run, event: RunEventRecord['event'], data: unknown) {
    const rec: RunEventRecord = { id: run.events.length, event, data };
    run.events.push(rec);
    if (run.events.length > MAX_EVENTS) run.events.shift();

    for (const client of run.clients) {
      writeSse(client, rec);
    }
  }

  emitAgent(run: Run, ev: AgentEvent) {
    this.emit(run, 'agent', ev);
  }

  attach(run: Run, res: Response, after?: number) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (const rec of run.events) {
      if (after !== undefined && rec.id <= after) continue;
      writeSse(res, rec);
    }

    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      res.end();
      return;
    }

    run.clients.add(res);
    res.on('close', () => {
      run.clients.delete(res);
    });
  }

  finish(run: Run, status: RunStatus, code: number | null, signal: NodeJS.Signals | null) {
    run.status = status;
    this.emit(run, 'end', { code, signal, status });
    for (const client of run.clients) client.end();
    run.clients.clear();
    run.child = undefined;
  }
}

function writeSse(res: Response, rec: RunEventRecord) {
  res.write(`id: ${rec.id}\n`);
  res.write(`event: ${rec.event}\n`);
  res.write(`data: ${JSON.stringify(rec.data)}\n\n`);
}
