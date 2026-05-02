import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { I } from '../components/icons.js';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ToastOptions {
  title?: string;
  body: string;
  kind?: 'info' | 'success' | 'error' | 'warn';
  durationMs?: number;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (opts: ToastOptions) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

interface ActiveConfirm extends ConfirmOptions {
  id: number;
  resolve: (v: boolean) => void;
}

interface ActiveToast extends Required<Pick<ToastOptions, 'body'>> {
  id: number;
  title?: string;
  kind: NonNullable<ToastOptions['kind']>;
  durationMs: number;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [confirms, setConfirms] = useState<ActiveConfirm[]>([]);
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      seq.current += 1;
      const id = seq.current;
      setConfirms((prev) => [...prev, { id, ...opts, resolve }]);
    });
  }, []);

  const notify = useCallback((opts: ToastOptions) => {
    seq.current += 1;
    const id = seq.current;
    const dur = opts.durationMs ?? (opts.kind === 'error' ? 6000 : 3500);
    const toast: ActiveToast = {
      id,
      title: opts.title,
      body: opts.body,
      kind: opts.kind ?? 'info',
      durationMs: dur,
    };
    setToasts((prev) => [...prev, toast]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, dur);
  }, []);

  function resolveTop(value: boolean) {
    setConfirms((prev) => {
      if (prev.length === 0) return prev;
      const top = prev[prev.length - 1];
      top.resolve(value);
      return prev.slice(0, -1);
    });
  }

  // Esc closes top confirm; Enter accepts
  useEffect(() => {
    if (confirms.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveTop(false);
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        resolveTop(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirms.length]);

  return (
    <DialogContext.Provider value={{ confirm, notify }}>
      {children}
      {confirms.map((c, i) =>
        i === confirms.length - 1 ? (
          <ConfirmDialog
            key={c.id}
            opts={c}
            onClose={(v) => {
              c.resolve(v);
              setConfirms((prev) => prev.filter((x) => x.id !== c.id));
            }}
          />
        ) : null,
      )}
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </DialogContext.Provider>
  );
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions; onClose: (v: boolean) => void }) {
  return (
    <div className="modal-scrim" onClick={() => onClose(false)}>
      <div
        className="modal ogf-confirm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ogf-confirm-head">
          <span style={{ color: opts.danger ? 'var(--red)' : 'var(--accent)' }}>
            {opts.danger ? I.warn : I.spark}
          </span>
          <span className="title">{opts.title}</span>
          <button className="close" onClick={() => onClose(false)} title="Cancel (Esc)">{I.close}</button>
        </div>
        {opts.body && <div className="ogf-confirm-body">{opts.body}</div>}
        <div className="ogf-confirm-foot">
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => onClose(false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn btn-sm ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onClose(true)}
            autoFocus
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ActiveToast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="ogf-toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ogf-toast kind-${t.kind}`} onClick={() => onDismiss(t.id)}>
          <span className="ogf-toast-ico">
            {t.kind === 'error' || t.kind === 'warn'
              ? I.warn
              : t.kind === 'success'
              ? I.check
              : I.spark}
          </span>
          <div className="ogf-toast-content">
            {t.title && <div className="ogf-toast-title">{t.title}</div>}
            <div className="ogf-toast-body">{t.body}</div>
          </div>
          <button className="ogf-toast-x" title="Dismiss">{I.close}</button>
        </div>
      ))}
    </div>
  );
}
