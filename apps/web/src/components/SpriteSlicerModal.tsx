import { useEffect, useState } from 'react';
import { fetchFileContent, writeFileContent } from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { I } from './icons.js';

export interface SliceMetadata {
  cols: number;
  rows: number;
  padding: number;
  offsetX: number;
  offsetY: number;
  anchor: 'top' | 'center' | 'bottom' | 'feet' | 'left' | 'right';
  fps: number;
  /** Where this metadata describes (relative path of source PNG). */
  source: string;
  /** Pixel width / height of one frame, computed at save-time. */
  frameW?: number;
  frameH?: number;
}

interface Props {
  projectPath: string;
  imageRelPath: string;
  /** Optional preloaded metadata (read from sidecar JSON before opening). */
  initial?: Partial<SliceMetadata>;
  onClose: () => void;
  onSaved?: (m: SliceMetadata) => void;
  onAskCodex?: (m: SliceMetadata) => void;
}

const ANCHORS: SliceMetadata['anchor'][] = ['top', 'center', 'bottom', 'feet', 'left', 'right'];

export function SpriteSlicerModal(props: Props) {
  const { notify } = useDialog();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);

  const [cols, setCols] = useState(props.initial?.cols ?? 4);
  const [rows, setRows] = useState(props.initial?.rows ?? 4);
  const [pad, setPad] = useState(props.initial?.padding ?? 0);
  const [offX, setOffX] = useState(props.initial?.offsetX ?? 0);
  const [offY, setOffY] = useState(props.initial?.offsetY ?? 0);
  const [anchor, setAnchor] = useState<SliceMetadata['anchor']>(props.initial?.anchor ?? 'center');
  const [fps, setFps] = useState(props.initial?.fps ?? 8);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load image as data URL
  useEffect(() => {
    let cancelled = false;
    setImgError(null);
    fetchFileContent(props.projectPath, props.imageRelPath)
      .then((r) => {
        if (cancelled) return;
        if (r.kind !== 'image' || !r.base64) {
          setImgError('Not an image');
          return;
        }
        const ext = props.imageRelPath.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        setImgUrl(`data:${mime};base64,${r.base64}`);
      })
      .catch((e) => {
        if (!cancelled) setImgError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.imageRelPath]);

  const fW = naturalW > 0 ? naturalW / cols : 0;
  const fH = naturalH > 0 ? naturalH / rows : 0;
  const totalFrames = cols * rows;

  // Animation preview frame index
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (totalFrames === 0) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % totalFrames), 1000 / fps);
    return () => clearInterval(id);
  }, [fps, totalFrames]);
  // Reset frame index when grid changes
  useEffect(() => setFrame(0), [cols, rows]);

  // Display scale: fit canvas area
  const canvasMaxW = 640;
  const canvasMaxH = 460;
  const displayScale =
    naturalW > 0 ? Math.min(canvasMaxW / naturalW, canvasMaxH / naturalH, 4) : 1;
  const displayW = naturalW * displayScale;
  const displayH = naturalH * displayScale;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const metadata: SliceMetadata = {
        cols,
        rows,
        padding: pad,
        offsetX: offX,
        offsetY: offY,
        anchor,
        fps,
        source: props.imageRelPath,
        frameW: Math.round(fW),
        frameH: Math.round(fH),
      };
      const sidecar = props.imageRelPath.replace(/\.(png|jpg|jpeg|gif|webp|bmp)$/i, '.ogf-slice.json');
      await writeFileContent({
        projectPath: props.projectPath,
        relPath: sidecar,
        content: JSON.stringify(metadata, null, 2),
      });
      setSavedAt(Date.now());
      props.onSaved?.(metadata);
    } catch (err) {
      notify({ kind: 'error', title: 'Could not save slicing', body: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  // Compute one-frame preview style (CSS background-position + size)
  const previewSize = 96;
  const previewScale = previewSize / Math.max(fW, fH || 1);
  const previewBgW = naturalW * previewScale;
  const previewBgH = naturalH * previewScale;
  const frameCol = frame % cols;
  const frameRow = Math.floor(frame / cols);

  return (
    <div className="modal-scrim" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span style={{ color: 'var(--accent)' }}>{I.scissors}</span>
          <span className="title">Sprite frame editor</span>
          <span className="sub">
            {props.imageRelPath} · {naturalW}×{naturalH}
          </span>
          <button className="close" onClick={props.onClose}>{I.close}</button>
        </div>

        <div className="modal-body">
          <div className="modal-canvas">
            {imgError && <div className="msg-sys err">{imgError}</div>}
            {!imgUrl && !imgError && <div className="muted mono">Loading image…</div>}
            {imgUrl && (
              <div
                style={{
                  position: 'relative',
                  width: displayW || naturalW,
                  height: displayH || naturalH,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
                <img
                  src={imgUrl}
                  alt={props.imageRelPath}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setNaturalW(el.naturalWidth);
                    setNaturalH(el.naturalHeight);
                  }}
                  style={{
                    display: 'block',
                    width: displayW || 'auto',
                    height: displayH || 'auto',
                    imageRendering: 'pixelated',
                  }}
                />
                {/* grid overlay */}
                {fW > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      pointerEvents: 'none',
                    }}
                  >
                    {Array.from({ length: cols - 1 }).map((_, c) => (
                      <div
                        key={`v${c}`}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: ((c + 1) * fW + offX) * displayScale,
                          width: 1,
                          background: 'var(--accent)',
                          opacity: 0.5,
                        }}
                      />
                    ))}
                    {Array.from({ length: rows - 1 }).map((_, r) => (
                      <div
                        key={`h${r}`}
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: ((r + 1) * fH + offY) * displayScale,
                          height: 1,
                          background: 'var(--accent)',
                          opacity: 0.5,
                        }}
                      />
                    ))}
                    {/* current frame highlight */}
                    <div
                      style={{
                        position: 'absolute',
                        left: (frameCol * fW + offX + pad) * displayScale,
                        top: (frameRow * fH + offY + pad) * displayScale,
                        width: (fW - pad * 2) * displayScale,
                        height: (fH - pad * 2) * displayScale,
                        border: '1.5px solid var(--accent)',
                        boxShadow: '0 0 0 2px oklch(0 0 0 / 0.5)',
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-side">
            <div>
              <h5>Slice</h5>
              <div className="field">
                <label>Columns <b>{cols}</b></label>
                <input type="range" min={1} max={16} value={cols} onChange={(e) => setCols(+e.target.value)} />
              </div>
              <div className="field">
                <label>Rows <b>{rows}</b></label>
                <input type="range" min={1} max={16} value={rows} onChange={(e) => setRows(+e.target.value)} />
              </div>
              <div className="field-row">
                <div className="field"><label>Frame W <b>{Math.round(fW)}px</b></label></div>
                <div className="field"><label>Frame H <b>{Math.round(fH)}px</b></label></div>
              </div>
            </div>

            <div>
              <h5>Offset & Padding</h5>
              <div className="field">
                <label>Padding <b>{pad}px</b></label>
                <input type="range" min={0} max={16} value={pad} onChange={(e) => setPad(+e.target.value)} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Offset X <b>{offX}px</b></label>
                  <input type="range" min={-32} max={32} value={offX} onChange={(e) => setOffX(+e.target.value)} />
                </div>
                <div className="field">
                  <label>Offset Y <b>{offY}px</b></label>
                  <input type="range" min={-32} max={32} value={offY} onChange={(e) => setOffY(+e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <h5>Anchor</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {ANCHORS.map((a) => (
                  <button
                    key={a}
                    className="chip"
                    data-active={anchor === a}
                    onClick={() => setAnchor(a)}
                    style={{ justifyContent: 'center' }}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h5>Animation preview</h5>
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
                    backgroundImage:
                      'linear-gradient(45deg, var(--check-1) 25%, transparent 25%), linear-gradient(-45deg, var(--check-1) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--check-1) 75%), linear-gradient(-45deg, transparent 75%, var(--check-1) 75%)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                    backgroundColor: 'var(--bg-1)',
                  }}
                >
                  {imgUrl && fW > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        width: previewBgW,
                        height: previewBgH,
                        left: -((frameCol * fW + offX + pad) * previewScale),
                        top: -((frameRow * fH + offY + pad) * previewScale),
                        backgroundImage: `url(${imgUrl})`,
                        backgroundSize: `${previewBgW}px ${previewBgH}px`,
                        imageRendering: 'pixelated',
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div className="field">
                    <label>FPS <b>{fps}</b></label>
                    <input type="range" min={1} max={24} value={fps} onChange={(e) => setFps(+e.target.value)} />
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
                    frame {frame} / {totalFrames - 1}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span className="info">
            {totalFrames} frames · {Math.round(fW)}×{Math.round(fH)}px · {anchor}
            {savedAt && <span style={{ marginLeft: 12, color: 'var(--green)' }}>✓ saved</span>}
          </span>
          <span className="grow" />
          <button className="btn btn-sm" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-sm" onClick={() => void save()} disabled={saving || !naturalW}>
            {saving ? 'Saving…' : 'Save metadata'}
          </button>
          {props.onAskCodex && (
            <button
              className="btn btn-sm btn-primary"
              disabled={!naturalW}
              onClick={async () => {
                await save();
                const metadata: SliceMetadata = {
                  cols, rows, padding: pad, offsetX: offX, offsetY: offY, anchor, fps,
                  source: props.imageRelPath,
                  frameW: Math.round(fW), frameH: Math.round(fH),
                };
                props.onAskCodex?.(metadata);
                props.onClose();
              }}
              title="Save and ask Codex to apply this slicing to the engine config"
            >
              Save + Apply via Codex
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
