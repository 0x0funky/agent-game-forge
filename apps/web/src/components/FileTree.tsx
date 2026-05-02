import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { EngineKind, FileNode } from '@ogf/contracts';
import { I } from './icons.js';

export type TreeFilter = 'assets' | 'code' | 'all';

interface Props {
  tree: FileNode | null;
  selected: string | null;
  onSelect: (relPath: string, fileKind: FileNode['fileKind']) => void;
  onNewFile?: () => void;
  onRefresh?: () => void;
  recentlyChanged?: Set<string>;
  /** Set of relative paths that are referenced from somewhere in the project. */
  usedAssets?: Set<string>;
  filter?: TreeFilter;
  engine?: EngineKind;
  /** Stable identifier (project path) — used to scope localStorage of folder-open state. */
  scopeKey?: string;
}

const CODE_EXT_BY_ENGINE: Record<EngineKind, Set<string>> = {
  godot: new Set(['gd', 'gdshader', 'gdshaderinc']),
  unity: new Set(['cs', 'shader', 'compute', 'cginc']),
  web: new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte']),
  unknown: new Set(['gd', 'cs', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go']),
};

export function FileTree(props: Props) {
  const filter = props.filter ?? 'all';
  const engine = props.engine ?? 'unknown';
  const lsKey = props.scopeKey ? `ogf:openFolders:${props.scopeKey}` : null;
  const usedOnlyKey = props.scopeKey ? `ogf:usedOnly:${props.scopeKey}` : null;

  const [usedOnly, setUsedOnly] = useState<boolean>(() => {
    if (!usedOnlyKey) return false;
    return localStorage.getItem(usedOnlyKey) === '1';
  });
  useEffect(() => {
    if (!usedOnlyKey) return;
    localStorage.setItem(usedOnlyKey, usedOnly ? '1' : '0');
  }, [usedOnly, usedOnlyKey]);
  // Reset when scope changes
  useEffect(() => {
    if (!usedOnlyKey) {
      setUsedOnly(false);
      return;
    }
    setUsedOnly(localStorage.getItem(usedOnlyKey) === '1');
  }, [usedOnlyKey]);

  // Toggle is only meaningful when we have a usedAssets set and we're in assets/all view
  const usedOnlyAvailable = !!props.usedAssets && filter !== 'code';
  const effectiveUsedOnly = usedOnly && usedOnlyAvailable;

  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    if (!lsKey) return new Set();
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });

  // Reset open state when scope (project) changes
  useEffect(() => {
    if (!lsKey) {
      setOpenFolders(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(lsKey);
      setOpenFolders(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setOpenFolders(new Set());
    }
  }, [lsKey]);

  // Persist on change
  useEffect(() => {
    if (!lsKey) return;
    try {
      localStorage.setItem(lsKey, JSON.stringify([...openFolders]));
    } catch {
      /* ignore */
    }
  }, [openFolders, lsKey]);

  // Auto-open ancestors of selected file (so jumping to a usage opens the path)
  useEffect(() => {
    if (!props.selected) return;
    setOpenFolders((prev) => {
      const next = new Set(prev);
      const parts = props.selected!.split('/').filter(Boolean);
      let cur = '';
      let added = false;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = cur ? `${cur}/${parts[i]}` : parts[i];
        if (!next.has(cur)) {
          next.add(cur);
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [props.selected]);

  const toggleFolder = (rel: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  };

  const fileCount = useMemo(
    () => (props.tree ? countVisible(props.tree, filter, engine, effectiveUsedOnly, props.usedAssets) : 0),
    [props.tree, filter, engine, effectiveUsedOnly, props.usedAssets],
  );

  return (
    <div className="tree-pane">
      <div className="tree-head">
        <span>{filter === 'code' ? 'Code' : filter === 'assets' ? 'Assets' : 'Project'}</span>
        <span style={{ flex: 1 }} />
        {usedOnlyAvailable && (
          <button
            className={`icon-btn${effectiveUsedOnly ? ' active' : ''}`}
            onClick={() => setUsedOnly((v) => !v)}
            aria-pressed={effectiveUsedOnly}
            title={effectiveUsedOnly ? 'Showing only used · click to show all' : 'Show only used assets'}
          >
            {effectiveUsedOnly ? I.check : I.view}
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => setOpenFolders(new Set())}
          title="Collapse all"
        >
          ⇲
        </button>
        {props.onNewFile && (
          <button className="icon-btn" onClick={props.onNewFile} title="New file">
            {I.plus}
          </button>
        )}
        {props.onRefresh && (
          <button className="icon-btn" onClick={props.onRefresh} title="Refresh">
            {I.refresh}
          </button>
        )}
      </div>
      <div className="tree" role="tree">
        {!props.tree && <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 11 }}>Loading…</div>}
        {props.tree && (
          <Node
            node={props.tree}
            depth={0}
            selected={props.selected}
            onSelect={props.onSelect}
            recentlyChanged={props.recentlyChanged}
            usedAssets={props.usedAssets}
            filter={filter}
            engine={engine}
            openFolders={openFolders}
            toggleFolder={toggleFolder}
            usedOnly={effectiveUsedOnly}
            isRoot
          />
        )}
      </div>
      <div className="tree-foot">
        <span>{fileCount} files{effectiveUsedOnly ? ' (used only)' : ''}</span>
        <span style={{ flex: 1 }} />
        {props.usedAssets && filter !== 'code' && !effectiveUsedOnly && (
          <span style={{ color: 'var(--ink-3)' }}>· {props.usedAssets.size} used</span>
        )}
      </div>
    </div>
  );
}

function Node(props: {
  node: FileNode;
  depth: number;
  selected: string | null;
  onSelect: (rel: string, fileKind: FileNode['fileKind']) => void;
  recentlyChanged?: Set<string>;
  usedAssets?: Set<string>;
  filter: TreeFilter;
  engine: EngineKind;
  openFolders: Set<string>;
  toggleFolder: (rel: string) => void;
  usedOnly: boolean;
  isRoot?: boolean;
}) {
  const { node, depth, isRoot, filter, engine, openFolders, toggleFolder, usedOnly } = props;
  const open = isRoot ? true : openFolders.has(node.relPath);

  if (node.kind === 'dir') {
    const visibleChildren = (node.children ?? []).filter((c) => isVisible(c, filter, engine, usedOnly, props.usedAssets));
    if (!isRoot && visibleChildren.length === 0) return null;
    return (
      <>
        {!isRoot && (
          <div
            className={`tree-row ${open ? '' : 'collapsed'}`}
            style={{ ['--depth' as never]: depth } as React.CSSProperties}
            onClick={() => toggleFolder(node.relPath)}
            role="treeitem"
          >
            <span className="twirl">{I.caret}</span>
            <span className="ficon">{open ? I.folderOpen : I.folder}</span>
            <span className="name">{node.name}</span>
          </div>
        )}
        {(open || isRoot) && visibleChildren.map((c) => (
          <Node
            key={c.relPath || c.name}
            node={c}
            depth={isRoot ? 0 : depth + 1}
            selected={props.selected}
            onSelect={props.onSelect}
            recentlyChanged={props.recentlyChanged}
            usedAssets={props.usedAssets}
            filter={filter}
            engine={engine}
            openFolders={openFolders}
            toggleFolder={toggleFolder}
            usedOnly={usedOnly}
          />
        ))}
      </>
    );
  }

  if (!isVisible(node, filter, engine, usedOnly, props.usedAssets)) return null;

  const isSelected = props.selected === node.relPath;
  const isChanged = props.recentlyChanged?.has(node.relPath);
  const isAsset = node.fileKind === 'image' || /\.(tscn|tres|prefab|unity|json)$/i.test(node.name);
  const isUsed = props.usedAssets ? props.usedAssets.has(node.relPath) : true;
  const showUnused = filter !== 'code' && isAsset && !!props.usedAssets && !isUsed;

  return (
    <div
      className={`tree-row ${isSelected ? 'selected' : ''}${showUnused ? ' unused' : ''}`}
      style={{ ['--depth' as never]: depth } as React.CSSProperties}
      onClick={() => props.onSelect(node.relPath, node.fileKind)}
      role="treeitem"
      title={node.relPath + (showUnused ? ' (not referenced anywhere)' : '')}
    >
      <span className="twirl"></span>
      <span className="ficon">{fileIcon(node)}</span>
      <span className="name">{node.name}</span>
      {showUnused && <span className="unused-badge" title="Not referenced">unused</span>}
      {isUsed && isAsset && props.usedAssets && (
        <span className="used-dot" title="Referenced in project" />
      )}
      {isChanged && <span className="stale-dot" title="Just regenerated" />}
    </div>
  );
}

function isCodeFile(node: FileNode, engine: EngineKind): boolean {
  if (node.kind !== 'file') return false;
  const ext = (node.name.split('.').pop() ?? '').toLowerCase();
  return CODE_EXT_BY_ENGINE[engine].has(ext);
}

function isVisible(
  node: FileNode,
  filter: TreeFilter,
  engine: EngineKind,
  usedOnly: boolean,
  usedAssets: Set<string> | undefined,
): boolean {
  if (node.kind === 'dir') {
    return (node.children ?? []).some((c) => isVisible(c, filter, engine, usedOnly, usedAssets));
  }
  const code = isCodeFile(node, engine);
  // Tab filter
  if (filter === 'code') return code;
  if (filter === 'assets' && code) return false;
  // Used-only filter only applies to assets (and only when we have a set).
  if (usedOnly && usedAssets && !code) {
    if (!usedAssets.has(node.relPath)) return false;
  }
  return true;
}

function countVisible(
  node: FileNode,
  filter: TreeFilter,
  engine: EngineKind,
  usedOnly: boolean,
  usedAssets: Set<string> | undefined,
): number {
  if (node.kind === 'file') return isVisible(node, filter, engine, usedOnly, usedAssets) ? 1 : 0;
  let n = 0;
  for (const c of node.children ?? []) n += countVisible(c, filter, engine, usedOnly, usedAssets);
  return n;
}

function fileIcon(n: FileNode): ReactElement {
  if (n.fileKind === 'image') {
    const lower = n.name.toLowerCase();
    if (lower.endsWith('.gif')) return I.gif;
    if (/(idle|walk|attack|run|cast|sheet|sprite)/i.test(n.name)) return I.sheet;
    return I.png;
  }
  const ext = n.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'tscn' || ext === 'tres') return I.tscn;
  if (ext === 'gd') return I.gd;
  if (ext === 'json') return I.json;
  if (ext === 'godot' || ext === 'cfg' || ext === 'ini' || ext === 'toml') return I.config;
  return I.config;
}
