import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { strings } from '../strings';
import styles from './Toast.module.css';

type Kind = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  detail?: string;
}

const AUTO_HIDE_MS = 4000; // success and info only; errors and warnings stay until closed
const MAX_SHOWN = 4; // repeated errors must not pile up off the screen: the oldest goes
const icons = { success: Check, error: X, warning: TriangleAlert, info: Info };

interface Api {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  warning: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
}

const ToastContext = createContext<Api | null>(null);

/** One call anywhere under <ToastProvider>: `const toast = useToast(); toast.success('LR 1247 saved')`. */
export function useToast(): Api {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a <ToastProvider>');
  return api;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const api = useMemo<Api>(() => {
    const show = (kind: Kind) => (title: string, detail?: string) =>
      setToasts((all) => [...all, { id: nextId++, kind, title, detail }].slice(-MAX_SHOWN));
    return { success: show('success'), error: show('error'), warning: show('warning'), info: show('info') };
  }, []);

  const close = (id: number) => setToasts((all) => all.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => close(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast: t, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = icons[t.kind];
  const autoHide = t.kind === 'success' || t.kind === 'info';

  // The timer belongs to the toast: it is cleared when the toast is closed or the provider goes away.
  useEffect(() => {
    if (!autoHide) return;
    const timer = window.setTimeout(onClose, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
    // onClose is a new function every render; the timer must start once per toast
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`${styles.toast} ${styles[t.kind]}`} role={autoHide ? 'status' : 'alert'}>
      <span className={styles.icon}>
        <Icon size={16} strokeWidth={3} aria-hidden="true" />
      </span>
      <span className={styles.text}>
        <strong className={styles.title}>{t.title}</strong>
        {t.detail && <span className={styles.detail}>{t.detail}</span>}
      </span>
      <button type="button" className={styles.close} aria-label={strings.ui.dismiss} onClick={onClose}>
        <X size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
