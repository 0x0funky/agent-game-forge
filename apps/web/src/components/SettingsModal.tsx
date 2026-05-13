import { useEffect, useState } from 'react';
import type {
  AgentId,
  AgentInfo,
  GenImageSummary,
  ImageGenProviderPref,
  Preferences,
  SecretKey,
  SecretStatus,
} from '@ogf/contracts';
import {
  fetchAgents,
  fetchGenImageSummary,
  fetchPreferences,
  fetchSecrets,
  setPreferences,
  setSecret,
} from '../lib/api.js';
import { I } from './icons.js';

/** localStorage key for the user's preferred agent CLI. Read on app boot;
 *  written when the user picks a different CLI in Settings. */
export const LS_PREFERRED_AGENT = 'ogf:preferred-agent';

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
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [usage, setUsage] = useState<GenImageSummary | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [preferredAgent, setPreferredAgent] = useState<AgentId>(() => {
    const v = localStorage.getItem(LS_PREFERRED_AGENT);
    return v === 'claude-code' ? 'claude-code' : 'codex';
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchSecrets(),
      fetchAgents(),
      fetchGenImageSummary(),
      fetchPreferences(),
    ])
      .then(([secretsResp, agentsResp, usageResp, prefsResp]) => {
        if (cancelled) return;
        setStatuses(secretsResp.secrets);
        setAgents(agentsResp.agents);
        setUsage(usageResp);
        setPrefs(prefsResp);
      })
      .catch(() => {
        if (!cancelled) {
          setStatuses([]);
          setAgents([]);
          setUsage(null);
          setPrefs(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function pickAgent(id: AgentId) {
    setPreferredAgent(id);
    localStorage.setItem(LS_PREFERRED_AGENT, id);
    // Notify other components (App.tsx) so they switch immediately.
    window.dispatchEvent(new CustomEvent('ogf:preferred-agent-changed', { detail: id }));
  }

  async function savePrefs(patch: Partial<Preferences['image_gen']>) {
    if (!prefs) return;
    const next: Preferences = {
      image_gen: { ...prefs.image_gen, ...patch },
    };
    setPrefs(next); // optimistic
    setSavingPrefs(true);
    try {
      const r = await setPreferences(next);
      setPrefs(r);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('setPreferences failed', err);
      // Roll back to server's view on failure by refetching.
      void fetchPreferences()
        .then(setPrefs)
        .catch(() => {});
    } finally {
      setSavingPrefs(false);
    }
  }

  // Known model options per provider. List can lag actual API releases —
  // advanced users can edit ~/.ogf/preferences.json directly if they need
  // a model that's not in this dropdown.
  const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image · GA' },
    { id: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image · preview' },
  ];
  const OPENAI_MODELS = [
    { id: 'gpt-image-1', label: 'gpt-image-1 · GA' },
    { id: 'gpt-image-1-mini', label: 'gpt-image-1-mini · cheap & fast' },
    { id: 'gpt-image-2', label: 'gpt-image-2 · newer (if available)' },
  ];

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
          {/* Agent CLI picker */}
          <section style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>
              Agent CLI
            </h3>
            <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
              <strong>Default for NEW conversations</strong> — existing
              conversations stay on the CLI that created them, and selecting
              an old conversation snaps the active CLI back to its original
              one (to start fresh under another CLI, create a new
              conversation). Codex uses its built-in image-gen; Claude Code
              routes images through the daemon's{' '}
              <code>/api/gen-image</code> using your API keys below.
            </p>
          </section>
          <div style={{ display: 'grid', gap: 8 }}>
            {(['codex', 'claude-code'] as const).map((id) => {
              const info = agents?.find((a) => a.id === id);
              const isPreferred = preferredAgent === id;
              const available = info?.available ?? false;
              const cliName = id === 'codex' ? 'Codex CLI' : 'Claude Code';
              return (
                <label
                  key={id}
                  style={{
                    ...cardStyle,
                    cursor: available ? 'pointer' : 'not-allowed',
                    opacity: available ? 1 : 0.55,
                    borderColor: isPreferred ? 'var(--accent)' : 'var(--line)',
                    background: isPreferred ? 'var(--accent-soft)' : 'var(--bg-1)',
                    gap: 4,
                  }}
                  onClick={() => {
                    if (available) pickAgent(id);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="radio"
                      name="agent-cli"
                      checked={isPreferred}
                      onChange={() => available && pickAgent(id)}
                      disabled={!available}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>
                      {cliName}
                    </span>
                    {info?.version && (
                      <span
                        className="muted"
                        style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}
                      >
                        {info.version}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        ...badgeBase,
                        background: available
                          ? 'rgba(110, 231, 142, 0.18)'
                          : 'var(--bg-2)',
                        color: available ? 'var(--green, #6ee78e)' : 'var(--ink-3)',
                      }}
                    >
                      {available ? 'installed' : 'not found'}
                    </span>
                  </div>
                  {!available && (
                    <p
                      className="muted"
                      style={{ margin: 0, marginLeft: 26, fontSize: 11, lineHeight: 1.4 }}
                    >
                      Install with <code>npm i -g {id === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code'}</code>{' '}
                      and reload OGF.
                    </p>
                  )}
                </label>
              );
            })}
          </div>

          <section style={{ display: 'grid', gap: 6, marginTop: 6 }}>
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

          {/* Image-gen defaults (provider + model). When the agent calls
             /api/gen-image without an explicit provider/model, the daemon
             uses these. Per-call overrides via the script still work. */}
          {prefs && (
            <section
              style={{
                display: 'grid',
                gap: 10,
                borderTop: '1px solid var(--line)',
                paddingTop: 14,
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--ink-0)',
                  }}
                >
                  Image-gen defaults
                </h3>
                <p
                  className="muted"
                  style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5 }}
                >
                  Which provider and model the daemon uses when the agent
                  doesn't pin them per-call.
                </p>
              </div>

              {/* Provider radio */}
              <div style={cardStyle}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink-0)',
                  }}
                >
                  Provider
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {(['auto', 'gemini', 'openai'] as const).map((p) => {
                    const checked = prefs.image_gen.provider === p;
                    const label =
                      p === 'auto'
                        ? 'Auto'
                        : p === 'gemini'
                          ? 'Gemini'
                          : 'OpenAI';
                    const hint =
                      p === 'auto'
                        ? 'pick whichever has a key (Gemini first)'
                        : p === 'gemini'
                          ? 'native multimodal, cheaper'
                          : 'wider model selection';
                    return (
                      <label
                        key={p}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          cursor: savingPrefs ? 'wait' : 'pointer',
                          color: checked ? 'var(--accent)' : 'var(--ink-1)',
                        }}
                      >
                        <input
                          type="radio"
                          name="image-gen-provider"
                          checked={checked}
                          disabled={savingPrefs}
                          onChange={() => void savePrefs({ provider: p })}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>
                        <span
                          className="muted"
                          style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                        >
                          {hint}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Per-provider model dropdown */}
              <div style={cardStyle}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink-0)',
                  }}
                >
                  Default model
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        minWidth: 70,
                        fontSize: 12,
                        color: 'var(--ink-1)',
                      }}
                    >
                      Gemini
                    </span>
                    <select
                      value={prefs.image_gen.geminiModel}
                      disabled={savingPrefs}
                      onChange={(e) => void savePrefs({ geminiModel: e.target.value })}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                    >
                      {GEMINI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      {!GEMINI_MODELS.find((m) => m.id === prefs.image_gen.geminiModel) && (
                        <option value={prefs.image_gen.geminiModel}>
                          {prefs.image_gen.geminiModel} · (custom)
                        </option>
                      )}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                      style={{
                        minWidth: 70,
                        fontSize: 12,
                        color: 'var(--ink-1)',
                      }}
                    >
                      OpenAI
                    </span>
                    <select
                      value={prefs.image_gen.openaiModel}
                      disabled={savingPrefs}
                      onChange={(e) => void savePrefs({ openaiModel: e.target.value })}
                      style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                    >
                      {OPENAI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                      {!OPENAI_MODELS.find((m) => m.id === prefs.image_gen.openaiModel) && (
                        <option value={prefs.image_gen.openaiModel}>
                          {prefs.image_gen.openaiModel} · (custom)
                        </option>
                      )}
                    </select>
                  </div>
                </div>
                <p
                  className="muted"
                  style={{ margin: 0, fontSize: 10, lineHeight: 1.5 }}
                >
                  Need a model not listed? Edit{' '}
                  <code>~/.ogf/preferences.json</code> directly.
                </p>
              </div>
            </section>
          )}

          {/* Usage / cost (last 24 h) */}
          {usage && usage.totalCount > 0 && (
            <section
              style={{
                display: 'grid',
                gap: 8,
                borderTop: '1px solid var(--line)',
                paddingTop: 14,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--ink-0)',
                }}
              >
                Image-gen usage · last 24h
              </h3>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ink-1)',
                  display: 'grid',
                  gap: 4,
                }}
              >
                {usage.byProvider.map((row) => (
                  <div
                    key={row.provider}
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <span style={{ minWidth: 60, color: 'var(--ink-0)' }}>
                      {row.provider}
                    </span>
                    <span style={{ minWidth: 60 }}>{row.count} calls</span>
                    {row.errorCount > 0 && (
                      <span style={{ color: 'var(--red, #ff6e6e)' }}>
                        ({row.errorCount} fail)
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ color: 'var(--ink-0)' }}>
                      ~${row.estCostUsd.toFixed(3)}
                    </span>
                  </div>
                ))}
                <div
                  style={{
                    display: 'flex',
                    paddingTop: 4,
                    marginTop: 4,
                    borderTop: '1px dashed var(--line)',
                    color: 'var(--ink-0)',
                    fontWeight: 600,
                  }}
                >
                  <span>total</span>
                  <span style={{ flex: 1 }} />
                  <span>~${usage.totalEstCostUsd.toFixed(3)}</span>
                </div>
              </div>
              <p
                className="muted"
                style={{ margin: 0, fontSize: 10, lineHeight: 1.5 }}
              >
                Cost is HEURISTIC (per-image list price × call count). Check
                provider dashboard for actual billing.
              </p>
            </section>
          )}

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
