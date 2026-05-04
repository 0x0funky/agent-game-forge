import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ColliderRef,
  CommentAnchor,
  CommentThread,
  LoadSceneResponse,
  SceneCollider,
  SceneImagePayload,
  SceneModel,
  SceneOp,
  ScenePath,
  SceneProp,
  SceneZone,
  Vec2,
  ZoneKind,
} from '@ogf/contracts';
import {
  applySceneOps,
  appendCommentMessage,
  createCommentThread,
  deleteCommentThread,
  fetchComments,
  fetchScene,
  updateCommentThread,
} from '../lib/api.js';
import { I } from './icons.js';

type EditMode = 'props' | 'colliders' | 'zones' | 'paths' | 'comments';
type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

interface UndoEntry {
  ops: SceneOp[];
  inverseOps: SceneOp[];
  /** Short label shown in tooltips. */
  label: string;
}

const MAX_UNDO = 200;

interface Props {
  projectPath: string;
  relPath: string;
  /** Bumped by App on Codex run end so the editor refetches the scene from
   *  disk after the agent edits files. Initial value 0 = no reload yet. */
  reloadKey?: number;
  /** Pre-fill the chat composer (used by comment threads' "Ask Codex"). */
  onAskCodex?: (text: string) => void;
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
  const [selectedZoneUid, setSelectedZoneUid] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<{ uid: string; pointIdx: number | null } | null>(null);
  const [mode, setMode] = useState<EditMode>('props');
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  /** When non-null, user is composing a brand-new thread at this anchor. */
  const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
  const [showResolvedThreads, setShowResolvedThreads] = useState(false);
  // Locked prop nodePaths — skipped by hit-test so the user can park
  // backgrounds / decorative tiles and keep clicking through them to the
  // real interactive props underneath. Persisted to localStorage per
  // (project + scene) so the lock state survives reloads + scene switches.
  const lockStorageKey = `ogf:locks:${props.projectPath}:${props.relPath}`;
  const [lockedNodePaths, setLockedNodePaths] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(lockStorageKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      // ignore corrupted entry
    }
    return new Set();
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        lockStorageKey,
        JSON.stringify([...lockedNodePaths]),
      );
    } catch {
      // localStorage full — ignore
    }
  }, [lockStorageKey, lockedNodePaths]);
  // Reset locks when switching scenes (different relPath = different set).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lockStorageKey);
      setLockedNodePaths(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setLockedNodePaths(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockStorageKey]);

  function toggleLock(nodePath: string) {
    setLockedNodePaths((prev) => {
      const next = new Set(prev);
      if (next.has(nodePath)) next.delete(nodePath);
      else next.add(nodePath);
      return next;
    });
    // Locking the currently-selected prop deselects it — there's no UX where
    // you'd want a locked prop to stay selected (selection implies you'll act
    // on it, but locked = ignored).
    if (selectedNodePath === nodePath) setSelectedNodePath(null);
  }

  // Threads visible in the side panel + as pins. Resolved hidden by default.
  const visibleThreads = useMemo(
    () => (showResolvedThreads ? threads : threads.filter((t) => t.status === 'open')),
    [threads, showResolvedThreads],
  );
  const resolvedCount = useMemo(
    () => threads.filter((t) => t.status === 'resolved').length,
    [threads],
  );

  // Undo / redo stacks. Stored in refs to avoid re-renders on every push;
  // we bump `undoTick` for the buttons + tooltips.
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const [undoTick, setUndoTick] = useState(0);
  const bumpUndoTick = useCallback(() => setUndoTick((n) => n + 1), []);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'error' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ scale: 0.5, panX: 0, panY: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraInitedRef = useRef(false);
  // Mirror of `scene` so window-level mouse handlers (attached on mousedown)
  // can read CURRENT state in onMouseUp instead of the stale closure value
  // captured at the start of the drag. Without this, drag-end never sees the
  // post-drag position and silently drops every commit.
  const sceneRef = useRef<SceneModel | null>(null);

  // -------- Load scene + decode images --------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScene(null);
    setSelectedNodePath(null);
    setSelectedColliderUid(null);
    setSelectedZoneUid(null);
    setSelectedPath(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    bumpUndoTick();
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

  // Keep sceneRef in sync with the latest scene state.
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  // -------- Fetch comment threads --------
  const refreshThreads = useCallback(async () => {
    try {
      const r = await fetchComments(props.projectPath, props.relPath);
      setThreads(r.threads);
    } catch {
      setThreads([]);
    }
  }, [props.projectPath, props.relPath]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads, props.reloadKey]);

  // -------- Soft refetch on external edit (Codex run end, file watcher, etc) --------
  // Preserves camera + selection (UX state) but clears undo stack since
  // external changes invalidate the inverse ops we tracked.
  const lastReloadKeyRef = useRef<number>(props.reloadKey ?? 0);
  useEffect(() => {
    const next = props.reloadKey ?? 0;
    if (next === lastReloadKeyRef.current) return;
    lastReloadKeyRef.current = next;
    if (next === 0) return; // no reload triggered yet
    // Don't interrupt an active drag — let the user finish first.
    if (dragRef.current) return;

    let cancelled = false;
    setSavingState('saving');
    fetchScene(props.projectPath, props.relPath)
      .then((r) => {
        if (cancelled) return;
        setScene(r.scene);
        void decodeImages(r).then((b) => {
          if (cancelled) return;
          setBank(b);
        });
        // External edits invalidate any pending inverse ops we held.
        undoStackRef.current = [];
        redoStackRef.current = [];
        bumpUndoTick();
        setSavingState('saved');
        window.setTimeout(() => {
          setSavingState((s) => (s === 'saved' ? 'idle' : s));
        }, 900);
      })
      .catch((err) => {
        if (cancelled) return;
        setSavingState('error');
        setSaveError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reloadKey]);

  // -------- Auto-dump .ogf/scene-context.json --------
  // Debounced 500ms — the agent reads this file on demand for spatial info.
  const contextDumpTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!scene) return;
    if (contextDumpTimerRef.current !== null) {
      window.clearTimeout(contextDumpTimerRef.current);
    }
    contextDumpTimerRef.current = window.setTimeout(() => {
      void dumpSceneContext(
        props.projectPath,
        scene,
        camera,
        containerRef.current,
        {
          selectedNodePath,
          selectedColliderUid,
          selectedZoneUid,
          selectedPath,
        },
      );
    }, 500);
    return () => {
      if (contextDumpTimerRef.current !== null) {
        window.clearTimeout(contextDumpTimerRef.current);
        contextDumpTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scene,
    camera.scale,
    camera.panX,
    camera.panY,
    selectedNodePath,
    selectedColliderUid,
    selectedZoneUid,
    selectedPath?.uid,
    selectedPath?.pointIdx,
    props.projectPath,
  ]);

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

    // Props — render in z_index order (lower draws first / further back).
    // Backgrounds typically have negative z (-10 / -20) so they sit behind.
    // Sprites without an explicit z_index get a fallback: huge centered=false
    // sprites (likely backdrops) push to -1 so they don't accidentally cover
    // all the gameplay props they share z=0 with.
    const sortedProps = scene.props
      .map((p, i) => ({
        p,
        i,
        z: p.zIndex ?? backdropFallbackZ(p, bank),
      }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    for (const { p } of sortedProps) {
      drawProp(
        ctx,
        p,
        bank,
        mode === 'props' && p.nodePath === selectedNodePath,
        camera.scale,
      );
    }

    // Colliders — always rendered, dimmed when not active.
    for (const c of scene.colliders) {
      drawCollider(
        ctx,
        c,
        mode === 'colliders',
        mode === 'colliders' && c.uid === selectedColliderUid,
        camera.scale,
      );
    }

    // Zones — always rendered, dimmed when not active.
    for (const z of scene.zones) {
      drawZone(
        ctx,
        z,
        mode === 'zones',
        mode === 'zones' && z.uid === selectedZoneUid,
        camera.scale,
      );
    }

    // Paths — always rendered, dimmed when not active.
    for (const p of scene.paths) {
      drawPath(
        ctx,
        p,
        mode === 'paths',
        mode === 'paths' && selectedPath?.uid === p.uid,
        mode === 'paths' && selectedPath?.uid === p.uid ? selectedPath.pointIdx : null,
        camera.scale,
      );
    }

    // Comment pins — only rendered while in comments mode.
    if (mode === 'comments') {
      // Highlight the node currently being drafted (if any).
      if (draftAnchor && draftAnchor.kind === 'node') {
        drawNodeHighlight(ctx, draftAnchor.nodePath, scene, bank, camera.scale);
      }
      // Pins for every visible thread + draft pin.
      for (const t of visibleThreads) {
        const at = anchorWorldPos(t.anchor, scene);
        if (!at) continue;
        drawCommentPin(
          ctx,
          at,
          t.status === 'resolved',
          true,
          t.id === selectedThreadId,
          camera.scale,
        );
      }
      if (draftAnchor) {
        const at = anchorWorldPos(draftAnchor, scene);
        if (at) drawCommentPin(ctx, at, false, true, true, camera.scale);
      }
    }

    ctx.restore();

    // HUD
    drawHud(ctx, cssW, cssH, camera);
  }, [
    scene,
    bank,
    camera,
    selectedNodePath,
    selectedColliderUid,
    selectedZoneUid,
    selectedPath,
    mode,
    visibleThreads,
    selectedThreadId,
    draftAnchor,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // -------- Mouse interaction --------

  type Bucket = 'colliders' | 'zones';
  type DragState =
    | { kind: 'pan'; startX: number; startY: number; startPan: Vec2 }
    | { kind: 'prop'; nodePath: string; startWorld: Vec2; startProp: Vec2 }
    | {
        kind: 'prop-scale';
        nodePath: string;
        corner: ResizeCorner;
        startWorld: Vec2;
        startScale: Vec2;
        /** Visual center of the prop in world space — scale pivots around this. */
        center: Vec2;
        /** Distance from cursor to center at drag start (used for ratio). */
        startDist: number;
      }
    | {
        kind: 'shape-move';
        bucket: Bucket;
        uid: string;
        ref: ColliderRef;
        startWorld: Vec2;
        startPos: Vec2;
      }
    | {
        kind: 'shape-resize-rect';
        bucket: Bucket;
        uid: string;
        ref: ColliderRef;
        corner: ResizeCorner;
        startWorld: Vec2;
        startPos: Vec2;
        startW: number;
        startH: number;
      }
    | {
        kind: 'shape-resize-circle';
        bucket: Bucket;
        uid: string;
        ref: ColliderRef;
        startWorld: Vec2;
        startCenter: Vec2;
        startR: number;
      }
    | {
        kind: 'path-point';
        uid: string;
        ref: ColliderRef;
        index: number;
        origin: Vec2;
        startWorld: Vec2;
        startPoint: Vec2;
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
    // Hit-test in REVERSE z-order: the visually-topmost prop wins. Without
    // this, clicking on a platform that overlaps a background would select
    // whichever appeared later in the array. Tie-break by smaller bbox
    // area — between two same-z props, the smaller is almost certainly the
    // foreground feature.
    // Locked props are skipped entirely so the user can park backgrounds.
    const candidates = scene.props
      .map((p, i) => ({ p, i, r: propBounds(p, bank) }))
      .filter(
        (e) =>
          e.r != null &&
          !lockedNodePaths.has(e.p.nodePath) &&
          world.x >= e.r.x &&
          world.x <= e.r.x + e.r.w &&
          world.y >= e.r.y &&
          world.y <= e.r.y + e.r.h,
      );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const za = a.p.zIndex ?? backdropFallbackZ(a.p, bank);
      const zb = b.p.zIndex ?? backdropFallbackZ(b.p, bank);
      if (za !== zb) return zb - za; // higher z first
      const aa = a.r!.w * a.r!.h;
      const ab = b.r!.w * b.r!.h;
      if (aa !== ab) return aa - ab; // smaller area first
      return b.i - a.i;              // last in array first (Godot draw order)
    });
    return candidates[0].p;
  }

  /** Hit-test the 4 corner handles of the currently selected prop. */
  function findPropResizeHandle(world: Vec2): { prop: SceneProp; corner: ResizeCorner } | null {
    if (!scene || mode !== 'props' || !selectedNodePath) return null;
    const p = scene.props.find((x) => x.nodePath === selectedNodePath);
    if (!p) return null;
    const r = propBounds(p, bank);
    if (!r) return null;
    const tol = (HANDLE_RADIUS + 2) / camera.scale;
    const corners: { name: ResizeCorner; pt: Vec2 }[] = [
      { name: 'tl', pt: { x: r.x, y: r.y } },
      { name: 'tr', pt: { x: r.x + r.w, y: r.y } },
      { name: 'bl', pt: { x: r.x, y: r.y + r.h } },
      { name: 'br', pt: { x: r.x + r.w, y: r.y + r.h } },
    ];
    for (const c of corners) {
      if (Math.abs(world.x - c.pt.x) <= tol && Math.abs(world.y - c.pt.y) <= tol) {
        return { prop: p, corner: c.name };
      }
    }
    return null;
  }

  function activeShapes(): { bucket: Bucket; items: (SceneCollider | SceneZone)[] } | null {
    if (!scene) return null;
    if (mode === 'colliders') return { bucket: 'colliders', items: scene.colliders };
    if (mode === 'zones') return { bucket: 'zones', items: scene.zones };
    return null;
  }

  function selectedShape(): { bucket: Bucket; item: SceneCollider | SceneZone } | null {
    if (!scene) return null;
    if (mode === 'colliders' && selectedColliderUid) {
      const item = scene.colliders.find((x) => x.uid === selectedColliderUid);
      if (item) return { bucket: 'colliders', item };
    }
    if (mode === 'zones' && selectedZoneUid) {
      const item = scene.zones.find((x) => x.uid === selectedZoneUid);
      if (item) return { bucket: 'zones', item };
    }
    return null;
  }

  function findShapeAt(world: Vec2): { bucket: Bucket; item: SceneCollider | SceneZone } | null {
    const active = activeShapes();
    if (!active) return null;
    for (let i = active.items.length - 1; i >= 0; i--) {
      const it = active.items[i];
      if (insideShape(world, it)) return { bucket: active.bucket, item: it };
    }
    return null;
  }

  /** Hit-test rect resize handles for the selected shape. */
  function findResizeHandle(world: Vec2): { uid: string; corner: ResizeCorner; bucket: Bucket } | null {
    const sel = selectedShape();
    if (!sel) return null;
    const c = sel.item;
    if (c.shape.kind !== 'rect' || !c.editable) return null;
    const r = rectFromShape(c);
    const corners: { name: ResizeCorner; p: Vec2 }[] = [
      { name: 'tl', p: { x: r.x, y: r.y } },
      { name: 'tr', p: { x: r.x + r.w, y: r.y } },
      { name: 'bl', p: { x: r.x, y: r.y + r.h } },
      { name: 'br', p: { x: r.x + r.w, y: r.y + r.h } },
    ];
    const tol = (HANDLE_RADIUS + 2) / camera.scale;
    for (const cor of corners) {
      if (Math.abs(world.x - cor.p.x) <= tol && Math.abs(world.y - cor.p.y) <= tol) {
        return { uid: c.uid, corner: cor.name, bucket: sel.bucket };
      }
    }
    return null;
  }

  function findPathPointAt(world: Vec2): { path: ScenePath; index: number } | null {
    if (!scene) return null;
    const tol = (HANDLE_RADIUS + 2) / camera.scale;
    for (let i = scene.paths.length - 1; i >= 0; i--) {
      const p = scene.paths[i];
      for (let j = 0; j < p.points.length; j++) {
        const wx = p.origin.x + p.points[j].x;
        const wy = p.origin.y + p.points[j].y;
        if (Math.abs(world.x - wx) <= tol && Math.abs(world.y - wy) <= tol) {
          return { path: p, index: j };
        }
      }
    }
    return null;
  }

  function findPathSegmentAt(world: Vec2): { uid: string } | null {
    if (!scene) return null;
    const tol = 6 / camera.scale;
    for (let i = scene.paths.length - 1; i >= 0; i--) {
      const p = scene.paths[i];
      for (let j = 0; j < p.points.length - 1; j++) {
        const a = { x: p.origin.x + p.points[j].x, y: p.origin.y + p.points[j].y };
        const b = { x: p.origin.x + p.points[j + 1].x, y: p.origin.y + p.points[j + 1].y };
        if (distancePointToSegment(world, a, b) <= tol) {
          return { uid: p.uid };
        }
      }
    }
    return null;
  }

  function findCircleRadiusHandle(world: Vec2): { uid: string; bucket: Bucket } | null {
    const sel = selectedShape();
    if (!sel) return null;
    const c = sel.item;
    if (c.shape.kind !== 'circle' || !c.editable) return null;
    const handle = { x: c.position.x + c.shape.r, y: c.position.y };
    const tol = (HANDLE_RADIUS + 2) / camera.scale;
    if (Math.abs(world.x - handle.x) <= tol && Math.abs(world.y - handle.y) <= tol) {
      return { uid: c.uid, bucket: sel.bucket };
    }
    return null;
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!scene) return;
    // Take focus away from any input so window-level keyboard shortcuts (undo,
    // delete, etc.) start firing immediately. Without this, focus is sticky on
    // the chat textarea after the user typed there last.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const w = clientToWorld(e);

    // ----- Comments mode -----
    if (mode === 'comments' && e.button === 0 && !e.altKey) {
      // 1) Hit-test existing visible pins
      const hit = findCommentPinAt(w, visibleThreads, scene);
      if (hit) {
        setSelectedThreadId(hit.id);
        setDraftAnchor(null);
        dragRef.current = {
          kind: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          startPan: { x: camera.panX, y: camera.panY },
        };
        attachWindowDrag();
        return;
      }
      // 2) Click on canvas — figure out if there's a node here. Shift forces a
      //    point anchor regardless.
      let anchor: CommentAnchor;
      if (e.shiftKey) {
        anchor = { kind: 'point', x: Math.round(w.x), y: Math.round(w.y) };
      } else {
        anchor = pickAnchorAt(w, scene);
      }
      setSelectedThreadId(null);
      setDraftAnchor(anchor);
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPan: { x: camera.panX, y: camera.panY },
      };
      attachWindowDrag();
      return;
    }

    // ----- Paths mode -----
    if (mode === 'paths' && e.button === 0 && !e.altKey) {
      const hit = findPathPointAt(w);
      if (hit) {
        setSelectedPath({ uid: hit.path.uid, pointIdx: hit.index });
        const worldPt = {
          x: hit.path.origin.x + hit.path.points[hit.index].x,
          y: hit.path.origin.y + hit.path.points[hit.index].y,
        };
        dragRef.current = {
          kind: 'path-point',
          uid: hit.path.uid,
          ref: hit.path.ref,
          index: hit.index,
          origin: hit.path.origin,
          startWorld: w,
          startPoint: worldPt,
        };
        attachWindowDrag();
        return;
      }
      // Clicked a path body (segment) → select it but don't drag
      const pathHit = findPathSegmentAt(w);
      if (pathHit) {
        setSelectedPath({ uid: pathHit.uid, pointIdx: null });
      } else {
        setSelectedPath(null);
      }
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPan: { x: camera.panX, y: camera.panY },
      };
      attachWindowDrag();
      return;
    }

    // ----- Shape modes (colliders or zones) -----
    if ((mode === 'colliders' || mode === 'zones') && e.button === 0 && !e.altKey) {
      // 1) Resize handle on selected rect?
      const handle = findResizeHandle(w);
      if (handle) {
        const list = handle.bucket === 'colliders' ? scene.colliders : scene.zones;
        const c = list.find((x) => x.uid === handle.uid);
        if (c && c.shape.kind === 'rect') {
          const r = rectFromShape(c);
          dragRef.current = {
            kind: 'shape-resize-rect',
            bucket: handle.bucket,
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
      // 2) Circle radius handle?
      const circleHandle = findCircleRadiusHandle(w);
      if (circleHandle) {
        const list = circleHandle.bucket === 'colliders' ? scene.colliders : scene.zones;
        const c = list.find((x) => x.uid === circleHandle.uid);
        if (c && c.shape.kind === 'circle') {
          dragRef.current = {
            kind: 'shape-resize-circle',
            bucket: circleHandle.bucket,
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
      // 3) Hit-test body
      const hit = findShapeAt(w);
      if (hit) {
        if (hit.bucket === 'colliders') setSelectedColliderUid(hit.item.uid);
        else setSelectedZoneUid(hit.item.uid);
        if (hit.item.editable) {
          dragRef.current = {
            kind: 'shape-move',
            bucket: hit.bucket,
            uid: hit.item.uid,
            ref: hit.item.ref,
            startWorld: w,
            startPos: { ...hit.item.position },
          };
        } else {
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
      if (mode === 'colliders') setSelectedColliderUid(null);
      else setSelectedZoneUid(null);
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
    if (e.button === 0 && !e.altKey) {
      // 1) Resize handle on selected prop?
      const handle = findPropResizeHandle(w);
      if (handle) {
        const center = {
          x: handle.prop.position.x + handle.prop.spriteOffset.x,
          y: handle.prop.position.y + handle.prop.spriteOffset.y,
        };
        const dx = w.x - center.x;
        const dy = w.y - center.y;
        const startDist = Math.hypot(dx, dy);
        if (startDist > 1) {
          dragRef.current = {
            kind: 'prop-scale',
            nodePath: handle.prop.nodePath,
            corner: handle.corner,
            startWorld: w,
            startScale: { ...handle.prop.scale },
            center,
            startDist,
          };
          attachWindowDrag();
          return;
        }
      }
      // 2) Body of any prop?
      const hit = findPropAt(w);
      if (hit && !e.shiftKey) {
        setSelectedNodePath(hit.nodePath);
        dragRef.current = {
          kind: 'prop',
          nodePath: hit.nodePath,
          startWorld: w,
          startProp: { ...hit.position },
        };
        attachWindowDrag();
        return;
      }
      if (!hit) setSelectedNodePath(null);
    }
    dragRef.current = {
      kind: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      startPan: { x: camera.panX, y: camera.panY },
    };
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
    if (ds.kind === 'prop-scale') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.center.x;
      const dy = w.y - ds.center.y;
      const dist = Math.hypot(dx, dy);
      const ratio = Math.max(0.02, dist / ds.startDist);
      // Hold Alt for non-uniform (independent X/Y).
      let nextScale: Vec2;
      if (ev.altKey) {
        const startDx = ds.startWorld.x - ds.center.x;
        const startDy = ds.startWorld.y - ds.center.y;
        const ratioX = startDx === 0 ? 1 : dx / startDx;
        const ratioY = startDy === 0 ? 1 : dy / startDy;
        nextScale = {
          x: Math.max(0.02, ds.startScale.x * ratioX),
          y: Math.max(0.02, ds.startScale.y * ratioY),
        };
      } else {
        nextScale = {
          x: ds.startScale.x * ratio,
          y: ds.startScale.y * ratio,
        };
      }
      setScene((s) =>
        s
          ? {
              ...s,
              props: s.props.map((p) =>
                p.nodePath === ds.nodePath ? { ...p, scale: nextScale } : p,
              ),
            }
          : s,
      );
      return;
    }
    if (ds.kind === 'shape-move') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.startWorld.x;
      const dy = w.y - ds.startWorld.y;
      const snap = !ev.shiftKey;
      const pos = {
        x: snap ? Math.round(ds.startPos.x + dx) : ds.startPos.x + dx,
        y: snap ? Math.round(ds.startPos.y + dy) : ds.startPos.y + dy,
      };
      setScene((s) => updateShapePosition(s, ds.bucket, ds.uid, pos));
      return;
    }
    if (ds.kind === 'shape-resize-rect') {
      const w = clientToWorld(ev);
      const r = resizedRect(ds.corner, ds.startPos, ds.startW, ds.startH, w);
      const snap = !ev.shiftKey;
      const newW = Math.max(2, snap ? Math.round(r.w) : r.w);
      const newH = Math.max(2, snap ? Math.round(r.h) : r.h);
      const newCenter = { x: r.x + newW / 2, y: r.y + newH / 2 };
      setScene((s) => updateShapeRect(s, ds.bucket, ds.uid, newCenter, newW, newH));
      return;
    }
    if (ds.kind === 'shape-resize-circle') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.startCenter.x;
      const dy = w.y - ds.startCenter.y;
      const snap = !ev.shiftKey;
      let r = Math.sqrt(dx * dx + dy * dy);
      if (snap) r = Math.round(r);
      r = Math.max(2, r);
      setScene((s) => updateShapeCircle(s, ds.bucket, ds.uid, ds.startCenter, r));
      return;
    }
    if (ds.kind === 'path-point') {
      const w = clientToWorld(ev);
      const dx = w.x - ds.startWorld.x;
      const dy = w.y - ds.startWorld.y;
      const snap = !ev.shiftKey;
      // Convert world delta back to node-local point.
      const localX = ds.startPoint.x - ds.origin.x + dx;
      const localY = ds.startPoint.y - ds.origin.y + dy;
      const next = {
        x: snap ? Math.round(localX) : localX,
        y: snap ? Math.round(localY) : localY,
      };
      setScene((s) => updatePathPoint(s, ds.uid, ds.index, next));
      return;
    }
  }

  function onMouseUp() {
    const ds = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    // CRITICAL: read from sceneRef, not the closure `scene`. The closure was
    // captured at mousedown time and never sees the post-drag updates.
    const live = sceneRef.current;
    if (!live || !ds) return;

    if (ds.kind === 'prop') {
      const moved = live.props.find((p) => p.nodePath === ds.nodePath);
      if (
        moved &&
        (moved.position.x !== ds.startProp.x || moved.position.y !== ds.startProp.y)
      ) {
        // Web-backed props carry a ref so the daemon writes to JSON instead
        // of trying to find a (non-existent) .tscn node.
        const ref = moved.ref;
        commitOps(
          [{ kind: 'move-prop', nodePath: ds.nodePath, position: moved.position, ref }],
          [{ kind: 'move-prop', nodePath: ds.nodePath, position: ds.startProp, ref }],
          `move ${ds.nodePath.split('/').pop() ?? ds.nodePath}`,
        );
      }
      return;
    }
    if (ds.kind === 'prop-scale') {
      const cur = live.props.find((p) => p.nodePath === ds.nodePath);
      if (
        cur &&
        (cur.scale.x !== ds.startScale.x || cur.scale.y !== ds.startScale.y)
      ) {
        // Web props are JSON-backed and need ref so the daemon writes back
        // to the right array (props / platforms / pickups / hazards / ...).
        // Without ref, applyOpsToJsonScene rejects with 'needs a json-backed
        // ref' and the user sees a save failure.
        const ref = cur.ref;
        commitOps(
          [{ kind: 'scale-prop', nodePath: ds.nodePath, scale: cur.scale, ref }],
          [{ kind: 'scale-prop', nodePath: ds.nodePath, scale: ds.startScale, ref }],
          `scale ${ds.nodePath.split('/').pop() ?? ds.nodePath}`,
        );
      }
      return;
    }
    if (ds.kind === 'shape-move') {
      const list = ds.bucket === 'colliders' ? live.colliders : live.zones;
      const cur = list.find((c) => c.uid === ds.uid);
      if (
        cur &&
        (cur.position.x !== ds.startPos.x || cur.position.y !== ds.startPos.y)
      ) {
        commitOps(
          [{ kind: 'move-collider', ref: ds.ref, position: cur.position }],
          [{ kind: 'move-collider', ref: ds.ref, position: ds.startPos }],
          `move ${cur.name ?? ds.bucket}`,
        );
      }
      return;
    }
    if (ds.kind === 'shape-resize-rect') {
      const list = ds.bucket === 'colliders' ? live.colliders : live.zones;
      const cur = list.find((c) => c.uid === ds.uid);
      if (cur && cur.shape.kind === 'rect') {
        const fwd: SceneOp[] = [];
        const inv: SceneOp[] = [];
        const sizeChanged = cur.shape.w !== ds.startW || cur.shape.h !== ds.startH;
        const oldCenter: Vec2 = {
          x: ds.startPos.x + ds.startW / 2,
          y: ds.startPos.y + ds.startH / 2,
        };
        const moved =
          cur.position.x !== oldCenter.x || cur.position.y !== oldCenter.y;
        if (sizeChanged) {
          fwd.push({
            kind: 'resize-rect-collider',
            ref: ds.ref,
            w: cur.shape.w,
            h: cur.shape.h,
          });
          inv.push({
            kind: 'resize-rect-collider',
            ref: ds.ref,
            w: ds.startW,
            h: ds.startH,
          });
        }
        if (moved) {
          fwd.push({ kind: 'move-collider', ref: ds.ref, position: cur.position });
          inv.push({ kind: 'move-collider', ref: ds.ref, position: oldCenter });
        }
        commitOps(fwd, inv, `resize ${cur.name ?? ds.bucket}`);
      }
      return;
    }
    if (ds.kind === 'shape-resize-circle') {
      const list = ds.bucket === 'colliders' ? live.colliders : live.zones;
      const cur = list.find((c) => c.uid === ds.uid);
      if (cur && cur.shape.kind === 'circle' && cur.shape.r !== ds.startR) {
        commitOps(
          [{ kind: 'resize-circle-collider', ref: ds.ref, r: cur.shape.r }],
          [{ kind: 'resize-circle-collider', ref: ds.ref, r: ds.startR }],
          `resize ${cur.name ?? ds.bucket}`,
        );
      }
      return;
    }
    if (ds.kind === 'path-point') {
      const cur = live.paths.find((p) => p.uid === ds.uid);
      if (!cur) return;
      const pt = cur.points[ds.index];
      const local: Vec2 = {
        x: ds.startPoint.x - ds.origin.x,
        y: ds.startPoint.y - ds.origin.y,
      };
      if (pt.x !== local.x || pt.y !== local.y) {
        commitOps(
          [{ kind: 'move-path-point', ref: ds.ref, index: ds.index, position: pt }],
          [{ kind: 'move-path-point', ref: ds.ref, index: ds.index, position: local }],
          `move ${cur.name ?? 'path'}[${ds.index}]`,
        );
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
    // Short debounce: just enough to batch a couple of drag-end commits in
    // the same frame, but tight enough that a 'click drag, immediately
    // switch tab' sequence still flushes BEFORE the unmount-and-remount
    // race lets loadScene re-fetch stale .tscn. Was 220ms which lost edits
    // when users navigated away fast.
    saveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 50);
  }

  // On unmount (tab switch / scene switch), force any pending ops to disk
  // synchronously. Without this, a debounce timer firing AFTER unmount races
  // with the next mount's loadScene — daemon serves the still-stale .tscn,
  // user sees their edit reverted.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingOpsRef.current.length > 0) {
        // Fire-and-forget — we can't await in a cleanup but the fetch is
        // already in-flight, and React's next render of this surface will
        // re-fetch (loadScene) which serializes after the write at the
        // daemon level.
        void flushSave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Forward = ops to send to daemon (also applied locally already by drag).
   *  Inverse = ops that, applied to current state, would revert the forward. */
  function commitOps(forward: SceneOp[], inverse: SceneOp[], label: string) {
    if (forward.length === 0) return;
    for (const op of forward) scheduleSave(op);
    undoStackRef.current.push({ ops: forward, inverseOps: inverse, label });
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    redoStackRef.current = [];
    bumpUndoTick();
  }

  function undo() {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    setScene((s) => applyOpsToScene(s, entry.inverseOps));
    for (const op of entry.inverseOps) scheduleSave(op);
    redoStackRef.current.push(entry);
    bumpUndoTick();
  }

  function redo() {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    setScene((s) => applyOpsToScene(s, entry.ops));
    for (const op of entry.ops) scheduleSave(op);
    undoStackRef.current.push(entry);
    bumpUndoTick();
  }

  // Keyboard shortcuts — Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y for redo.
  // The blur-on-mousedown above is the real fix for "Ctrl+Z stuck on chat
  // textarea after typing". This handler bails when an editable element is
  // focused so the user's normal typing-undo still works there.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;

      const active = document.activeElement as HTMLElement | null;
      const inEditable =
        !!active &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) || active.isContentEditable);
      if (inEditable) return;

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const selectedZone = useMemo(
    () => scene?.zones.find((z) => z.uid === selectedZoneUid) ?? null,
    [scene, selectedZoneUid],
  );

  // -------- Render UI --------

  return (
    <div className="inspector">
      <div className="crumbs">
        <span>{props.relPath}</span>
        {scene && <span className="badge-dim">{scene.props.length} props</span>}
        {scene && <span className="badge-dim">{scene.colliders.length} colliders</span>}
        {scene && <span className="badge-dim">{scene.zones.length} zones</span>}
        {scene && <span className="badge-dim">{scene.paths.length} paths</span>}
        {threads.filter((t) => t.status === 'open').length > 0 && (
          <span className="badge-dim" style={{ color: 'var(--accent)' }}>
            💬 {threads.filter((t) => t.status === 'open').length} open
          </span>
        )}
        {scene?.background && (
          <span className="badge-dim">
            {scene.background.source === 'tilemap-preview' ? 'tilemap (preview)' : 'image bg'}
          </span>
        )}
        <span className="actions">
          <UndoRedo
            tick={undoTick}
            undoStack={undoStackRef.current}
            redoStack={redoStackRef.current}
            onUndo={undo}
            onRedo={redo}
          />
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
          data-mode={mode}
          onMouseDown={onMouseDown}
          onWheel={onWheel}
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--bg-0)',
            cursor:
              dragRef.current?.kind === 'pan'
                ? 'grabbing'
                : mode === 'comments'
                ? 'crosshair'
                : 'default',
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
          {mode === 'comments' && draftAnchor && scene && (
            <CommentPopover
              anchor={draftAnchor}
              screenPos={anchorScreenPos(draftAnchor, scene, camera, containerRef.current)}
              onCancel={() => setDraftAnchor(null)}
              onSubmit={async (text) => {
                try {
                  const r = await createCommentThread({
                    projectPath: props.projectPath,
                    scene: props.relPath,
                    anchor: draftAnchor,
                    text,
                  });
                  setDraftAnchor(null);
                  setSelectedThreadId(r.thread.id);
                  await refreshThreads();
                } catch {
                  // best-effort
                }
              }}
            />
          )}
        </div>
        <ScenePanel
          scene={scene}
          mode={mode}
          selectedProp={selectedProp}
          selectedCollider={selectedCollider}
          selectedZone={selectedZone}
          selectedPath={selectedPath}
          threads={visibleThreads}
          resolvedCount={resolvedCount}
          showResolved={showResolvedThreads}
          onToggleShowResolved={() => setShowResolvedThreads((v) => !v)}
          selectedThreadId={selectedThreadId}
          projectPath={props.projectPath}
          scenePath={props.relPath}
          onSelectProp={setSelectedNodePath}
          onSelectCollider={setSelectedColliderUid}
          onSelectZone={setSelectedZoneUid}
          onSelectPath={(uid) => setSelectedPath(uid ? { uid, pointIdx: null } : null)}
          onSelectThread={(id) => {
            setSelectedThreadId(id);
            setDraftAnchor(null);
          }}
          onAppendMessage={async (threadId, text) => {
            try {
              await appendCommentMessage(threadId, {
                projectPath: props.projectPath,
                text,
              });
              await refreshThreads();
            } catch {
              /* ignore */
            }
          }}
          onResolveThread={async (threadId, resolved) => {
            try {
              await updateCommentThread(threadId, {
                projectPath: props.projectPath,
                status: resolved ? 'resolved' : 'open',
              });
              await refreshThreads();
            } catch {
              /* ignore */
            }
          }}
          onDeleteThread={async (threadId) => {
            try {
              await deleteCommentThread(threadId, props.projectPath);
              if (selectedThreadId === threadId) setSelectedThreadId(null);
              await refreshThreads();
            } catch {
              /* ignore */
            }
          }}
          onAskCodex={(thread, draftMsg) => {
            const promptText = buildAskCodexPrompt(thread, draftMsg);
            props.onAskCodex?.(promptText);
          }}
          lockedNodePaths={lockedNodePaths}
          onToggleLock={toggleLock}
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
  selectedZone,
  selectedPath,
  threads,
  resolvedCount,
  showResolved,
  onToggleShowResolved,
  selectedThreadId,
  onSelectProp,
  onSelectCollider,
  onSelectZone,
  onSelectPath,
  onSelectThread,
  onAppendMessage,
  onResolveThread,
  onDeleteThread,
  onAskCodex,
  lockedNodePaths,
  onToggleLock,
}: {
  scene: SceneModel | null;
  mode: EditMode;
  selectedProp: SceneProp | null;
  selectedCollider: SceneCollider | null;
  selectedZone: SceneZone | null;
  selectedPath: { uid: string; pointIdx: number | null } | null;
  threads: CommentThread[];
  resolvedCount: number;
  showResolved: boolean;
  onToggleShowResolved: () => void;
  selectedThreadId: string | null;
  projectPath: string;
  scenePath: string;
  onSelectProp: (path: string | null) => void;
  onSelectCollider: (uid: string | null) => void;
  onSelectZone: (uid: string | null) => void;
  onSelectPath: (uid: string | null) => void;
  onSelectThread: (id: string | null) => void;
  onAppendMessage: (threadId: string, text: string) => void;
  onResolveThread: (threadId: string, resolved: boolean) => void;
  onDeleteThread: (threadId: string) => void;
  onAskCodex: (thread: CommentThread, latestMsg?: string) => void;
  lockedNodePaths: Set<string>;
  onToggleLock: (nodePath: string) => void;
}) {
  const selPath = scene?.paths.find((p) => p.uid === selectedPath?.uid) ?? null;
  const selThread = threads.find((t) => t.id === selectedThreadId) ?? null;
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
            {scene?.props.map((p) => {
              const locked = lockedNodePaths.has(p.nodePath);
              return (
                <div
                  key={p.nodePath}
                  className={`scene-prop-item ${selectedProp?.nodePath === p.nodePath ? 'active' : ''} ${locked ? 'locked' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!locked) onSelectProp(p.nodePath);
                  }}
                >
                  <span className="mono">{p.name}</span>
                  <span className="muted mono">
                    {Math.round(p.position.x)},{Math.round(p.position.y)}
                  </span>
                  <button
                    type="button"
                    className={`scene-prop-lock ${locked ? 'on' : ''}`}
                    title={locked ? 'Unlock — clicks pass through to this' : 'Lock — block clicks on this prop'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLock(p.nodePath);
                    }}
                  >
                    {locked ? '🔒' : '🔓'}
                  </button>
                </div>
              );
            })}
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

      {mode === 'zones' && (
        <div className="scene-panel-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="scene-panel-title">Zones</div>
          <div className="scene-panel-list">
            {scene?.zones.map((z) => (
              <button
                key={z.uid}
                className={`scene-prop-item ${selectedZone?.uid === z.uid ? 'active' : ''}`}
                onClick={() => onSelectZone(z.uid)}
                title={z.editable ? '' : 'Read-only'}
              >
                <span className="mono">
                  {zoneIcon(z.zoneKind)} {z.name}
                </span>
                <span className="muted mono">{z.zoneKind}</span>
              </button>
            ))}
            {scene && scene.zones.length === 0 && (
              <div className="muted" style={{ padding: 8 }}>
                No zones in this scene.
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'zones' && selectedZone && (
        <div className="scene-panel-section">
          <div className="scene-panel-title">Selected zone</div>
          <div className="scene-panel-row">
            <span className="muted">name</span>
            <span className="mono">{selectedZone.name}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">kind</span>
            <span className="mono">{selectedZone.zoneKind}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">shape</span>
            <span className="mono">{selectedZone.shape.kind}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">center</span>
            <span className="mono">
              ({Math.round(selectedZone.position.x)}, {Math.round(selectedZone.position.y)})
            </span>
          </div>
          {selectedZone.shape.kind === 'rect' && (
            <div className="scene-panel-row">
              <span className="muted">size</span>
              <span className="mono">
                {Math.round(selectedZone.shape.w)} × {Math.round(selectedZone.shape.h)}
              </span>
            </div>
          )}
          {selectedZone.shape.kind === 'circle' && (
            <div className="scene-panel-row">
              <span className="muted">radius</span>
              <span className="mono">{Math.round(selectedZone.shape.r)}</span>
            </div>
          )}
          {Object.entries(selectedZone.fields).length > 0 && (
            <>
              <div className="scene-panel-title sub">fields</div>
              {Object.entries(selectedZone.fields).map(([k, v]) => (
                <div className="scene-panel-row" key={k}>
                  <span className="muted">{k}</span>
                  <span className="mono">{String(v)}</span>
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

      {mode === 'comments' && !selThread && (
        <div className="scene-panel-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="scene-panel-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1 }}>Comments</span>
            {resolvedCount > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={onToggleShowResolved}
                title={showResolved ? 'Hide resolved threads' : 'Show resolved threads too'}
                style={{ fontSize: 10, padding: '2px 6px' }}
              >
                {showResolved ? `hide ${resolvedCount} resolved` : `${resolvedCount} resolved`}
              </button>
            )}
          </div>
          <div className="scene-panel-list">
            {threads.length === 0 ? (
              <div className="muted" style={{ padding: 8, lineHeight: 1.5 }}>
                Click on a prop / collider / zone to attach a comment to it.
                Click empty canvas for a free pin. Hold Shift to force a free pin.
              </div>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  className={`scene-prop-item ${selectedThreadId === t.id ? 'active' : ''}`}
                  onClick={() => onSelectThread(t.id)}
                  style={t.status === 'resolved' ? { opacity: 0.6 } : undefined}
                >
                  <span
                    className="mono"
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.anchor.kind === 'node' ? t.anchor.nodePath : undefined}
                  >
                    {t.status === 'resolved' ? '✓' : '💬'}
                    {t.anchor.kind === 'node' ? ' ⚓' : ''}{' '}
                    {t.messages[0]?.text.slice(0, 36) ?? '(empty)'}
                  </span>
                  <span className="muted mono" style={{ fontSize: 10 }}>
                    {t.messages.length}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {mode === 'comments' && selThread && (
        <CommentThreadPanel
          thread={selThread}
          onBack={() => onSelectThread(null)}
          onAppend={(text) => onAppendMessage(selThread.id, text)}
          onResolve={(resolved) => onResolveThread(selThread.id, resolved)}
          onDelete={() => onDeleteThread(selThread.id)}
          onAskCodex={(draftMsg) => onAskCodex(selThread, draftMsg)}
        />
      )}

      {mode === 'paths' && (
        <div className="scene-panel-section" style={{ flex: 1, minHeight: 0 }}>
          <div className="scene-panel-title">Paths</div>
          <div className="scene-panel-list">
            {scene?.paths.map((p) => (
              <button
                key={p.uid}
                className={`scene-prop-item ${selectedPath?.uid === p.uid ? 'active' : ''}`}
                onClick={() => onSelectPath(p.uid)}
                title={p.hasBezierHandles ? 'Has bezier handles — straight-line edits preserve them' : ''}
              >
                <span className="mono">⌒ {p.name}</span>
                <span className="muted mono">{p.points.length} pts</span>
              </button>
            ))}
            {scene && scene.paths.length === 0 && (
              <div className="muted" style={{ padding: 8 }}>No Path2D nodes in this scene.</div>
            )}
          </div>
        </div>
      )}

      {mode === 'paths' && selPath && (
        <div className="scene-panel-section">
          <div className="scene-panel-title">Selected path</div>
          <div className="scene-panel-row">
            <span className="muted">name</span>
            <span className="mono">{selPath.name}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">points</span>
            <span className="mono">{selPath.points.length}</span>
          </div>
          <div className="scene-panel-row">
            <span className="muted">origin</span>
            <span className="mono">
              ({Math.round(selPath.origin.x)}, {Math.round(selPath.origin.y)})
            </span>
          </div>
          {selPath.hasBezierHandles && (
            <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
              Bezier handles preserved — straight-line drag only.
            </div>
          )}
          {selectedPath?.pointIdx !== null && selectedPath?.pointIdx !== undefined && (
            <div className="scene-panel-row">
              <span className="muted">point #{selectedPath.pointIdx}</span>
              <span className="mono">
                ({Math.round(selPath.points[selectedPath.pointIdx]?.x ?? 0)},{' '}
                {Math.round(selPath.points[selectedPath.pointIdx]?.y ?? 0)})
              </span>
            </div>
          )}
        </div>
      )}

      <div className="scene-panel-foot muted">
        {mode === 'props'
          ? 'Drag a prop to move. Drag empty space to pan. Wheel to zoom. Shift = sub-pixel.'
          : mode === 'colliders'
          ? 'Click a collider to select. Drag body to move, drag corner/handle to resize.'
          : mode === 'zones'
          ? 'Click a zone to select. Drag body to move, drag corner/handle to resize.'
          : mode === 'paths'
          ? 'Click a path to select; drag any point to move it. Bezier handles are kept.'
          : 'Click a node → anchored pin. Click empty canvas → free pin. Shift = always free. "Ask Codex" sends thread context to chat.'}
      </div>
    </aside>
  );
}

function CommentPopover({
  anchor,
  screenPos,
  onCancel,
  onSubmit,
}: {
  anchor: CommentAnchor;
  screenPos: { x: number; y: number } | null;
  onCancel: () => void;
  onSubmit: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus textarea on mount, listen for Esc / Cmd+Enter.
  useEffect(() => {
    taRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const v = taRef.current?.value.trim();
        if (v && !submitting) {
          setSubmitting(true);
          void Promise.resolve(onSubmit(v)).finally(() => setSubmitting(false));
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onSubmit, submitting]);

  if (!screenPos) return null;

  // Offset from the pin so the popover doesn't cover the click point.
  const left = screenPos.x + 16;
  const top = screenPos.y + 16;

  return (
    <div
      className="comment-popover"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="comment-popover-head">
        {anchor.kind === 'node' ? (
          <span className="mono" title={anchor.nodePath}>
            ⚓ {anchor.nodePath.split('/').pop()}
          </span>
        ) : (
          <span className="mono">
            ◉ ({Math.round(anchor.x)}, {Math.round(anchor.y)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="comment-popover-x" onClick={onCancel} title="Cancel (Esc)">
          ×
        </button>
      </div>
      <textarea
        ref={taRef}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What about this?"
        className="comment-textarea"
      />
      <div className="comment-popover-foot">
        <span className="muted">⌘⏎ post · Esc cancel</span>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-sm btn-primary"
          disabled={!text.trim() || submitting}
          onClick={() => {
            const v = text.trim();
            if (v && !submitting) {
              setSubmitting(true);
              void Promise.resolve(onSubmit(v)).finally(() => setSubmitting(false));
            }
          }}
        >
          Post
        </button>
      </div>
    </div>
  );
}

interface CameraLite {
  scale: number;
  panX: number;
  panY: number;
}

/** World coords of the anchor → CSS-pixel offset within the canvas wrap. */
function anchorScreenPos(
  anchor: CommentAnchor,
  scene: SceneModel,
  camera: CameraLite,
  wrap: HTMLDivElement | null,
): { x: number; y: number } | null {
  void wrap; // wrap reserved in case we ever want to clamp inside
  const world = anchorWorldPos(anchor, scene);
  if (!world) return null;
  return {
    x: (world.x - camera.panX) * camera.scale,
    y: (world.y - camera.panY) * camera.scale,
  };
}

function CommentThreadPanel({
  thread,
  onBack,
  onAppend,
  onResolve,
  onDelete,
  onAskCodex,
}: {
  thread: CommentThread;
  onBack: () => void;
  onAppend: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onAskCodex: (latestMsg?: string) => void;
}) {
  const [reply, setReply] = useState('');
  return (
    <div className="scene-panel-section" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="scene-panel-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="btn btn-sm btn-ghost" onClick={onBack} title="Back to list">‹</button>
        <span style={{ flex: 1 }}>Thread</span>
        <button
          className="btn btn-sm btn-ghost"
          title={thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
          onClick={() => onResolve(thread.status !== 'resolved')}
        >
          {thread.status === 'resolved' ? '↺' : '✓'}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          style={{ color: 'var(--red)' }}
          title="Delete thread"
          onClick={onDelete}
        >
          ×
        </button>
      </div>
      <div className="scene-panel-row">
        <span className="muted">at</span>
        <span className="mono">{describeAnchor(thread.anchor)}</span>
      </div>
      <div className="comment-messages">
        {thread.messages.map((m) => (
          <div
            key={m.id}
            className={`comment-msg comment-msg-${m.author}`}
          >
            <div className="comment-msg-meta">
              <span>{m.author}</span>
              <span className="muted">{relativeTime(m.ts)}</span>
            </div>
            <div className="comment-msg-text">{m.text}</div>
          </div>
        ))}
      </div>
      <textarea
        rows={3}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Reply to this thread…"
        className="comment-textarea"
      />
      <div className="comment-buttons">
        <button
          className="btn btn-sm"
          onClick={() => onAskCodex(reply.trim() ? reply.trim() : undefined)}
          title="Send thread context to chat composer"
        >
          Ask Codex
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-sm btn-primary"
          disabled={!reply.trim()}
          onClick={() => {
            if (reply.trim()) {
              onAppend(reply.trim());
              setReply('');
            }
          }}
        >
          Reply
        </button>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ============= Scene context dump =============

interface SelectionSnapshot {
  selectedNodePath: string | null;
  selectedColliderUid: string | null;
  selectedZoneUid: string | null;
  selectedPath: { uid: string; pointIdx: number | null } | null;
}

async function dumpSceneContext(
  projectPath: string,
  scene: SceneModel,
  camera: { scale: number; panX: number; panY: number },
  containerEl: HTMLDivElement | null,
  sel: SelectionSnapshot,
): Promise<void> {
  // Compute viewport in world coords from the canvas size + camera.
  const viewport = (() => {
    if (!containerEl) return undefined;
    const w = containerEl.clientWidth / camera.scale;
    const h = containerEl.clientHeight / camera.scale;
    return {
      x: Math.round(camera.panX),
      y: Math.round(camera.panY),
      w: Math.round(w),
      h: Math.round(h),
    };
  })();

  let selected: unknown = null;
  if (sel.selectedNodePath) {
    const p = scene.props.find((x) => x.nodePath === sel.selectedNodePath);
    if (p) {
      selected = {
        kind: 'prop',
        nodePath: p.nodePath,
        name: p.name,
        position: p.position,
        scale: p.scale,
        texture: p.texture,
      };
    }
  } else if (sel.selectedColliderUid) {
    const c = scene.colliders.find((x) => x.uid === sel.selectedColliderUid);
    if (c) {
      selected = {
        kind: 'collider',
        nodePath:
          c.ref.backend === 'tscn' ? c.ref.nodePath : `${c.ref.relPath}#${c.ref.id}`,
        name: c.name,
        position: c.position,
        shape: c.shape,
        zoneKind: c.kind,
      };
    }
  } else if (sel.selectedZoneUid) {
    const z = scene.zones.find((x) => x.uid === sel.selectedZoneUid);
    if (z) {
      selected = {
        kind: 'zone',
        nodePath:
          z.ref.backend === 'tscn' ? z.ref.nodePath : `${z.ref.relPath}#${z.ref.id}`,
        name: z.name,
        position: z.position,
        shape: z.shape,
        zoneKind: z.zoneKind,
      };
    }
  } else if (sel.selectedPath) {
    const pa = scene.paths.find((x) => x.uid === sel.selectedPath!.uid);
    if (pa) {
      const idx = sel.selectedPath.pointIdx;
      const pt = idx !== null && idx !== undefined ? pa.points[idx] : null;
      selected = {
        kind: 'path-point',
        nodePath: pa.ref.backend === 'tscn' ? pa.ref.nodePath : '',
        name: pa.name,
        position: pt
          ? { x: pa.origin.x + pt.x, y: pa.origin.y + pt.y }
          : pa.origin,
        pointIndex: idx ?? undefined,
      };
    }
  }

  const payload = {
    version: 1,
    updatedAt: Date.now(),
    project: { path: projectPath, engine: 'godot' },
    scene: {
      relPath: scene.scenePath,
      rootName: scene.rootName,
      background: scene.background,
    },
    selected,
    viewport,
    props: scene.props.map((p) => ({
      nodePath: p.nodePath,
      name: p.name,
      position: p.position,
      scale: p.scale,
      texture: p.texture,
    })),
    colliders: scene.colliders.map((c) => ({
      nodePath: c.ref.backend === 'tscn' ? c.ref.nodePath : undefined,
      name: c.name,
      kind: c.kind,
      position: c.position,
      shape: c.shape,
    })),
    zones: scene.zones.map((z) => ({
      name: z.name,
      zoneKind: z.zoneKind,
      position: z.position,
      shape: z.shape,
      fields: z.fields,
    })),
    // Paths can have many points; include ALL points (the agent often needs
    // them for collision-vs-path logic) but flag pointCount up front so the
    // model can decide whether to skim.
    paths: scene.paths.map((pa) => ({
      name: pa.name,
      origin: pa.origin,
      pointCount: pa.points.length,
      samplePoints: pa.points,
    })),
    stats: {
      props: scene.props.length,
      colliders: scene.colliders.length,
      zones: scene.zones.length,
      paths: scene.paths.length,
    },
  };

  try {
    await fetch('/api/scenes/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, content: payload }),
    });
  } catch {
    // best-effort — context dump is not critical for editor function
  }
}

// ============= Comment helpers =============

/** Resolve a thread's anchor to a world point. Returns null when the anchored
 *  node is missing and no fallback was stored. */
function anchorWorldPos(anchor: CommentAnchor, scene: SceneModel): Vec2 | null {
  if (anchor.kind === 'point') return { x: anchor.x, y: anchor.y };
  // node anchor — look up in props/colliders/zones/paths
  const np = anchor.nodePath;
  const prop = scene.props.find((p) => p.nodePath === np);
  if (prop) return { x: prop.position.x, y: prop.position.y };
  const col = scene.colliders.find((c) => c.ref.backend === 'tscn' && c.ref.nodePath === np);
  if (col) return col.position;
  const zone = scene.zones.find((z) => z.ref.backend === 'tscn' && z.ref.nodePath === np);
  if (zone) return zone.position;
  return anchor.fallback ?? null;
}

const PIN_RADIUS_PX = 9;

function drawCommentPin(
  ctx: CanvasRenderingContext2D,
  at: Vec2,
  resolved: boolean,
  active: boolean,
  selected: boolean,
  scale: number,
) {
  const r = (selected ? PIN_RADIUS_PX + 2 : PIN_RADIUS_PX) / scale;
  const fill = resolved
    ? 'rgba(140, 230, 200, 0.85)'
    : active
    ? 'rgba(255, 130, 90, 1)'
    : 'rgba(255, 130, 90, 0.65)';

  // Drop shadow
  ctx.beginPath();
  ctx.arc(at.x, at.y + r * 0.15, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = (selected ? 2.5 : 1.5) / scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.stroke();

  // Inner dot to look like a comment indicator
  ctx.beginPath();
  ctx.arc(at.x, at.y, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();
}

function findCommentPinAt(
  world: Vec2,
  threads: CommentThread[],
  scene: SceneModel,
): CommentThread | null {
  // Use a generous hit area in world space — pins look small at low zoom.
  const tol = 14; // world px
  for (let i = threads.length - 1; i >= 0; i--) {
    const t = threads[i];
    const at = anchorWorldPos(t.anchor, scene);
    if (!at) continue;
    if (Math.hypot(world.x - at.x, world.y - at.y) <= tol) return t;
  }
  return null;
}

function describeAnchor(anchor: CommentAnchor): string {
  if (anchor.kind === 'node') return `node ${anchor.nodePath}`;
  return `point (${Math.round(anchor.x)}, ${Math.round(anchor.y)})`;
}

/** Outline the node a comment-draft is anchored to, so the user has visual
 *  confirmation of what they're attaching to. */
function drawNodeHighlight(
  ctx: CanvasRenderingContext2D,
  nodePath: string,
  scene: SceneModel,
  bank: ImageBank,
  scale: number,
): void {
  // Try props first
  const prop = scene.props.find((p) => p.nodePath === nodePath);
  if (prop) {
    const r = propBounds(prop, bank);
    if (r) {
      strokeHighlight(ctx, r.x, r.y, r.w, r.h, scale);
    }
    return;
  }
  const col = scene.colliders.find(
    (c) => c.ref.backend === 'tscn' && c.ref.nodePath === nodePath,
  );
  if (col) {
    if (col.shape.kind === 'rect') {
      const r = rectFromShape(col);
      strokeHighlight(ctx, r.x, r.y, r.w, r.h, scale);
    } else if (col.shape.kind === 'circle') {
      strokeHighlightCircle(ctx, col.position.x, col.position.y, col.shape.r, scale);
    }
    return;
  }
  const zone = scene.zones.find(
    (z) => z.ref.backend === 'tscn' && z.ref.nodePath === nodePath,
  );
  if (zone) {
    if (zone.shape.kind === 'rect') {
      const r = rectFromShape(zone);
      strokeHighlight(ctx, r.x, r.y, r.w, r.h, scale);
    } else if (zone.shape.kind === 'circle') {
      strokeHighlightCircle(ctx, zone.position.x, zone.position.y, zone.shape.r, scale);
    } else if (zone.shape.kind === 'point') {
      strokeHighlightCircle(ctx, zone.position.x, zone.position.y, 12, scale);
    }
  }
}

function strokeHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.lineWidth = 4 / scale;
  ctx.strokeStyle = 'rgba(255, 130, 90, 0.55)';
  ctx.strokeRect(x - 2 / scale, y - 2 / scale, w + 4 / scale, h + 4 / scale);
  ctx.lineWidth = 2 / scale;
  ctx.strokeStyle = 'rgba(255, 130, 90, 1)';
  ctx.strokeRect(x, y, w, h);
}

function strokeHighlightCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  scale: number,
): void {
  ctx.lineWidth = 4 / scale;
  ctx.strokeStyle = 'rgba(255, 130, 90, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2 / scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2 / scale;
  ctx.strokeStyle = 'rgba(255, 130, 90, 1)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** When clicking in comments mode, prefer attaching to whatever node is under
 *  the cursor (so the pin follows when the node moves). Falls back to a free
 *  world point. */
function pickAnchorAt(world: Vec2, scene: SceneModel): CommentAnchor {
  // Props (top-most logical layer)
  for (let i = scene.props.length - 1; i >= 0; i--) {
    const p = scene.props[i];
    // Cheap AABB based on scale-aware bounds (we'd need bank to be exact, but
    // the click point is good enough as a hint — we use a generous radius).
    const dx = world.x - (p.position.x + p.spriteOffset.x);
    const dy = world.y - (p.position.y + p.spriteOffset.y);
    if (Math.hypot(dx, dy) <= 60) {
      return {
        kind: 'node',
        nodePath: p.nodePath,
        fallback: { x: p.position.x, y: p.position.y },
      };
    }
  }
  // Colliders (.tscn-resident only — JSON-backed don't have node paths)
  for (let i = scene.colliders.length - 1; i >= 0; i--) {
    const c = scene.colliders[i];
    if (c.ref.backend !== 'tscn') continue;
    if (insideShape(world, c)) {
      return {
        kind: 'node',
        nodePath: c.ref.nodePath,
        fallback: { x: c.position.x, y: c.position.y },
      };
    }
  }
  // Zones
  for (let i = scene.zones.length - 1; i >= 0; i--) {
    const z = scene.zones[i];
    if (z.ref.backend !== 'tscn') continue;
    if (insideShape(world, z)) {
      return {
        kind: 'node',
        nodePath: z.ref.nodePath,
        fallback: { x: z.position.x, y: z.position.y },
      };
    }
  }
  return { kind: 'point', x: Math.round(world.x), y: Math.round(world.y) };
}

function buildAskCodexPrompt(thread: CommentThread, latestUserMsg?: string): string {
  const lines: string[] = [];
  lines.push(`[OGF comment thread on ${thread.scene}]`);
  lines.push(`Anchor: ${describeAnchor(thread.anchor)}`);
  if (thread.messages.length > 0) {
    lines.push('Thread so far:');
    for (const m of thread.messages) {
      lines.push(`  ${m.author}: ${m.text}`);
    }
  }
  lines.push('');
  if (latestUserMsg) {
    lines.push(latestUserMsg);
  } else {
    lines.push('Please review the thread above and help with what the user is asking.');
  }
  return lines.join('\n');
}

function zoneIcon(kind: ZoneKind): string {
  if (kind === 'encounter') return '✦';
  if (kind === 'exit') return '⤴';
  if (kind === 'spawn') return '◆';
  if (kind === 'marker') return '◉';
  return '?';
}

function UndoRedo({
  tick,
  undoStack,
  redoStack,
  onUndo,
  onRedo,
}: {
  tick: number;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  onUndo: () => void;
  onRedo: () => void;
}) {
  void tick;
  const undoLabel = undoStack[undoStack.length - 1]?.label;
  const redoLabel = redoStack[redoStack.length - 1]?.label;
  return (
    <span className="scene-undoredo">
      <button
        className="btn btn-sm btn-ghost"
        disabled={undoStack.length === 0}
        onClick={onUndo}
        title={undoLabel ? `Undo: ${undoLabel}  (Ctrl+Z)` : 'Nothing to undo'}
      >
        ↶
      </button>
      <button
        className="btn btn-sm btn-ghost"
        disabled={redoStack.length === 0}
        onClick={onRedo}
        title={redoLabel ? `Redo: ${redoLabel}  (Ctrl+Shift+Z)` : 'Nothing to redo'}
      >
        ↷
      </button>
    </span>
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
      <button
        role="tab"
        aria-selected={mode === 'zones'}
        onClick={() => setMode('zones')}
        className={`scene-mode-btn ${mode === 'zones' ? 'active' : ''}`}
        title="Edit gameplay zones (encounter / exit / spawn)"
      >
        zones
      </button>
      <button
        role="tab"
        aria-selected={mode === 'paths'}
        onClick={() => setMode('paths')}
        className={`scene-mode-btn ${mode === 'paths' ? 'active' : ''}`}
        title="Edit Path2D points"
      >
        paths
      </button>
      <button
        role="tab"
        aria-selected={mode === 'comments'}
        onClick={() => setMode('comments')}
        className={`scene-mode-btn ${mode === 'comments' ? 'active' : ''}`}
        title="Comment threads pinned to the canvas"
      >
        comments
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

// ============= Local mirror of daemon ops =============
// Used by undo/redo to roll the SceneModel forward or backward without a
// round-trip. Must stay in sync with apps/daemon/src/scenes.ts:applyOps.

function sameRef(a: ColliderRef, b: ColliderRef): boolean {
  if (a.backend === 'tscn' && b.backend === 'tscn') {
    return a.nodePath === b.nodePath && a.subResourceId === b.subResourceId;
  }
  if (a.backend === 'json' && b.backend === 'json') {
    return a.relPath === b.relPath && a.section === b.section && a.id === b.id;
  }
  return false;
}

function applyOpsToScene(s: SceneModel | null, ops: SceneOp[]): SceneModel | null {
  if (!s) return s;
  let next = s;
  for (const op of ops) next = applyOpToScene(next, op);
  return next;
}

function applyOpToScene(s: SceneModel, op: SceneOp): SceneModel {
  if (op.kind === 'move-prop') {
    return {
      ...s,
      props: s.props.map((p) =>
        p.nodePath === op.nodePath ? { ...p, position: op.position } : p,
      ),
    };
  }
  if (op.kind === 'scale-prop') {
    return {
      ...s,
      props: s.props.map((p) =>
        p.nodePath === op.nodePath ? { ...p, scale: op.scale } : p,
      ),
    };
  }
  if (op.kind === 'move-collider') {
    const ci = s.colliders.findIndex((c) => sameRef(c.ref, op.ref));
    if (ci >= 0) {
      return {
        ...s,
        colliders: s.colliders.map((c, i) => (i === ci ? { ...c, position: op.position } : c)),
      };
    }
    const zi = s.zones.findIndex((z) => sameRef(z.ref, op.ref));
    if (zi >= 0) {
      return {
        ...s,
        zones: s.zones.map((z, i) => (i === zi ? { ...z, position: op.position } : z)),
      };
    }
    return s;
  }
  if (op.kind === 'resize-rect-collider') {
    const ci = s.colliders.findIndex((c) => sameRef(c.ref, op.ref));
    if (ci >= 0) {
      return {
        ...s,
        colliders: s.colliders.map((c, i) =>
          i === ci && c.shape.kind === 'rect'
            ? { ...c, shape: { kind: 'rect', w: op.w, h: op.h } }
            : c,
        ),
      };
    }
    const zi = s.zones.findIndex((z) => sameRef(z.ref, op.ref));
    if (zi >= 0) {
      return {
        ...s,
        zones: s.zones.map((z, i) =>
          i === zi && z.shape.kind === 'rect'
            ? { ...z, shape: { kind: 'rect', w: op.w, h: op.h } }
            : z,
        ),
      };
    }
    return s;
  }
  if (op.kind === 'resize-circle-collider') {
    const ci = s.colliders.findIndex((c) => sameRef(c.ref, op.ref));
    if (ci >= 0) {
      return {
        ...s,
        colliders: s.colliders.map((c, i) =>
          i === ci && c.shape.kind === 'circle' ? { ...c, shape: { kind: 'circle', r: op.r } } : c,
        ),
      };
    }
    const zi = s.zones.findIndex((z) => sameRef(z.ref, op.ref));
    if (zi >= 0) {
      return {
        ...s,
        zones: s.zones.map((z, i) =>
          i === zi && z.shape.kind === 'circle' ? { ...z, shape: { kind: 'circle', r: op.r } } : z,
        ),
      };
    }
    return s;
  }
  if (op.kind === 'move-path-point') {
    return {
      ...s,
      paths: s.paths.map((p) =>
        sameRef(p.ref, op.ref)
          ? { ...p, points: p.points.map((pt, i) => (i === op.index ? op.position : pt)) }
          : p,
      ),
    };
  }
  return s;
}

// ============= Collider helpers =============

type AnyShape = SceneCollider | SceneZone;

function rectFromShape(c: AnyShape): { x: number; y: number; w: number; h: number } {
  if (c.shape.kind !== 'rect') return { x: c.position.x, y: c.position.y, w: 0, h: 0 };
  return {
    x: c.position.x - c.shape.w / 2,
    y: c.position.y - c.shape.h / 2,
    w: c.shape.w,
    h: c.shape.h,
  };
}

function insideShape(p: Vec2, c: AnyShape): boolean {
  if (c.shape.kind === 'rect') {
    const r = rectFromShape(c);
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }
  if (c.shape.kind === 'circle') {
    const dx = p.x - c.position.x;
    const dy = p.y - c.position.y;
    return dx * dx + dy * dy <= c.shape.r * c.shape.r;
  }
  if (c.shape.kind === 'polygon') {
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
  // 'point' — small hit radius around the marker
  const dx = p.x - c.position.x;
  const dy = p.y - c.position.y;
  return dx * dx + dy * dy <= 12 * 12;
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

function updateShapePosition(
  s: SceneModel | null,
  bucket: 'colliders' | 'zones',
  uid: string,
  position: Vec2,
): SceneModel | null {
  if (!s) return s;
  if (bucket === 'colliders') {
    return {
      ...s,
      colliders: s.colliders.map((c) => (c.uid === uid ? { ...c, position } : c)),
    };
  }
  return {
    ...s,
    zones: s.zones.map((z) => (z.uid === uid ? { ...z, position } : z)),
  };
}

function updateShapeRect(
  s: SceneModel | null,
  bucket: 'colliders' | 'zones',
  uid: string,
  position: Vec2,
  w: number,
  h: number,
): SceneModel | null {
  if (!s) return s;
  if (bucket === 'colliders') {
    return {
      ...s,
      colliders: s.colliders.map((c) =>
        c.uid === uid && c.shape.kind === 'rect'
          ? { ...c, position, shape: { kind: 'rect', w, h } }
          : c,
      ),
    };
  }
  return {
    ...s,
    zones: s.zones.map((z) =>
      z.uid === uid && z.shape.kind === 'rect'
        ? { ...z, position, shape: { kind: 'rect', w, h } }
        : z,
    ),
  };
}

function updateShapeCircle(
  s: SceneModel | null,
  bucket: 'colliders' | 'zones',
  uid: string,
  position: Vec2,
  r: number,
): SceneModel | null {
  if (!s) return s;
  if (bucket === 'colliders') {
    return {
      ...s,
      colliders: s.colliders.map((c) =>
        c.uid === uid && c.shape.kind === 'circle'
          ? { ...c, position, shape: { kind: 'circle', r } }
          : c,
      ),
    };
  }
  return {
    ...s,
    zones: s.zones.map((z) =>
      z.uid === uid && z.shape.kind === 'circle'
        ? { ...z, position, shape: { kind: 'circle', r } }
        : z,
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
  drawShape(ctx, c, colliderColor(c, active), selected, scale);
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  z: SceneZone,
  active: boolean,
  selected: boolean,
  scale: number,
) {
  drawShape(ctx, z, zoneColor(z.zoneKind, active), selected, scale);
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  c: AnyShape,
  colors: { stroke: string; fill: string },
  selected: boolean,
  scale: number,
) {
  ctx.lineWidth = (selected ? 2 : 1.25) / scale;
  ctx.strokeStyle = colors.stroke;
  ctx.fillStyle = colors.fill;

  if (c.shape.kind === 'rect') {
    const r = rectFromShape(c);
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
  } else if (c.shape.kind === 'polygon') {
    if (c.shape.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(c.shape.points[0].x, c.shape.points[0].y);
    for (let i = 1; i < c.shape.points.length; i++) {
      ctx.lineTo(c.shape.points[i].x, c.shape.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // 'point' — diamond marker
    const s = 8 / scale;
    ctx.beginPath();
    ctx.moveTo(c.position.x, c.position.y - s);
    ctx.lineTo(c.position.x + s, c.position.y);
    ctx.lineTo(c.position.x, c.position.y + s);
    ctx.lineTo(c.position.x - s, c.position.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (selected) {
    drawLabel(ctx, c.position.x, c.position.y, c.name, scale);
  }
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  path: ScenePath,
  active: boolean,
  selected: boolean,
  selectedIdx: number | null,
  scale: number,
) {
  if (path.points.length === 0) return;

  const lineColor = active
    ? selected
      ? 'rgba(255, 220, 100, 1)'
      : 'rgba(255, 220, 100, 0.85)'
    : 'rgba(255, 220, 100, 0.4)';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = (selected ? 2.5 : 1.5) / scale;
  ctx.beginPath();
  for (let i = 0; i < path.points.length; i++) {
    const wx = path.origin.x + path.points[i].x;
    const wy = path.origin.y + path.points[i].y;
    if (i === 0) ctx.moveTo(wx, wy);
    else ctx.lineTo(wx, wy);
  }
  ctx.stroke();

  if (active) {
    for (let i = 0; i < path.points.length; i++) {
      const wx = path.origin.x + path.points[i].x;
      const wy = path.origin.y + path.points[i].y;
      const isSel = selected && selectedIdx === i;
      const r = (isSel ? HANDLE_RADIUS + 2 : HANDLE_RADIUS) / scale;
      ctx.fillStyle = isSel ? 'rgba(255, 200, 80, 1)' : 'rgba(20, 20, 20, 0.9)';
      ctx.strokeStyle = isSel ? 'rgba(0,0,0,0.7)' : lineColor;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (selected) {
    drawLabel(ctx, path.origin.x + path.points[0].x, path.origin.y + path.points[0].y, path.name, scale);
  }
}

function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

function updatePathPoint(
  s: SceneModel | null,
  uid: string,
  index: number,
  point: Vec2,
): SceneModel | null {
  if (!s) return s;
  return {
    ...s,
    paths: s.paths.map((p) =>
      p.uid === uid
        ? { ...p, points: p.points.map((pt, i) => (i === index ? point : pt)) }
        : p,
    ),
  };
}

function zoneColor(kind: ZoneKind, active: boolean): { stroke: string; fill: string } {
  let stroke = 'rgba(180, 140, 255, 0.95)'; // unknown / default
  let fill = 'rgba(180, 140, 255, 0.16)';
  if (kind === 'encounter') {
    stroke = 'rgba(220, 140, 220, 0.95)'; // pink/magenta
    fill = 'rgba(220, 140, 220, 0.18)';
  } else if (kind === 'exit') {
    stroke = 'rgba(140, 230, 200, 0.95)'; // teal
    fill = 'rgba(140, 230, 200, 0.18)';
  } else if (kind === 'spawn') {
    stroke = 'rgba(255, 220, 100, 1)'; // yellow
    fill = 'rgba(255, 220, 100, 0.55)';
  } else if (kind === 'marker') {
    stroke = 'rgba(120, 200, 255, 0.95)'; // cyan/blue — script-driven editor handles
    fill = 'rgba(120, 200, 255, 0.18)';
  }
  if (!active) {
    return {
      stroke: stroke.replace(/0\.95\)/, '0.5)').replace(/1\)/, '0.55)'),
      fill: fill.replace(/0\.18\)/, '0.06)').replace(/0\.16\)/, '0.06)').replace(/0\.55\)/, '0.18)'),
    };
  }
  return { stroke, fill };
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

/** Best-effort z-index when the prop's .tscn didn't specify one. We default
 *  big centered=false sprites to -1 so backdrops don't accidentally cover
 *  game props they share z=0 with. Anything else stays at 0. */
function backdropFallbackZ(p: SceneProp, bank: ImageBank): number {
  if (p.centered !== false) return 0;
  const size = p.texture ? bank.sizes.get(p.texture) : null;
  if (!size) return 0;
  // Heuristic: 'big' = covers > ~80% of either dimension of a typical level
  // viewport (roughly 1280x720). A platform sprite that's centered=false
  // with size 600x100 doesn't qualify; a 1280x720 background does.
  if (size.w >= 1024 || size.h >= 576) return -1;
  return 0;
}

function propBounds(p: SceneProp, bank: ImageBank) {
  // Web props carry an explicit displaySize from the JSON (their declared
  // w/h). Godot props rely on naturalSize × scale.
  // For BOTH backends, we still multiply by scale so a live resize drag
  // (which mutates p.scale in React state until commit) produces visible
  // growth. After commit the daemon writes the new w/h back, the loader
  // re-emits with scale = 1, so the visual stays put.
  const size = p.texture ? bank.sizes.get(p.texture) : null;
  let w: number;
  let h: number;
  if (p.displaySize) {
    w = p.displaySize.x * Math.abs(p.scale.x);
    h = p.displaySize.y * Math.abs(p.scale.y);
  } else if (size) {
    w = size.w * Math.abs(p.scale.x);
    h = size.h * Math.abs(p.scale.y);
  } else {
    return null;
  }
  // Sprite2D's anchor depends on the `centered` attribute:
  //   centered = true (default) → position = render center → bbox = (cx-w/2, cy-h/2, w, h)
  //   centered = false          → position = top-left      → bbox = (cx, cy, w, h)
  // Without honoring this, big background sprites that Codex sets to
  // centered=false (per OGF Godot conventions) appear shifted up-left by
  // (w/2, h/2) in the OGF Scenes tab while Play renders them correctly.
  const ax = p.position.x + p.spriteOffset.x;
  const ay = p.position.y + p.spriteOffset.y;
  if (p.centered === false) {
    return { x: ax, y: ay, w, h };
  }
  return { x: ax - w / 2, y: ay - h / 2, w, h };
}

/** Color for the border of a non-default-props section. Lets the user tell
 *  platforms vs pickups vs hazards apart at a glance without clicking. The
 *  default 'props' section gets no tint (returns null) — it's the neutral
 *  decoration layer and a border on every prop would be visual noise. */
function sectionTint(section: string | undefined): string | null {
  if (!section || section === 'props') return null;
  // Stable color palette by section name. Common platformer / metroidvania
  // entity types get explicit colors; anything else hashes into a fallback.
  const FIXED: Record<string, string> = {
    platforms: 'rgba(96, 165, 250, 0.95)',     // blue
    pickups: 'rgba(110, 231, 142, 0.95)',      // green
    hazards: 'rgba(248, 113, 113, 0.95)',      // red
    enemies: 'rgba(232, 125, 232, 0.95)',      // magenta
    enemySpawns: 'rgba(232, 125, 232, 0.95)',  // magenta (alias)
    doors: 'rgba(251, 191, 36, 0.95)',         // amber
    checkpoints: 'rgba(165, 180, 252, 0.95)',  // indigo
    decorations: 'rgba(180, 180, 180, 0.85)',  // gray
  };
  if (FIXED[section]) return FIXED[section];
  // Fallback: deterministic hue from name hash so the same section always
  // gets the same color across reloads.
  let h = 0;
  for (let i = 0; i < section.length; i++) h = (h * 31 + section.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 65%, 65%)`;
}

function drawProp(
  ctx: CanvasRenderingContext2D,
  p: SceneProp,
  bank: ImageBank,
  selected: boolean,
  scale = 1,
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

  // Section tint: thin colored border + tiny label tab in the top-left so the
  // user can tell which array the entry came from (platforms / pickups / ...).
  // Only drawn for non-default sections. Hidden when the prop is selected so
  // the bright yellow selection outline remains the visual focus.
  const sectionName =
    p.ref && p.ref.backend === 'json' ? p.ref.section : undefined;
  const tint = sectionTint(sectionName);
  if (tint && !selected) {
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = tint;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    // Section label tab — small, only readable when zoomed in. Doesn't
    // distract at low zoom but is there when needed.
    if (scale >= 0.6 && sectionName) {
      const label = sectionName;
      ctx.font = `${10 / scale}px ui-monospace, Menlo, monospace`;
      const metrics = ctx.measureText(label);
      const padX = 4 / scale;
      const padY = 2 / scale;
      const tabW = metrics.width + padX * 2;
      const tabH = 14 / scale;
      ctx.fillStyle = tint;
      ctx.fillRect(r.x, r.y - tabH, tabW, tabH);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.textBaseline = 'top';
      ctx.fillText(label, r.x + padX, r.y - tabH + padY);
    }
  }

  // Origin marker (small cross at the parent Node2D position)
  drawCross(
    ctx,
    p.position.x,
    p.position.y,
    selected ? 'rgba(255, 220, 100, 1)' : 'rgba(255,255,255,0.4)',
  );

  if (selected) {
    // Bright outline — outer glow + inner solid stroke for visibility on
    // both light and dark backgrounds.
    ctx.lineWidth = 4 / scale;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = 'rgba(255, 220, 100, 1)';
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // Resize handles at the 4 corners.
    drawHandle(ctx, r.x, r.y, scale);
    drawHandle(ctx, r.x + r.w, r.y, scale);
    drawHandle(ctx, r.x, r.y + r.h, scale);
    drawHandle(ctx, r.x + r.w, r.y + r.h, scale);
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
  for (const p of s.paths) {
    if (p.points.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of p.points) {
      const wx = p.origin.x + pt.x;
      const wy = p.origin.y + pt.y;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  for (const c of [...s.colliders, ...s.zones]) {
    if (c.shape.kind === 'rect') {
      rects.push(rectFromShape(c));
    } else if (c.shape.kind === 'circle') {
      rects.push({
        x: c.position.x - c.shape.r,
        y: c.position.y - c.shape.r,
        w: c.shape.r * 2,
        h: c.shape.r * 2,
      });
    } else if (c.shape.kind === 'polygon' && c.shape.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of c.shape.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    } else if (c.shape.kind === 'point') {
      rects.push({ x: c.position.x - 8, y: c.position.y - 8, w: 16, h: 16 });
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

