import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ColliderRef,
  LoadSceneResponse,
  SceneCollider,
  SceneImagePayload,
  SceneModel,
  SceneOp,
  SceneProp,
  Vec2,
} from '@ogf/contracts';
import { applySceneOps, fetchScene } from '../lib/api.js';
import { I } from './icons.js';

type EditMode = 'props' | 'colliders';
type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

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


export function SceneEditor(props: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneModel | null>(null);
  const [bank, setBank] = useState<ImageBank>({ imgs: new Map(), sizes: new Map() });
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [selectedColliderUid, setSelectedColliderUid] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>('props');
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
      drawProp(ctx, p, bank, mode === 'props' && p.nodePath === selectedNodePath);
    }

    // Colliders — always rendered, but only "active" appearance in collider mode.
    for (const c of scene.colliders) {
      drawCollider(
        ctx,
        c,
        mode === 'colliders',
        mode === 'colliders' && c.uid === selectedColliderUid,
        camera.scale,
      );
    }

    ctx.restore();

    // HUD
    drawHud(ctx, cssW, cssH, camera);
  }, [scene, bank, camera, selectedNodePath, selectedColliderUid, mode]);

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
    | { kind: 'prop'; nodePath: string; startWorld: Vec2; startProp: Vec2 }
    | {
        kind: 'collider-move';
        uid: string;
        ref: ColliderRef;
        startWorld: Vec2;
        startPos: Vec2;
      }
    | {
        kind: 'collider-resize-rect';
        uid: string;
        ref: ColliderRef;
        corner: ResizeCorner;
        startWorld: Vec2;
        startPos: Vec2;
        startW: number;
        startH: number;
      }
    | {
        kind: 'collider-resize-circle';
        uid: string;
        ref: ColliderRef;
        startWorld: Vec2;
        startCenter: Vec2;
        startR: number;
      };
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

  function findColliderAt(world: Vec2): SceneCollider | null {
    if (!scene) return null;
    for (let i = scene.colliders.length - 1; i >= 0; i--) {
      const c = scene.colliders[i];
      if (insideCollider(world, c)) return c;
    }
    return null;
  }

  /** Hit-test rect resize handles for the selected collider. World-space radius scaled by camera. */
  function findResizeHandle(world: Vec2): { uid: string; corner: ResizeCorner } | null {
    if (!scene || mode !== 'colliders' || !selectedColliderUid) return null;
    const c = scene.colliders.find((x) => x.uid === selectedColliderUid);
    if (!c || c.shape.kind !== 'rect' || !c.editable) return null;
    const r = rectFromCollider(c);
    const corners: { name: ResizeCorner; p: Vec2 }[] = [
      { name: 'tl', p: { x: r.x, y: r.y } },
      { name: 'tr', p: { x: r.x + r.w, y: r.y } },
      { name: 'bl', p: { x: r.x, y: r.y + r.h } },
      { name: 'br', p: { x: r.x + r.w, y: r.y + r.h } },
    ];
    const tol = (HANDLE_RADIUS + 2) / camera.scale;
    for (const cor of corners) {
      if (Math.abs(world.x - cor.p.x) <= tol && Math.abs(world.y - cor.p.y) <= tol) {
        return { uid: c.uid, corner: cor.name };
      }
    }
    return null;
  }

  function findCircleRadiusHandle(world: Vec2): string | null {
    if (!scene || mode !== 'colliders' || !selectedColliderUid) return null;
    const c = scene.colliders.find((x) => x.uid === selectedColliderUid);
    if (!c || c.shape.kind !== 'circle' || !c.editable) return null;
    const handle = { x: c.position.x + c.shape.r, y: c.position.y };
    const tol = (HANDLE_RADIUS + 2) / camera.scale;
    if (Math.abs(world.x - handle.x) <= tol && Math.abs(world.y - handle.y) <= tol) {
      return c.uid;
    }
    return null;
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!scene) return;
    const w = clientToWorld(e);

    // ----- Collider mode -----
    if (mode === 'colliders' && e.button === 0 && !e.altKey) {
      // 1) Resize handle on selected rect collider?
      const handle = findResizeHandle(w);
      if (handle) {
        const c = scene.colliders.find((x) => x.uid === handle.uid);
        if (c && c.shape.kind === 'rect') {
          const r = rectFromCollider(c);
          dragRef.current = {
            kind: 'collider-resize-rect',
            uid: c.uid,
            ref: c.ref,
            corner: handle.corner,
            startWorld: w,
            startPos: { x: r.x, y: r.y },
            startW: r.w,
            startH: r.h,
          };
          attachWindowDrag();
          return;
        }
      }
      // 2) Radius handle on selected circle?
      const circleUid = findCircleRadiusHandle(w);
      if (circleUid) {
        const c = scene.colliders.find((x) => x.uid === circleUid);
        if (c && c.shape.kind === 'circle') {
          dragRef.current = {
            kind: 'collider-resize-circle',
            uid: c.uid,
            ref: c.ref,
            startWorld: w,
            startCenter: { ...c.position },
            startR: c.shape.r,
          };
          attachWindowDrag();
          return;
        }
      }
      // 3) Body of any collider?
      const colHit = findColliderAt(w);
      if (colHit) {
        setSelectedColliderUid(colHit.uid);
        if (colHit.editable) {
          dragRef.current = {
            kind: 'collider-move',
            uid: colHit.uid,
            ref: colHit.ref,
            startWorld: w,
            startPos: { ...colHit.position },
          };
        } else {
          // Read-only — pan instead so users can keep moving the camera.
          dragRef.current = {
            kind: 'pan',
            startX: e.clientX,
            startY: e.clientY,
            startPan: { x: camera.panX, y: camera.panY },
          };
        }
        attachWindowDrag();
        return;
      }
      // 4) Empty space → deselect + pan
      setSelectedColliderUid(null);
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPan: { x: camera.panX, y: camera.panY },
      };
      attachWindowDrag();
      return;
    }

    // ----- Props mode (default) -----
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
      if (e.button === 0 && !hit) setSelectedNodePath(null);
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPan: { x: camera.panX, y: camera.panY },
      };
    }
    attachWindowDrag();
  }

  function attachWindowDrag() {
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
      return;
    }
    if (ds.kind === 'collider-move') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.startWorld.x;
      const dy = w.y - ds.startWorld.y;
      const snap = !ev.shiftKey;
      const pos = {
        x: snap ? Math.round(ds.startPos.x + dx) : ds.startPos.x + dx,
        y: snap ? Math.round(ds.startPos.y + dy) : ds.startPos.y + dy,
      };
      setScene((s) => updateColliderPosition(s, ds.uid, pos));
      return;
    }
    if (ds.kind === 'collider-resize-rect') {
      const w = clientToWorld(ev);
      const r = resizedRect(ds.corner, ds.startPos, ds.startW, ds.startH, w);
      const snap = !ev.shiftKey;
      const newW = Math.max(2, snap ? Math.round(r.w) : r.w);
      const newH = Math.max(2, snap ? Math.round(r.h) : r.h);
      const newCenter = { x: r.x + newW / 2, y: r.y + newH / 2 };
      setScene((s) =>
        updateColliderRect(s, ds.uid, newCenter, newW, newH),
      );
      return;
    }
    if (ds.kind === 'collider-resize-circle') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.startCenter.x;
      const dy = w.y - ds.startCenter.y;
      const snap = !ev.shiftKey;
      let r = Math.sqrt(dx * dx + dy * dy);
      if (snap) r = Math.round(r);
      r = Math.max(2, r);
      setScene((s) =>
        updateColliderCircle(s, ds.uid, ds.startCenter, r),
      );
      return;
    }
  }

  function onMouseUp() {
    const ds = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (!scene || !ds) return;

    if (ds.kind === 'prop') {
      const moved = scene.props.find((p) => p.nodePath === ds.nodePath);
      if (
        moved &&
        (moved.position.x !== ds.startProp.x || moved.position.y !== ds.startProp.y)
      ) {
        scheduleSave({ kind: 'move-prop', nodePath: ds.nodePath, position: moved.position });
      }
      return;
    }
    if (ds.kind === 'collider-move') {
      const cur = scene.colliders.find((c) => c.uid === ds.uid);
      if (
        cur &&
        (cur.position.x !== ds.startPos.x || cur.position.y !== ds.startPos.y)
      ) {
        scheduleSave({ kind: 'move-collider', ref: ds.ref, position: cur.position });
      }
      return;
    }
    if (ds.kind === 'collider-resize-rect') {
      const cur = scene.colliders.find((c) => c.uid === ds.uid);
      if (cur && cur.shape.kind === 'rect') {
        const sizeChanged = cur.shape.w !== ds.startW || cur.shape.h !== ds.startH;
        const movedX = cur.position.x !== ds.startPos.x + ds.startW / 2;
        const movedY = cur.position.y !== ds.startPos.y + ds.startH / 2;
        if (sizeChanged) {
          scheduleSave({
            kind: 'resize-rect-collider',
            ref: ds.ref,
            w: cur.shape.w,
            h: cur.shape.h,
          });
        }
        if (movedX || movedY) {
          scheduleSave({ kind: 'move-collider', ref: ds.ref, position: cur.position });
        }
      }
      return;
    }
    if (ds.kind === 'collider-resize-circle') {
      const cur = scene.colliders.find((c) => c.uid === ds.uid);
      if (cur && cur.shape.kind === 'circle' && cur.shape.r !== ds.startR) {
        scheduleSave({ kind: 'resize-circle-collider', ref: ds.ref, r: cur.shape.r });
      }
      return;
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
  const selectedCollider = useMemo(
    () => scene?.colliders.find((c) => c.uid === selectedColliderUid) ?? null,
    [scene, selectedColliderUid],
  );

  // -------- Render UI --------

  return (
    <div className="inspector">
      <div className="crumbs">
        <span>{props.relPath}</span>
        {scene && <span className="badge-dim">{scene.props.length} props</span>}
        {scene && <span className="badge-dim">{scene.colliders.length} colliders</span>}
        {scene?.background && (
          <span className="badge-dim">
            {scene.background.source === 'tilemap-preview' ? 'tilemap (preview)' : 'image bg'}
          </span>
        )}
        <span className="actions">
          <ModeToggle mode={mode} setMode={setMode} />
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
          mode={mode}
          selectedProp={selectedProp}
          selectedCollider={selectedCollider}
          onSelectProp={setSelectedNodePath}
          onSelectCollider={setSelectedColliderUid}
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
  mode,
  selectedProp,
  selectedCollider,
  onSelectProp,
  onSelectCollider,
}: {
  scene: SceneModel | null;
  mode: EditMode;
  selectedProp: SceneProp | null;
  selectedCollider: SceneCollider | null;
  onSelectProp: (path: string | null) => void;
  onSelectCollider: (uid: string | null) => void;
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
            <div className="scene-panel-row">
              <span className="muted">colliders</span>
              <span className="mono">
                {scene.colliders.length}
                {scene.collidersJsonPath ? ' (json)' : scene.colliders.length > 0 ? ' (tscn)' : ''}
              </span>
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

      {mode === 'props' && (
        <div className="scene-panel-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="scene-panel-title">Props</div>
          <div className="scene-panel-list">
            {scene?.props.map((p) => (
              <button
                key={p.nodePath}
                className={`scene-prop-item ${selectedProp?.nodePath === p.nodePath ? 'active' : ''}`}
                onClick={() => onSelectProp(p.nodePath)}
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
      )}

      {mode === 'colliders' && (
        <div className="scene-panel-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="scene-panel-title">Colliders</div>
          <div className="scene-panel-list">
            {scene?.colliders.map((c) => (
              <button
                key={c.uid}
                className={`scene-prop-item ${selectedCollider?.uid === c.uid ? 'active' : ''}`}
                onClick={() => onSelectCollider(c.uid)}
                title={c.editable ? '' : 'Read-only — Phase 4 will add polygon editing'}
              >
                <span className="mono">
                  {c.shape.kind === 'rect' ? '▭' : c.shape.kind === 'circle' ? '○' : '◇'} {c.name}
                  {!c.editable && ' ·🔒'}
                </span>
                <span className="muted mono">{c.kind || c.shape.kind}</span>
              </button>
            ))}
            {scene && scene.colliders.length === 0 && (
              <div className="muted" style={{ padding: 8 }}>
                No colliders in this scene.
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'props' && selectedProp && (
        <div className="scene-panel-section">
          <div className="scene-panel-title">Selected prop</div>
          <div className="scene-panel-row">
            <span className="muted">name</span>
            <span className="mono">{selectedProp.name}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">position</span>
            <span className="mono">
              ({Math.round(selectedProp.position.x)}, {Math.round(selectedProp.position.y)})
            </span>
          </div>
          {selectedProp.texture && (
            <div className="scene-panel-row">
              <span className="muted">texture</span>
              <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedProp.texture.split('/').pop()}
              </span>
            </div>
          )}
          {Object.entries(selectedProp.metadata).length > 0 && (
            <>
              <div className="scene-panel-title sub">metadata</div>
              {Object.entries(selectedProp.metadata).map(([k, v]) => (
                <div className="scene-panel-row" key={k}>
                  <span className="muted">{k}</span>
                  <span className="mono">{v}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {mode === 'colliders' && selectedCollider && (
        <div className="scene-panel-section">
          <div className="scene-panel-title">Selected collider</div>
          <div className="scene-panel-row">
            <span className="muted">name</span>
            <span className="mono">{selectedCollider.name}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">kind</span>
            <span className="mono">{selectedCollider.kind || '—'}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">shape</span>
            <span className="mono">{selectedCollider.shape.kind}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">center</span>
            <span className="mono">
              ({Math.round(selectedCollider.position.x)}, {Math.round(selectedCollider.position.y)})
            </span>
          </div>
          {selectedCollider.shape.kind === 'rect' && (
            <div className="scene-panel-row">
              <span className="muted">size</span>
              <span className="mono">
                {Math.round(selectedCollider.shape.w)} × {Math.round(selectedCollider.shape.h)}
              </span>
            </div>
          )}
          {selectedCollider.shape.kind === 'circle' && (
            <div className="scene-panel-row">
              <span className="muted">radius</span>
              <span className="mono">{Math.round(selectedCollider.shape.r)}</span>
            </div>
          )}
          {selectedCollider.shape.kind === 'polygon' && (
            <div className="scene-panel-row">
              <span className="muted">points</span>
              <span className="mono">{selectedCollider.shape.points.length}</span>
            </div>
          )}
          {!selectedCollider.editable && (
            <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
              Polygon edit lands in Phase 4.
            </div>
          )}
        </div>
      )}

      <div className="scene-panel-foot muted">
        {mode === 'props'
          ? 'Drag a prop to move. Drag empty space to pan. Wheel to zoom. Shift = sub-pixel.'
          : 'Click a collider to select. Drag body to move, drag corner/handle to resize. Shift = sub-pixel.'}
      </div>
    </aside>
  );
}

function ModeToggle({ mode, setMode }: { mode: EditMode; setMode: (m: EditMode) => void }) {
  return (
    <span className="scene-mode-toggle" role="tablist">
      <button
        role="tab"
        aria-selected={mode === 'props'}
        onClick={() => setMode('props')}
        className={`scene-mode-btn ${mode === 'props' ? 'active' : ''}`}
        title="Move props"
      >
        props
      </button>
      <button
        role="tab"
        aria-selected={mode === 'colliders'}
        onClick={() => setMode('colliders')}
        className={`scene-mode-btn ${mode === 'colliders' ? 'active' : ''}`}
        title="Edit collision shapes"
      >
        colliders
      </button>
    </span>
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

// ============= Collider helpers =============

function rectFromCollider(c: SceneCollider): { x: number; y: number; w: number; h: number } {
  if (c.shape.kind !== 'rect') return { x: c.position.x, y: c.position.y, w: 0, h: 0 };
  return {
    x: c.position.x - c.shape.w / 2,
    y: c.position.y - c.shape.h / 2,
    w: c.shape.w,
    h: c.shape.h,
  };
}

function insideCollider(p: Vec2, c: SceneCollider): boolean {
  if (c.shape.kind === 'rect') {
    const r = rectFromCollider(c);
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }
  if (c.shape.kind === 'circle') {
    const dx = p.x - c.position.x;
    const dy = p.y - c.position.y;
    return dx * dx + dy * dy <= c.shape.r * c.shape.r;
  }
  // polygon — point-in-polygon (ray cast)
  const pts = c.shape.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function resizedRect(
  corner: ResizeCorner,
  startPos: Vec2,
  startW: number,
  startH: number,
  cursor: Vec2,
): { x: number; y: number; w: number; h: number } {
  let x = startPos.x;
  let y = startPos.y;
  let w = startW;
  let h = startH;
  if (corner === 'tl') {
    x = cursor.x;
    y = cursor.y;
    w = startPos.x + startW - cursor.x;
    h = startPos.y + startH - cursor.y;
  } else if (corner === 'tr') {
    y = cursor.y;
    w = cursor.x - startPos.x;
    h = startPos.y + startH - cursor.y;
  } else if (corner === 'bl') {
    x = cursor.x;
    w = startPos.x + startW - cursor.x;
    h = cursor.y - startPos.y;
  } else {
    w = cursor.x - startPos.x;
    h = cursor.y - startPos.y;
  }
  // Allow inversion: if user drags past the opposite edge, flip the rect.
  if (w < 0) {
    x = x + w;
    w = -w;
  }
  if (h < 0) {
    y = y + h;
    h = -h;
  }
  return { x, y, w, h };
}

function updateColliderPosition(
  s: SceneModel | null,
  uid: string,
  position: Vec2,
): SceneModel | null {
  if (!s) return s;
  return {
    ...s,
    colliders: s.colliders.map((c) => (c.uid === uid ? { ...c, position } : c)),
  };
}

function updateColliderRect(
  s: SceneModel | null,
  uid: string,
  position: Vec2,
  w: number,
  h: number,
): SceneModel | null {
  if (!s) return s;
  return {
    ...s,
    colliders: s.colliders.map((c) =>
      c.uid === uid && c.shape.kind === 'rect'
        ? { ...c, position, shape: { kind: 'rect', w, h } }
        : c,
    ),
  };
}

function updateColliderCircle(
  s: SceneModel | null,
  uid: string,
  position: Vec2,
  r: number,
): SceneModel | null {
  if (!s) return s;
  return {
    ...s,
    colliders: s.colliders.map((c) =>
      c.uid === uid && c.shape.kind === 'circle'
        ? { ...c, position, shape: { kind: 'circle', r } }
        : c,
    ),
  };
}

function colliderColor(c: SceneCollider, active: boolean): { stroke: string; fill: string } {
  // buildzone (kindomrush buildZones) → blue, blockers → red
  const k = c.kind?.toLowerCase() ?? '';
  let stroke = 'rgba(255, 90, 90, 0.95)'; // blocker default
  let fill = 'rgba(255, 90, 90, 0.18)';
  if (k.includes('buildzone') || k.includes('build_zone')) {
    stroke = 'rgba(120, 180, 255, 0.95)';
    fill = 'rgba(120, 180, 255, 0.18)';
  } else if (k.includes('water')) {
    stroke = 'rgba(120, 200, 255, 0.95)';
    fill = 'rgba(120, 200, 255, 0.18)';
  } else if (k === 'edge' || k.includes('boundary')) {
    stroke = 'rgba(220, 220, 220, 0.85)';
    fill = 'rgba(220, 220, 220, 0.08)';
  }
  if (!active) {
    // Dim when not in collider mode
    return {
      stroke: stroke.replace(/0\.95\)/, '0.55)').replace(/0\.85\)/, '0.45)'),
      fill: fill.replace(/0\.18\)/, '0.08)').replace(/0\.08\)/, '0.04)'),
    };
  }
  return { stroke, fill };
}

function drawCollider(
  ctx: CanvasRenderingContext2D,
  c: SceneCollider,
  active: boolean,
  selected: boolean,
  scale: number,
) {
  const { stroke, fill } = colliderColor(c, active);
  ctx.lineWidth = (selected ? 2 : 1.25) / scale;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;

  if (c.shape.kind === 'rect') {
    const r = rectFromCollider(c);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill();
    ctx.stroke();
    if (selected && c.editable) {
      drawHandle(ctx, r.x, r.y, scale);
      drawHandle(ctx, r.x + r.w, r.y, scale);
      drawHandle(ctx, r.x, r.y + r.h, scale);
      drawHandle(ctx, r.x + r.w, r.y + r.h, scale);
    }
  } else if (c.shape.kind === 'circle') {
    ctx.beginPath();
    ctx.arc(c.position.x, c.position.y, c.shape.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (selected && c.editable) {
      drawHandle(ctx, c.position.x + c.shape.r, c.position.y, scale);
    }
  } else {
    // polygon
    if (c.shape.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(c.shape.points[0].x, c.shape.points[0].y);
    for (let i = 1; i < c.shape.points.length; i++) {
      ctx.lineTo(c.shape.points[i].x, c.shape.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (selected) {
    // Label name above collider
    drawLabel(ctx, c.position.x, c.position.y, c.name, scale);
  }
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const r = HANDLE_RADIUS / scale;
  ctx.fillStyle = 'rgba(255, 200, 80, 1)';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.rect(x - r, y - r, r * 2, r * 2);
  ctx.fill();
  ctx.stroke();
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, scale: number) {
  const px = 11 / scale;
  ctx.font = `${px}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'bottom';
  const w = ctx.measureText(text).width;
  const padX = 4 / scale;
  const padY = 2 / scale;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - w / 2 - padX, y - px - padY * 2, w + padX * 2, px + padY * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(text, x - w / 2, y - padY);
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
  for (const c of s.colliders) {
    if (c.shape.kind === 'rect') {
      rects.push(rectFromCollider(c));
    } else if (c.shape.kind === 'circle') {
      rects.push({
        x: c.position.x - c.shape.r,
        y: c.position.y - c.shape.r,
        w: c.shape.r * 2,
        h: c.shape.r * 2,
      });
    } else if (c.shape.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of c.shape.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }
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

