import { useEffect, useState } from 'react';
import type { SecretKey, SecretStatus } from '@ogf/contracts';
import { fetchSecrets, setSecret } from '../lib/api.js';
import { I } from './icons.js';

interface SecretRowSpec {
  key: SecretKey;
  label: string;
  hint: string;
  placeholder: string;
}

const ROWS: SecretRowSpec[] = [
  {
    key: 'openai_api_key',
    label: 'OpenAI',
    hint: 'gpt-image-1 / gpt-image-2',
    placeholder: 'sk-…',
  },
  {
    key: 'gemini_api_key',
    label: 'Google Gemini',
    hint: 'Gemini 2.5 Flash Image (Nano Banana)',
    placeholder: 'AIza…',
  },
  {
    key: 'anthropic_api_key',
    label: 'Anthropic',
    hint: 'Reserved for the future Claude Code agent (no image-gen API).',
    placeholder: 'sk-ant-…',
  },
];

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 32,
  padding: '0 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--ink-0)',
  background: 'var(--bg-0)',
  border: '1px solid var(--line-strong)',
  borderRadius: 6,
  outline: 'none',
};

const inputDisabledStyle: React.CSSProperties = {
  ...inputStyle,
  color: 'var(--ink-3)',
  background: 'var(--bg-2)',
  cursor: 'not-allowed',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--bg-1)',
  padding: '12px 14px',
  display: 'grid',
  gap: 10,
};

const badgeBase: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.3,
  padding: '2px 7px',
  borderRadius: 999,
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase' as const,
};

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [statuses, setStatuses] = useState<SecretStatus[] | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SecretKey, string>>>({});
  const [revealing, setRevealing] = useState<Partial<Record<SecretKey, boolean>>>({});
  const [saving, setSaving] = useState<Partial<Record<SecretKey, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    void fetchSecrets()
      .then((r) => {
        if (!cancelled) setStatuses(r.secrets);
      })
      .catch(() => {
        if (!cancelled) setStatuses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: SecretKey, value: string | null) {
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const r = await setSecret(key, value);
      setStatuses(r.secrets);
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('setSecret failed', err);
      alert('Failed to save — see console.');
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal"
        style={{ height: 'auto', width: 'min(640px, 100%)', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="title">Settings</span>
          <button className="close" onClick={onClose}>
            {I.close}
          </button>
        </div>
        <div style={{ padding: 20, display: 'grid', gap: 20, overflowY: 'auto' }}>
          <section style={{ display: 'grid', gap: 6 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--ink-0)',
              }}
            >
              Image generation API keys
            </h3>
            <p
              className="muted"
              style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}
            >
              For agents without built-in image gen. Codex CLI users keep using
              Codex's <code>image_gen</code>.
            </p>
          </section>

          <div style={{ display: 'grid', gap: 12 }}>
            {ROWS.map((row) => {
              const status = statuses?.find((s) => s.key === row.key);
              const draft = drafts[row.key];
              const isEditing = draft !== undefined;
              const isSaving = saving[row.key];
              const reveal = revealing[row.key];
              const fieldDisabled = !!status?.fromEnv || isSaving;
              return (
                <div key={row.key} style={cardStyle}>
                  {/* Header: label + status badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--ink-0)',
                      }}
                    >
                      {row.label}
                    </span>
                    <span
                      className="muted"
                      style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                    >
                      {row.hint}
                    </span>
                    <span style={{ flex: 1 }} />
                    {status?.fromEnv ? (
                      <span
                        style={{
                          ...badgeBase,
                          background: 'var(--accent-soft)',
                          color: 'var(--accent)',
                        }}
                        title={`Shadowed by env var ${status.envVarName} — unset that to use this UI`}
                      >
                        env
                      </span>
                    ) : status?.set ? (
                      <span
                        style={{
                          ...badgeBase,
                          background: 'rgba(110, 231, 142, 0.18)',
                          color: 'var(--green, #6ee78e)',
                        }}
                      >
                        saved
                      </span>
                    ) : (
                      <span
                        style={{
                          ...badgeBase,
                          background: 'var(--bg-2)',
                          color: 'var(--ink-3)',
                        }}
                      >
                        not set
                      </span>
                    )}
                  </div>

                  {/* Input + buttons */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type={reveal ? 'text' : 'password'}
                      placeholder={
                        status?.fromEnv
                          ? `(from ${status.envVarName})`
                          : status?.set
                            ? status.masked
                            : row.placeholder
                      }
                      value={draft ?? ''}
                      disabled={fieldDisabled}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draft && !isSaving) {
                          void save(row.key, draft);
                        }
                      }}
                      style={fieldDisabled ? inputDisabledStyle : inputStyle}
                    />
                    {isEditing && draft!.length > 0 && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() =>
                          setRevealing((r) => ({ ...r, [row.key]: !reveal }))
                        }
                        title={reveal ? 'Hide' : 'Show'}
                        disabled={isSaving}
                      >
                        {reveal ? 'hide' : 'show'}
                      </button>
                    )}
                    {isEditing ? (
                      <>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => void save(row.key, draft ?? '')}
                          disabled={isSaving || !draft}
                        >
                          {isSaving ? 'saving…' : 'save'}
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() =>
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[row.key];
                              return next;
                            })
                          }
                          disabled={isSaving}
                        >
                          cancel
                        </button>
                      </>
                    ) : (
                      status?.set &&
                      !status.fromEnv && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => void save(row.key, null)}
                          disabled={isSaving}
                          title="Remove this key"
                        >
                          clear
                        </button>
                      )
                    )}
                  </div>

                  {/* Env hint when shadowed */}
                  {status?.fromEnv && (
                    <p
                      className="muted"
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: 1.4,
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      Override via <code>{status.envVarName}</code>. Unset that env var to
                      use a value saved here.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <p
            className="muted"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.6,
              borderTop: '1px solid var(--line)',
              paddingTop: 14,
            }}
          >
            Stored at <code>~/.ogf/secrets.json</code> (mode 600). Env vars
            (<code>OPENAI_API_KEY</code>, <code>GEMINI_API_KEY</code>,{' '}
            <code>ANTHROPIC_API_KEY</code>) override the file at runtime.
          </p>
        </div>
      </div>
    </div>
  );
}
