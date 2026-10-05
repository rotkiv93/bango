import type { ReactNode } from 'react';

/** Segmented control: a row of mutually exclusive choices. */
export function Segmented<T extends string>({ items, value, onChange, small }: {
  items: { value: T; label: string; title?: string }[];
  value: T;
  onChange(value: T): void;
  small?: boolean;
}) {
  return (
    <div className={`segmented${small ? ' small' : ''}`} role="tablist">
      {items.map(i => (
        <button key={i.value} role="tab" aria-selected={i.value === value} title={i.title} className={i.value === value ? 'on' : ''} onClick={() => onChange(i.value)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'accent' | 'warn' | 'err' | 'ok'; title?: string }) {
  return <span className={`chip ${tone}`} title={title}>{children}</span>;
}

/** The status of something with problems: ✓ when clean, otherwise error/warning counts. */
export function Status({ errors, warnings = 0, none }: { errors: number; warnings?: number; none?: boolean }) {
  if (none) return <span className="status none" title="No instance yet">—</span>;
  if (errors) return <span className="status err" title={`${errors} error(s)`}>✖ {errors}</span>;
  if (warnings) return <span className="status warn" title={`${warnings} warning(s)`}>⚠ {warnings}</span>;
  return <span className="status ok" title="No problems">✓</span>;
}

export function Banner({ tone, children, actions }: { tone: 'err' | 'ok' | 'warn' | 'info'; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === 'err' ? 'alert' : 'status'}>
      <div className="banner-body">{children}</div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="emptystate">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** A modal dialog; clicking the backdrop or pressing Escape closes it. */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const count = (ps: { severity: string }[], severity: string) => ps.filter(p => p.severity === severity).length;
