import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LoadSceneResponse,
  SceneImagePayload,
  SceneModel,
  SceneOp,
  SceneProp,
  Vec2,
} from '@ogf/contracts';
import { applySceneOps, fetchScene } from '../lib/api.js';
import { I } from './icons.js';

interface Props {
  projectPath: string;
  relPath: string;
  onClose?: () => void;
}

interface ImageBank {
  // relPath → HTMLImageElement (loaded)
  imgs: Map<string, HTMLImageElement>;
  // relPath → natural size from server (used before image fully loads)
  sizes: Map<string, { w: number; h: number }>;
}

interface Camera {
  /** Pixels of scene (world) per CSS pixel — i.e. drawn = world * scale. */
  scale: number;
  /** World coords of the scene point currently rendered at the canvas top-left. */
  panX: number;
  panY: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
const HANDLE_RADIUS = 6;

function cloneScene(s: SceneModel): SceneModel {
  return {
    ...s,
    background: s.background ? { ...s.background } : null,
    props: s.props.map((p) => ({
      ...p,
      position: { ...p.position },
      spriteOffset: { ...p.spriteOffset },
      scale: { ...p.scale },
      metadata: { ...p.metadata },
    })),
    notes: [...s.notes],
  };
}

export function SceneEditor(props: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneModel | null>(null);
  const [bank, setBank] = useState<ImageBank>({ imgs: new Map(), sizes: new Map() });
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'error' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ scale: 0.5, panX: 0, panY: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraInitedRef = useRef(false);

  // -------- Load scene + decode images --------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScene(null);
    setSelectedNodePath(null);
    cameraInitedRef.current = false;

    fetchScene(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        setScene(r.scene);
        void decodeImages(r).then((b) => {
          if (cancelled) return;
          setBank(b);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.relPath]);

  // -------- Initial camera fit --------

  useEffect(() => {
    if (cameraInitedRef.current) return;
    if (!scene) return;
    const c = canvasRef.current;
    const wrap = containerRef.current;
    if (!c || !wrap) return;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (cw < 32 || ch < 32) return;

    const bb = sceneBounds(scene, bank);
    const margin = 40;
    const sx = (cw - margin * 2) / Math.max(1, bb.w);
    const sy = (ch - margin * 2) / Math.max(1, bb.h);
    const scale = clamp(Math.min(sx, sy), MIN_SCALE, MAX_SCALE);
    const panX = bb.x - (cw / scale - bb.w) / 2;
    const panY = bb.y - (ch / scale - bb.h) / 2;
    setCamera({ scale, panX, panY });
    cameraInitedRef.current = true;
  }, [scene, bank]);

  // -------- Render --------

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const wrap = containerRef.current;
    if (!c || !wrap || !scene) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (c.width !== cssW * dpr || c.height !== cssH * dpr) {
      c.width = cssW * dpr;
      c.height = cssH * dpr;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Clear
    ctx.fillStyle = getCssVar('--bg-0', '#181818');
    ctx.fillRect(0, 0, cssW, cssH);

    // World→screen transform: screen = (world - pan) * scale
    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.panX, -camera.panY);

    // Background
    if (scene.background) {
      const img = bank.imgs.get(scene.background.relPath);
      const size =
        bank.sizes.get(scene.background.relPath) ??
        (scene.background.width && scene.background.height
          ? { w: scene.background.width, h: scene.background.height }
          : null);
      if (img && size) {
        ctx.drawImage(img, 0, 0, size.w, size.h);
        if (scene.background.source === 'tilemap-preview') {
          // Slight tint to remind user it's a non-editable preview
          ctx.fillStyle = 'rgba(255, 200, 80, 0.04)';
          ctx.fillRect(0, 0, size.w, size.h);
        }
      } else if (size) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, 0, size.w, size.h);
      }
    }

    // Props
    for (const p of scene.props) {
      drawProp(ctx, p, bank, p.nodePath === selectedNodePath);
    }

    ctx.restore();

    // HUD
    drawHud(ctx, cssW, cssH, camera);
  }, [scene, bank, camera, selectedNodePath]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // -------- Mouse interaction --------

  type DragState =
    | { kind: 'pan'; startX: number; startY: number; startPan: Vec2 }
    | { kind: 'prop'; nodePath: string; startWorld: Vec2; startProp: Vec2 };
  const dragRef = useRef<DragState | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  function clientToWorld(ev: { clientX: number; clientY: number }): Vec2 {
    const wrap = containerRef.current!;
    const r = wrap.getBoundingClientRect();
    const sx = ev.clientX - r.left;
    const sy = ev.clientY - r.top;
    return { x: sx / camera.scale + camera.panX, y: sy / camera.scale + camera.panY };
  }

  function findPropAt(world: Vec2): SceneProp | null {
    if (!scene) return null;
    // Iterate from top (last drawn) to bottom for hit-test priority.
    for (let i = scene.props.length - 1; i >= 0; i--) {
      const p = scene.props[i];
      const r = propBounds(p, bank);
      if (!r) continue;
      if (
        world.x >= r.x &&
        world.x <= r.x + r.w &&
        world.y >= r.y &&
        world.y <= r.y + r.h
      ) {
        return p;
      }
    }
    return null;
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!scene) return;
    const w = clientToWorld(e);
    const hit = findPropAt(w);
    if (e.button === 0 && hit && !e.altKey && !e.shiftKey) {
      setSelectedNodePath(hit.nodePath);
      dragRef.current = {
        kind: 'prop',
        nodePath: hit.nodePath,
        startWorld: w,
        startProp: { ...hit.position },
      };
    } else {
      // Start a pan
      if (e.button === 0 && !hit) setSelectedNodePath(null);
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPan: { x: camera.panX, y: camera.panY },
      };
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(ev: MouseEvent) {
    const ds = dragRef.current;
    if (!ds) return;
    if (ds.kind === 'pan') {
      const dx = (ev.clientX - ds.startX) / camera.scale;
      const dy = (ev.clientY - ds.startY) / camera.scale;
      setCamera((c) => ({ ...c, panX: ds.startPan.x - dx, panY: ds.startPan.y - dy }));
      return;
    }
    if (ds.kind === 'prop') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.startWorld.x;
      const dy = w.y - ds.startWorld.y;
      const nx = ds.startProp.x + dx;
      const ny = ds.startProp.y + dy;
      // Snap to whole pixel by default; hold Shift for sub-pixel.
      const snap = !ev.shiftKey;
      const pos = snap ? { x: Math.round(nx), y: Math.round(ny) } : { x: nx, y: ny };
      setScene((s) =>
        s
          ? {
              ...s,
              props: s.props.map((p) =>
                p.nodePath === ds.nodePath ? { ...p, position: pos } : p,
              ),
            }
          : s,
      );
    }
  }

  function onMouseUp() {
    const ds = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (ds?.kind === 'prop' && scene) {
      const moved = scene.props.find((p) => p.nodePath === ds.nodePath);
      if (
        moved &&
        (moved.position.x !== ds.startProp.x || moved.position.y !== ds.startProp.y)
      ) {
        scheduleSave({ kind: 'move-prop', nodePath: ds.nodePath, position: moved.position });
      }
    }
  }

  function scheduleSave(op: SceneOp) {
    pendingOpsRef.current.push(op);
    setSavingState('saving');
    setSaveError(null);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 220);
  }

  const pendingOpsRef = useRef<SceneOp[]>([]);

  async function flushSave() {
    saveTimerRef.current = null;
    const ops = pendingOpsRef.current;
    if (ops.length === 0) {
      setSavingState('idle');
      return;
    }
    pendingOpsRef.current = [];
    try {
      await applySceneOps({
        projectPath: props.projectPath,
        relPath: props.relPath,
        ops,
      });
      setSavingState('saved');
      window.setTimeout(() => {
        setSavingState((s) => (s === 'saved' ? 'idle' : s));
      }, 900);
    } catch (err) {
      setSavingState('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  // -------- Wheel: zoom around cursor --------

  function onWheel(e: React.WheelEvent) {
    if (!scene) return;
    e.preventDefault();
    const w = clientToWorld({ clientX: e.clientX, clientY: e.clientY });
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
    if (next === camera.scale) return;
    // Keep cursor world point stationary
    const sx = e.clientX - containerRef.current!.getBoundingClientRect().left;
    const sy = e.clientY - containerRef.current!.getBoundingClientRect().top;
    const newPanX = w.x - sx / next;
    const newPanY = w.y - sy / next;
    setCamera({ scale: next, panX: newPanX, panY: newPanY });
  }

  function fitToView() {
    if (!scene) return;
    const wrap = containerRef.current;
    if (!wrap) return;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    const bb = sceneBounds(scene, bank);
    const margin = 40;
    const sx = (cw - margin * 2) / Math.max(1, bb.w);
    const sy = (ch - margin * 2) / Math.max(1, bb.h);
    const scale = clamp(Math.min(sx, sy), MIN_SCALE, MAX_SCALE);
    const panX = bb.x - (cw / scale - bb.w) / 2;
    const panY = bb.y - (ch / scale - bb.h) / 2;
    setCamera({ scale, panX, panY });
  }

  const selectedProp = useMemo(
    () => scene?.props.find((p) => p.nodePath === selectedNodePath) ?? null,
    [scene, selectedNodePath],
  );

  // -------- Render UI --------

  return (
    <div className="inspector">
      <div className="crumbs">
        <span>{props.relPath}</span>
        {scene && <span className="badge-dim">{scene.props.length} props</span>}
        {scene?.background && (
          <span className="badge-dim">
            {scene.background.source === 'tilemap-preview' ? 'tilemap (preview)' : 'image bg'}
          </span>
        )}
        <span className="actions">
          <SaveBadge state={savingState} error={saveError} />
          <button
            className="btn btn-sm btn-ghost"
            title="Fit scene to view"
            onClick={fitToView}
            disabled={!scene}
          >
            fit
          </button>
          {props.onClose && (
            <button
              className="btn btn-sm btn-ghost"
              title="Close scene"
              onClick={props.onClose}
            >
              {I.close}
            </button>
          )}
        </span>
      </div>
      <div className="inspector-body" style={{ gridTemplateColumns: '1fr 280px' }}>
        <div
          ref={containerRef}
          className="scene-canvas-wrap"
          onMouseDown={onMouseDown}
          onWheel={onWheel}
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--bg-0)',
            cursor: dragRef.current?.kind === 'pan' ? 'grabbing' : 'default',
          }}
        >
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
          {loading && (
            <div className="scene-overlay">Loading scene…</div>
          )}
          {error && (
            <div className="scene-overlay error">Could not load: {error}</div>
          )}
          {scene && scene.notes.length > 0 && (
            <div className="scene-notes">
              {scene.notes.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          )}
        </div>
        <ScenePanel
          scene={scene}
          selected={selectedProp}
          onSelect={setSelectedNodePath}
        />
      </div>
    </div>
  );
}

// ============= Sub-components =============

function SaveBadge({
  state,
  error,
}: {
  state: 'idle' | 'saving' | 'error' | 'saved';
  error: string | null;
}) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return <span className="badge-dim" style={{ color: 'var(--ink-2)' }}>saving…</span>;
  }
  if (state === 'saved') {
    return <span className="badge-dim" style={{ color: 'var(--green)' }}>saved</span>;
  }
  return (
    <span
      className="badge-dim"
      style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
      title={error ?? ''}
    >
      save failed
    </span>
  );
}

function ScenePanel({
  scene,
  selected,
  onSelect,
}: {
  scene: SceneModel | null;
  selected: SceneProp | null;
  onSelect: (path: string | null) => void;
}) {
  return (
    <aside className="scene-panel">
      <div className="scene-panel-section">
        <div className="scene-panel-title">Scene</div>
        {scene ? (
          <>
            <div className="scene-panel-row">
              <span className="muted">root</span>
              <span className="mono">{scene.rootName}</span>
            </div>
            <div className="scene-panel-row">
              <span className="muted">props</span>
              <span className="mono">{scene.props.length}</span>
            </div>
            {scene.background && (
              <div className="scene-panel-row">
                <span className="muted">bg</span>
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {scene.background.relPath.split('/').pop()}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="muted">No scene loaded</div>
        )}
      </div>
      <div className="scene-panel-section" style={{ flex: 1, minHeight: 0 }}>
        <div className="scene-panel-title">Props</div>
        <div className="scene-panel-list">
          {scene?.props.map((p) => (
            <button
              key={p.nodePath}
              className={`scene-prop-item ${selected?.nodePath === p.nodePath ? 'active' : ''}`}
              onClick={() => onSelect(p.nodePath)}
            >
              <span className="mono">{p.name}</span>
              <span className="muted mono">
                {Math.round(p.position.x)},{Math.round(p.position.y)}
              </span>
            </button>
          ))}
          {scene && scene.props.length === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              No draggable props in this scene.
            </div>
          )}
        </div>
      </div>
      {selected && (
        <div className="scene-panel-section">
          <div className="scene-panel-title">Selected</div>
          <div className="scene-panel-row">
            <span className="muted">name</span>
            <span className="mono">{selected.name}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">position</span>
            <span className="mono">
              ({Math.round(selected.position.x)}, {Math.round(selected.position.y)})
            </span>
          </div>
          {selected.texture && (
            <div className="scene-panel-row">
              <span className="muted">texture</span>
              <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selected.texture.split('/').pop()}
              </span>
            </div>
          )}
          {Object.entries(selected.metadata).length > 0 && (
            <>
              <div className="scene-panel-title sub">metadata</div>
              {Object.entries(selected.metadata).map(([k, v]) => (
                <div className="scene-panel-row" key={k}>
                  <span className="muted">{k}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <div className="scene-panel-foot muted">
        Drag a prop to move. Drag empty space to pan. Wheel to zoom. Hold Shift while dragging for sub-pixel.
      </div>
    </aside>
  );
}

// ============= Helpers =============

async function decodeImages(r: LoadSceneResponse): Promise<ImageBank> {
  const imgs = new Map<string, HTMLImageElement>();
  const sizes = new Map<string, { w: number; h: number }>();
  await Promise.all(
    r.images.map(
      (payload) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            imgs.set(payload.relPath, img);
            sizes.set(payload.relPath, { w: img.naturalWidth, h: img.naturalHeight });
            resolve();
          };
          img.onerror = () => {
            // Still record the size from server so we can draw a placeholder rect.
            if (payload.width && payload.height) {
              sizes.set(payload.relPath, { w: payload.width, h: payload.height });
            }
            resolve();
          };
          img.src = `data:image/png;base64,${payload.base64}`;
          // Pre-seed size from server in case load fires before naturalWidth populates.
          if (payload.width && payload.height) {
            sizes.set(payload.relPath, { w: payload.width, h: payload.height });
          }
        }),
    ),
  );
  return { imgs, sizes };
}

function propBounds(p: SceneProp, bank: ImageBank) {
  if (!p.texture) return null;
  const size = bank.sizes.get(p.texture);
  if (!size) return null;
  const w = size.w * Math.abs(p.scale.x);
  const h = size.h * Math.abs(p.scale.y);
  // Sprite2D draws centered at its origin by default. Origin = parent.position + sprite.offset.
  const cx = p.position.x + p.spriteOffset.x;
  const cy = p.position.y + p.spriteOffset.y;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function drawProp(
  ctx: CanvasRenderingContext2D,
  p: SceneProp,
  bank: ImageBank,
  selected: boolean,
) {
  const r = propBounds(p, bank);
  if (!r) return;
  const img = p.texture ? bank.imgs.get(p.texture) : null;
  if (img) {
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  } else {
    ctx.fillStyle = 'rgba(255, 80, 80, 0.3)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // Origin marker (small cross at the parent Node2D position)
  drawCross(ctx, p.position.x, p.position.y, selected ? 'rgba(255,200,80,1)' : 'rgba(255,255,255,0.4)');

  if (selected) {
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.95)';
    ctx.lineWidth = 1.5 / 1; // logical px; scaled by ctx
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
}

function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  const s = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s);
  ctx.lineTo(x, y + s);
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera) {
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`zoom ${Math.round(cam.scale * 100)}%`, 8, h - 6);
}

function sceneBounds(s: SceneModel, bank: ImageBank): { x: number; y: number; w: number; h: number } {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  if (s.background) {
    const size =
      bank.sizes.get(s.background.relPath) ??
      (s.background.width && s.background.height
        ? { w: s.background.width, h: s.background.height }
        : null);
    if (size) rects.push({ x: 0, y: 0, w: size.w, h: size.h });
  }
  for (const p of s.props) {
    const r = propBounds(p, bank);
    if (r) rects.push(r);
  }
  if (rects.length === 0) return { x: 0, y: 0, w: 1024, h: 1024 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function getCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Suppress unused warnings on intentionally-future-use imports.
void HANDLE_RADIUS;
void cloneScene;
