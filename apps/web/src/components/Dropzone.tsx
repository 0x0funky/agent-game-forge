import { useRef, useState } from 'react';
import type { RefImage } from '@ogf/contracts';
import { deleteRef, fileToBase64, uploadRef } from '../lib/api.js';
import { useDialog } from '../lib/dialog.js';
import { I } from './icons.js';

interface Props {
  projectPath: string | null;
  refs: RefImage[];
  onChange: (refs: RefImage[]) => void;
  disabled?: boolean;
}

const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const MAX_REFS = 8;

export function Dropzone(props: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { notify } = useDialog();

  async function handleFiles(files: FileList | File[]) {
    if (!props.projectPath || props.disabled || busy) return;
    const list = Array.from(files);
    const slots = MAX_REFS - props.refs.length;
    const accepted = list
      .filter((f) => ALLOWED_EXT.some((ext) => f.name.toLowerCase().endsWith(ext)))
      .slice(0, slots);
    if (accepted.length === 0) return;

    setBusy(true);
    const newRefs: RefImage[] = [];
    try {
      for (const file of accepted) {
        const base64 = await fileToBase64(file);
        const r = await uploadRef({
          projectPath: props.projectPath,
          filename: file.name,
          base64,
        });
        newRefs.push({ relPath: r.relPath, size: r.size, mtimeMs: Date.now() });
      }
      props.onChange([...newRefs, ...props.refs]);
    } catch (err) {
      notify({ kind: 'error', title: 'Upload failed', body: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  async function removeRef(rel: string) {
    if (!props.projectPath) return;
    try {
      await deleteRef(props.projectPath, rel);
      props.onChange(props.refs.filter((r) => r.relPath !== rel));
    } catch (err) {
      notify({ kind: 'error', title: 'Could not remove reference', body: err instanceof Error ? err.message : String(err) });
    }
  }

  const empty = props.refs.length === 0;
  const canAdd = props.refs.length < MAX_REFS && !props.disabled && !!props.projectPath;

  return (
    <div
      className={`dropzone ${empty ? '' : 'has-refs'} ${dragOver ? 'dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!props.disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <span className="lbl">
        {I.image}
        <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>References</span>
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10.5 }}>
          {props.refs.length}/{MAX_REFS}
        </span>
      </span>
      <div className="ref-thumbs">
        {props.refs.map((r) => (
          <div key={r.relPath} className="ref-thumb" title={r.relPath}>
            <img
              src={`/api/files/content?projectPath=${encodeURIComponent(props.projectPath ?? '')}&relPath=${encodeURIComponent(r.relPath)}&__inline=base64`}
              alt={r.relPath}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                imageRendering: 'pixelated',
              }}
              onError={(e) => {
                // fallback gradient if image fails to load
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
              ref={(el) => {
                // eagerly fetch via fetch + base64 since /api/files/content returns JSON, not image bytes
                if (!el || el.dataset.loaded === '1' || !props.projectPath) return;
                el.dataset.loaded = '1';
                fetch(
                  `/api/files/content?projectPath=${encodeURIComponent(props.projectPath)}&relPath=${encodeURIComponent(r.relPath)}`,
                )
                  .then((res) => res.json())
                  .then((j) => {
                    if (j && j.base64) {
                      const ext = r.relPath.split('.').pop()?.toLowerCase() ?? 'png';
                      const mime =
                        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
                      el.src = `data:${mime};base64,${j.base64}`;
                    }
                  })
                  .catch(() => {});
              }}
            />
            <button
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                void removeRef(r.relPath);
              }}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        {canAdd && (
          <button
            className="add-btn"
            title={busy ? 'Uploading…' : 'Add reference'}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy ? '…' : I.plus}
          </button>
        )}
      </div>
      <span style={{ flex: 1 }} />
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
        {props.disabled
          ? 'open a project first'
          : busy
          ? 'uploading…'
          : empty
          ? 'drop image or click +'
          : `${props.refs.length} ref${props.refs.length === 1 ? '' : 's'}`}
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXT.join(',')}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
