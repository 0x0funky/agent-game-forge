import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { UsagesResponse } from '@ogf/contracts';
import {
  applyRegen,
  discardRegen,
  fetchFileContent,
  fetchRegenStaging,
  fetchUsages,
  writeFileContent,
} from '../lib/api.js';
import { I } from './icons.js';
import { SpriteSlicerModal, type SliceMetadata } from './SpriteSlicerModal.js';
import { TableEditor } from './TableEditor.js';

interface Props {
  projectPath: string;
  relPath: string;
  /** Engine kind from the daemon's analysis. Drives engine-specific Codex
   *  prompts (e.g. 'apply slicing' wording differs for godot vs web). */
  engine?: string;
  fileKind?: 'text' | 'image' | 'binary';
  recentlyChanged?: boolean;
  onClose?: () => void;
  /** Click on a usage hit → open that file at that line. */
  onJumpTo?: (relPath: string, line: number) => void;
  /** Ask Codex via the agent pane. */
  onAskCodex?: (prompt: string) => void;
  /** Notify parent that slicing metadata changed (so it can refresh "pending" panel). */
  onSlicingSaved?: () => void;
  /** Counter that bumps when sidecar metadata changes elsewhere — triggers re-fetch. */
  metadataRev?: number;
}

interface PipelineMeta {
  cols?: number;
  rows?: number;
  cell_size?: number;
  fit_scale?: number;
  align?: string;
  duration?: number;
  trim_border?: number;
  prompt?: string;
  target?: string;
  mode?: string;
  frame_labels?: string[];
}

export function FileEditor(props: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [size, setSize] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [kind, setKind] = useState<'text' | 'image' | 'binary'>('text');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLoadedRef = useRef<string>('');

  // Image-specific
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [slice, setSlice] = useState<SliceMetadata | null>(null);
  const [pipelineMeta, setPipelineMeta] = useState<PipelineMeta | null>(null);
  const [sliceSource, setSliceSource] = useState<'ogf-slice' | 'pipeline-meta' | 'none'>('none');
  const [showSlicer, setShowSlicer] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [usages, setUsages] = useState<UsagesResponse['hits'] | null>(null);
  const [usagesLoading, setUsagesLoading] = useState(false);
  const [jsonView, setJsonView] = useState<'auto' | 'text' | 'table'>('auto');

  // Regen staging — populated when .ogf/regen/<relPath> exists. The
  // 'Regenerate' button instructs Codex to write there instead of
  // overwriting; this state drives the side-by-side comparison panel.
  const [regenBase64, setRegenBase64] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<'apply' | 'discard' | null>(null);
  const [regenNaturalW, setRegenNaturalW] = useState(0);
  const [regenNaturalH, setRegenNaturalH] = useState(0);

  const segments = props.relPath.split('/').filter(Boolean);
  const dir = segments.slice(0, -1).join('/');

  // Is this file a JSON that's likely table-shaped (array-of-objects somewhere)?
  const jsonHasTable = useMemo(() => {
    if (!props.relPath.toLowerCase().endsWith('.json') || content === null) return false;
    try {
      const data = JSON.parse(content);
      if (Array.isArray(data) && data.length > 0 && data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        return true;
      }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return Object.values(data as Record<string, unknown>).some(
          (v) => Array.isArray(v) && v.length > 0 && (v as unknown[]).every((x) => x && typeof x === 'object' && !Array.isArray(x)),
        );
      }
    } catch {
      // ignore
    }
    return false;
  }, [content, props.relPath]);

  const showAsTable = jsonHasTable && (jsonView === 'auto' || jsonView === 'table');

  // Initial file fetch
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDirty(false);
    setContent(null);
    setBase64(null);
    setNaturalW(0);
    setNaturalH(0);
    setSlice(null);
    setPipelineMeta(null);
    setSliceSource('none');
    setUsages(null);
    setRegenBase64(null);
    setRegenBusy(null);
    setRegenNaturalW(0);
    setRegenNaturalH(0);

    fetchFileContent(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        setKind(r.kind);
        setSize(r.size);
        setTruncated(!!r.truncated);
        if (r.kind === 'text') {
          const c = r.content ?? '';
          setContent(c);
          lastLoadedRef.current = c;
        } else if (r.kind === 'image') {
          setBase64(r.base64 ?? '');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relPath]);

  // For images: load slicing metadata + sibling pipeline-meta.json + usages.
  // Re-runs when metadataRev bumps (revert / discard / save).
  useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;

    // Reset so a stale sidecar value doesn't linger after revert.
    setSlice(null);
    setPipelineMeta(null);
    setSliceSource('none');

    // 1. Try .ogf-slice.json sidecar (our format)
    const sidecar = props.relPath.replace(/\.(png|jpg|jpeg|gif|webp|bmp)$/i, '.ogf-slice.json');
    let sidecarFound = false;
    fetchFileContent(props.projectPath, sidecar)
      .then((r) => {
        if (cancelled) return;
        if (r.kind === 'text' && r.content) {
          try {
            const parsed = JSON.parse(r.content) as SliceMetadata;
            setSlice(parsed);
            setSliceSource('ogf-slice');
            sidecarFound = true;
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});

    // 2. Try pipeline-meta.json sibling (sprite_maker convention)
    const pipelinePath = dir ? `${dir}/pipeline-meta.json` : 'pipeline-meta.json';
    fetchFileContent(props.projectPath, pipelinePath)
      .then((r) => {
        if (cancelled) return;
        if (r.kind === 'text' && r.content) {
          try {
            const parsed = JSON.parse(r.content) as PipelineMeta;
            setPipelineMeta(parsed);
            // Fall back to pipeline meta only if no sidecar was found.
            if (!sidecarFound &&
                typeof parsed.cols === 'number' &&
                typeof parsed.rows === 'number') {
              setSlice({
                cols: parsed.cols,
                rows: parsed.rows,
                padding: 0,
                offsetX: 0,
                offsetY: 0,
                anchor: (parsed.align as SliceMetadata['anchor']) || 'center',
                fps: parsed.duration ? Math.round(1000 / parsed.duration) : 8,
                source: props.relPath,
              });
              setSliceSource('pipeline-meta');
            }
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});

    // 3. Fetch usages
    setUsagesLoading(true);
    fetchUsages(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        setUsages(r.hits);
      })
      .catch(() => setUsages([]))
      .finally(() => {
        if (!cancelled) setUsagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, props.projectPath, props.relPath, dir, props.metadataRev]);

  // Probe for a staged regenerate at .ogf/regen/<relPath>. The
  // 'Regenerate' button writes there (instead of overwriting); when the
  // staging file exists we surface a side-by-side comparison panel.
  // Refetched on every relPath change AND every metadataRev bump
  // (which the parent advances after the agent finishes a turn — so a
  // fresh regen completed during a chat run shows up immediately).
  useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;
    fetchRegenStaging(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        if (r.exists && r.base64) setRegenBase64(r.base64);
        else setRegenBase64(null);
      })
      .catch(() => {
        if (!cancelled) setRegenBase64(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, props.projectPath, props.relPath, props.metadataRev]);

  async function applyRegenChange() {
    setRegenBusy('apply');
    try {
      await applyRegen(props.projectPath, props.relPath);
      setRegenBase64(null);
      // Bump our base64 by re-fetching the file so the inspector reloads
      // the now-applied bytes (the file content endpoint returns cached
      // bytes only on URL change; we trigger a fresh load via state reset).
      setBase64(null);
      const r = await fetchFileContent(props.projectPath, props.relPath);
      if (r.kind === 'image') setBase64(r.base64 ?? '');
      props.onSlicingSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenBusy(null);
    }
  }

  async function discardRegenChange() {
    setRegenBusy('discard');
    try {
      await discardRegen(props.projectPath, props.relPath);
      setRegenBase64(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenBusy(null);
    }
  }

  async function save() {
    if (kind !== 'text' || content === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await writeFileContent({
        projectPath: props.projectPath,
        relPath: props.relPath,
        content,
      });
      lastLoadedRef.current = content;
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && kind === 'text') {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, saving, kind]);

  function askCodexToApplySlicing(m: SliceMetadata) {
    if (!props.onAskCodex) return;
    const usagesText =
      usages && usages.length > 0
        ? '\n\nThis sheet is referenced in:\n' +
          usages.map((u) => `- ${u.file}:${u.line}  ${u.snippet}`).join('\n')
        : '';
    // Engine-aware update instruction. Each engine stores frame metadata
    // differently and lives in different files — the wrong wording sends
    // Codex looking for keys that don't exist (e.g. searching for
    // 'frame_cols' in a vanilla JS web project).
    const updateInstruction =
      props.engine === 'godot'
        ? 'Please update the relevant Godot config so the game uses these values. Look for `frame_cols`, `frame_rows`, and `animation_fps` keys (or equivalent) in the .tscn / .tres / .gd files wherever this sheet is loaded, and update them.'
        : props.engine === 'web'
          ? "Please update the web project so the game uses these values. The sheet is sliced in JS — look at the references below (typically a Sprite/Animation entry in `data/*.json` or a constant in `src/*.js`) and update fields like `cols` / `rows` / `fps` / `frameWidth` / `frameHeight` / `anchor` / `offset` (whatever names the project actually uses; preserve them — don't rename)."
          : 'Please update the project so the game uses these values. Look at the references below to find where this sheet is loaded and update the slicing metadata (cols / rows / fps / anchor / offset).';
    const prompt = `The sprite sheet \`${props.relPath}\` should be sliced as **${m.cols}×${m.rows}** at ${m.fps} fps (anchor: ${m.anchor}, padding ${m.padding}, offset (${m.offsetX}, ${m.offsetY})).

${updateInstruction}${usagesText}

Show me the diff before applying.`;
    props.onAskCodex(prompt);
  }

  function askCodexToRegenerate() {
    if (!props.onAskCodex) return;
    const usagesText =
      usages && usages.length > 0
        ? '\n\nThis sprite is referenced in:\n' +
          usages.map((u) => `- ${u.file}:${u.line}  ${u.snippet}`).join('\n')
        : '';
    const sliceText = slice
      ? `\n- Match the existing slicing layout: **${slice.cols}×${slice.rows}** frames @ ${slice.fps} fps, anchor ${slice.anchor}.`
      : '';
    const dimsText =
      naturalW > 0 && naturalH > 0
        ? `\n- Output dimensions should match: ${naturalW}×${naturalH} px.`
        : '';
    const regenPath = `.ogf/regen/${props.relPath.replace(/\\/g, '/')}`;
    const prompt = `Regenerate the sprite asset \`${props.relPath}\` using the \`generate2dsprite\` skill, writing the result to a STAGING path so the user can compare it against the original before applying.

Hard constraints:
- USE the \`generate2dsprite\` skill (NOT raw image_gen — this is a hard rule, see project conventions).
- INCLUDE the Style directive from \`.ogf/spec.md\` §1 verbatim in the prompt argument.
- DO NOT overwrite the original at \`${props.relPath}\`. The user will review and apply the swap themselves.
- Write the new sprite to \`${regenPath}\` (create the directory if needed). OGF will detect this side-by-side file and show a comparison UI in the editor.${sliceText}${dimsText}${usagesText}

What should change about this sprite? (edit the line below before sending — leave it blank to just regenerate a fresh take with the same intent)
>

When done, just confirm the file was written to \`${regenPath}\` — DON'T edit any other file. The user controls when (or if) the swap happens.`;
    props.onAskCodex(prompt);
  }

  const isImage = kind === 'image' && base64;
  const ext = props.relPath.split('.').pop()?.toLowerCase() ?? '';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const imageUrl = isImage ? `data:${mime};base64,${base64}` : null;

  return (
    <div className="inspector">
      <div className="crumbs">
        {segments.slice(0, -1).map((s, i) => (
          <span key={i}>
            <span>{s}</span>
            <span className="sep">/</span>
          </span>
        ))}
        <span className="last">{segments[segments.length - 1] ?? props.relPath}</span>
        <span className="badge-dim">
          {isImage && naturalW > 0 ? `${naturalW}×${naturalH}` : formatSize(size)} · {kind}
        </span>
        {dirty && (
          <span className="badge-dim" style={{ color: 'var(--accent)', borderColor: 'var(--accent-line)' }}>
            ● unsaved
          </span>
        )}
        <span className="actions">
          {kind === 'text' && jsonHasTable && (
            <span className="view-toggle" style={{ marginRight: 6 }}>
              <button
                className={`view-toggle-btn ${showAsTable ? 'active' : ''}`}
                onClick={() => setJsonView('table')}
                title="Edit as a table"
              >
                table
              </button>
              <button
                className={`view-toggle-btn ${!showAsTable ? 'active' : ''}`}
                onClick={() => setJsonView('text')}
                title="Edit as raw JSON"
              >
                text
              </button>
            </span>
          )}
          {kind === 'text' && (
            <button
              className={`btn btn-sm ${dirty ? 'btn-primary' : ''}`}
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {isImage && props.onAskCodex && (
            <button
              className="btn btn-sm"
              onClick={askCodexToRegenerate}
              title="Ask Codex to regenerate this sprite via generate2dsprite"
            >
              {I.refresh} Regenerate
            </button>
          )}
          {isImage && (
            <button className="btn btn-sm" onClick={() => setShowSlicer(true)}>
              {I.scissors} {slice ? 'Edit slicing' : 'Define slicing'}
            </button>
          )}
          {props.onClose && (
            <button className="btn btn-sm btn-ghost" onClick={props.onClose} title="Close">
              {I.close}
            </button>
          )}
        </span>
      </div>

      {props.recentlyChanged && (
        <div className="diff-banner" style={{ position: 'static', margin: '12px 14px 0' }}>
          <span className="dot" />
          <span className="text">
            <b>Codex</b> regenerated this file <span className="when">just now</span>
          </span>
          <span className="actions">
            <button>View diff</button>
            <button className="primary">Keep</button>
          </span>
        </div>
      )}

      {error && <div className="msg-sys err" style={{ margin: 12, alignSelf: 'flex-start' }}>{I.warn} {error}</div>}
      {truncated && <div className="msg-sys" style={{ margin: 12, alignSelf: 'flex-start' }}>{I.warn} File too large ({formatSize(size)})</div>}

      {kind === 'text' && content !== null && showAsTable && (
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TableEditor
            content={content}
            projectPath={props.projectPath}
            relPath={props.relPath}
            onContentChange={(next) => {
              setContent(next);
              setDirty(next !== lastLoadedRef.current);
            }}
          />
        </div>
      )}

      {kind === 'text' && content !== null && !showAsTable && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            theme="vs-dark"
            language={languageOf(props.relPath)}
            value={content}
            onChange={(v) => {
              const next = v ?? '';
              setContent(next);
              setDirty(next !== lastLoadedRef.current);
            }}
            options={{
              fontSize: 12.5,
              fontFamily: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              tabSize: 2,
              renderWhitespace: 'selection',
              automaticLayout: true,
            }}
          />
        </div>
      )}

      {isImage && imageUrl && regenBase64 && (
        <div className="regen-actionbar">
          <span className="regen-banner-icon">{I.refresh}</span>
          <span>Pending regenerate — review before applying</span>
          <span className="regen-banner-spacer" />
          <button
            className="btn btn-sm btn-primary"
            onClick={() => void applyRegenChange()}
            disabled={regenBusy !== null}
            title="Replace the original with the new image"
          >
            {regenBusy === 'apply' ? 'Applying…' : 'Use new'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => void discardRegenChange()}
            disabled={regenBusy !== null}
            title="Throw away the regenerated image, keep the original"
          >
            {regenBusy === 'discard' ? 'Discarding…' : 'Keep original'}
          </button>
        </div>
      )}

      {isImage && imageUrl && (
        <div className="inspector-body" style={{ flex: 1, minHeight: 0 }}>
          <div className="canvas-area" style={{ position: 'relative' }}>
            {regenBase64 ? (
              <div className="regen-compare">
                <figure className="regen-side">
                  <figcaption>Original</figcaption>
                  <img
                    src={imageUrl}
                    alt="original"
                    onLoad={(e) => {
                      setNaturalW(e.currentTarget.naturalWidth);
                      setNaturalH(e.currentTarget.naturalHeight);
                    }}
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {slice && naturalW > 0 && (
                    <div className="regen-anim">
                      <SpritePreview
                        imageUrl={imageUrl}
                        natW={naturalW}
                        natH={naturalH}
                        slice={slice}
                      />
                    </div>
                  )}
                </figure>
                <figure className="regen-side regen-side-new">
                  <figcaption>New</figcaption>
                  <img
                    src={`data:${mime};base64,${regenBase64}`}
                    alt="regenerated"
                    onLoad={(e) => {
                      setRegenNaturalW(e.currentTarget.naturalWidth);
                      setRegenNaturalH(e.currentTarget.naturalHeight);
                    }}
                    style={{ imageRendering: 'pixelated' }}
                  />
                  {slice && regenNaturalW > 0 && (
                    <div className="regen-anim">
                      <SpritePreview
                        imageUrl={`data:${mime};base64,${regenBase64}`}
                        natW={regenNaturalW}
                        natH={regenNaturalH}
                        slice={slice}
                      />
                    </div>
                  )}
                </figure>
              </div>
            ) : (
              <img
                src={imageUrl}
                alt={props.relPath}
                onLoad={(e) => {
                  setNaturalW(e.currentTarget.naturalWidth);
                  setNaturalH(e.currentTarget.naturalHeight);
                }}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  imageRendering: 'pixelated',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
              />
            )}

            {!regenBase64 && (
              <div className="canvas-toolbar">
                <button className="ico" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title="Zoom out">{I.zoomOut}</button>
                <span className="zoom-val">{Math.round(zoom * 100)}%</span>
                <button className="ico" onClick={() => setZoom((z) => Math.min(6, z + 0.25))} title="Zoom in">{I.zoomIn}</button>
              </div>
            )}
          </div>

          <div className="meta-rail">
            <div className="meta-section">
              <h4>File <span className="pill">{ext.toUpperCase()}</span></h4>
              <dl className="kv">
                <dt>Path</dt><dd style={{ wordBreak: 'break-all' }}>{props.relPath}</dd>
                <dt>Size</dt><dd>{naturalW} × {naturalH}</dd>
                <dt>Bytes</dt><dd>{formatSize(size)}</dd>
              </dl>
            </div>

            <div className="meta-section">
              <h4>
                Slicing
                {slice && (
                  <span className="pill" title={`source: ${sliceSource}`}>
                    {sliceSource === 'pipeline-meta' ? 'pipeline-meta' : sliceSource === 'ogf-slice' ? 'ogf-slice' : 'inferred'}
                  </span>
                )}
              </h4>
              {slice ? (
                <dl className="kv">
                  <dt>Grid</dt><dd>{slice.cols} × {slice.rows}</dd>
                  <dt>Frame</dt><dd>{slice.frameW ?? Math.round(naturalW / slice.cols)} × {slice.frameH ?? Math.round(naturalH / slice.rows)}</dd>
                  <dt>FPS</dt><dd>{slice.fps}</dd>
                  <dt>Anchor</dt><dd>{slice.anchor}</dd>
                  {(slice.padding > 0 || slice.offsetX !== 0 || slice.offsetY !== 0) && (
                    <>
                      <dt>Padding</dt><dd>{slice.padding}px</dd>
                      <dt>Offset</dt><dd>{slice.offsetX}, {slice.offsetY}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  No slicing metadata detected.
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  className="btn btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => setShowSlicer(true)}
                >
                  {I.scissors} {slice ? 'Edit' : 'Define'}
                </button>
                {slice && props.onAskCodex && (
                  <button
                    className="btn btn-sm btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => askCodexToApplySlicing(slice)}
                    title="Have Codex update the engine config to match this slicing"
                  >
                    {I.spark} Apply via Codex
                  </button>
                )}
              </div>
            </div>

            {pipelineMeta && (
              <div className="meta-section">
                <h4>Pipeline metadata <span className="pill">sprite_maker</span></h4>
                <dl className="kv">
                  {pipelineMeta.target && <><dt>Target</dt><dd>{pipelineMeta.target}</dd></>}
                  {pipelineMeta.mode && <><dt>Mode</dt><dd>{pipelineMeta.mode}</dd></>}
                  {pipelineMeta.cell_size != null && <><dt>Cell</dt><dd>{pipelineMeta.cell_size}px</dd></>}
                  {pipelineMeta.fit_scale != null && <><dt>Fit scale</dt><dd>{pipelineMeta.fit_scale}</dd></>}
                  {pipelineMeta.duration != null && <><dt>Frame ms</dt><dd>{pipelineMeta.duration}</dd></>}
                  {pipelineMeta.trim_border != null && <><dt>Trim</dt><dd>{pipelineMeta.trim_border}px</dd></>}
                </dl>
                {pipelineMeta.prompt && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-2)', fontStyle: 'italic', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    “{pipelineMeta.prompt}”
                  </div>
                )}
              </div>
            )}

            {slice && imageUrl && naturalW > 0 && (
              <div className="meta-section">
                <h4>Animation preview</h4>
                <SpritePreview
                  imageUrl={imageUrl}
                  natW={naturalW}
                  natH={naturalH}
                  slice={slice}
                />
              </div>
            )}

            <div className="meta-section">
              <h4>
                Used by {usages && <span className="pill">{usages.length}</span>}
              </h4>
              {usagesLoading && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Scanning…</div>}
              {!usagesLoading && usages && usages.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  Not referenced anywhere in the project.
                </div>
              )}
              {!usagesLoading && usages && usages.length > 0 && (
                <div className="usages-list">
                  {usages.map((u, i) => (
                    <div
                      key={i}
                      className="usage-row"
                      onClick={() => props.onJumpTo?.(u.file, u.line)}
                      title={`Jump to ${u.file}:${u.line}`}
                    >
                      <div className="usage-path">
                        <span style={{ color: 'var(--ink-1)' }}>{u.file}</span>
                        <span style={{ color: 'var(--ink-3)' }}>:{u.line}</span>
                      </div>
                      <code className="usage-snippet">{u.snippet}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {kind === 'binary' && (
        <div className="canvas-area" style={{ flex: 1 }}>
          <div className="muted mono">Binary file · {formatSize(size)} · no preview</div>
        </div>
      )}

      {showSlicer && isImage && (
        <SpriteSlicerModal
          projectPath={props.projectPath}
          imageRelPath={props.relPath}
          initial={slice ?? undefined}
          onClose={() => setShowSlicer(false)}
          onSaved={(m) => {
            setSlice(m);
            setSliceSource('ogf-slice');
            props.onSlicingSaved?.();
          }}
          onAskCodex={props.onAskCodex ? askCodexToApplySlicing : undefined}
        />
      )}
    </div>
  );
}

function SpritePreview({
  imageUrl,
  natW,
  natH,
  slice,
}: {
  imageUrl: string;
  natW: number;
  natH: number;
  slice: SliceMetadata;
}) {
  const total = slice.cols * slice.rows;
  const fW = natW / slice.cols;
  const fH = natH / slice.rows;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (total === 0) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % total), 1000 / slice.fps);
    return () => clearInterval(id);
  }, [slice.fps, total]);

  const previewSize = 96;
  const previewScale = previewSize / Math.max(fW, fH || 1);
  const bgW = natW * previewScale;
  const bgH = natH * previewScale;
  const col = frame % slice.cols;
  const row = Math.floor(frame / slice.cols);

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <div
        style={{
          width: previewSize,
          height: previewSize,
          background: 'var(--bg-2)',
          borderRadius: 4,
          border: '1px solid var(--line)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: bgW,
            height: bgH,
            left: -((col * fW + slice.offsetX + slice.padding) * previewScale),
            top: -((row * fH + slice.offsetY + slice.padding) * previewScale),
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: `${bgW}px ${bgH}px`,
            imageRendering: 'pixelated',
          }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
        frame {frame} / {total - 1}
        <br />
        {slice.fps} fps
      </div>
    </div>
  );
}

function languageOf(relPath: string): string {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', lua: 'lua',
    json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
    sh: 'shell', bash: 'shell', ps1: 'powershell',
    xml: 'xml', svg: 'xml',
    gd: 'python',
    tscn: 'ini', tres: 'ini', godot: 'ini',
    cfg: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
