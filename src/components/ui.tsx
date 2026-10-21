import React, { useEffect, useRef, useState } from 'react';

export type IconName =
  | 'dashboard'
  | 'practice'
  | 'test'
  | 'bank'
  | 'flashcards'
  | 'arcade'
  | 'resources'
  | 'rewards'
  | 'account'
  | 'play'
  | 'bolt'
  | 'spark'
  | 'check'
  | 'bookmark'
  | 'calculator'
  | 'reference'
  | 'refresh'
  | 'info'
  | 'coins'
  | 'flame'
  | 'trophy'
  | 'palette'
  | 'arrow-right'
  | 'arrow-left'
  | 'compass'
  | 'graph'
  | 'crown'
  | 'cloud'
  | 'device'
  | 'flip'
  | 'flag'
  | 'shield'
  | 'users'
  | 'layers';

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'ui-icon',
    'aria-hidden': true,
  };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'practice':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'test':
      return (
        <svg {...props}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case 'bank':
      return (
        <svg {...props}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'flashcards':
      return (
        <svg {...props}>
          <rect x="3" y="6" width="15" height="13" rx="2" />
          <path d="M7 3h13a2 2 0 0 1 2 2v11" />
        </svg>
      );
    case 'arcade':
      return (
        <svg {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'resources':
      return (
        <svg {...props}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'rewards':
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="6" />
          <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
        </svg>
      );
    case 'account':
      return (
        <svg {...props}>
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case 'play':
      return (
        <svg {...props}>
          <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...props}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </svg>
      );
    case 'check':
      return (
        <svg {...props}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'bookmark':
      return (
        <svg {...props}>
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
      );
    case 'calculator':
      return (
        <svg {...props}>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <line x1="8" y1="6" x2="16" y2="6" />
          <line x1="8" y1="11" x2="8" y2="11.01" />
          <line x1="12" y1="11" x2="12" y2="11.01" />
          <line x1="16" y1="11" x2="16" y2="11.01" />
          <line x1="8" y1="16" x2="8" y2="16.01" />
          <line x1="12" y1="16" x2="12" y2="16.01" />
          <line x1="16" y1="16" x2="16" y2="16.01" />
        </svg>
      );
    case 'reference':
      return (
        <svg {...props}>
          <path d="M4 7V4h16v3M9 20h6M12 4v16" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...props}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      );
    case 'info':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'coins':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M9.5 10.5h5M9.5 13.5h5" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...props}>
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...props}>
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      );
    case 'palette':
      return (
        <svg {...props}>
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...props}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg {...props}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      );
    case 'compass':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <polygon points="16.5 7.5 13.5 13.5 7.5 16.5 10.5 10.5" />
        </svg>
      );
    case 'graph':
      return (
        <svg {...props}>
          <path d="M4 4v16h16" />
          <polyline points="7 15 11 10 14 13 19 6" />
        </svg>
      );
    case 'crown':
      return (
        <svg {...props}>
          <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5V18H3z" />
        </svg>
      );
    case 'cloud':
      return (
        <svg {...props}>
          <path d="M17.5 19H7a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17.3 9.5a4.75 4.75 0 0 1 .2 9.5z" />
        </svg>
      );
    case 'device':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="11" rx="2" />
          <path d="M2 20h20" />
        </svg>
      );
    case 'flip':
      return (
        <svg {...props}>
          <path d="M4 9h12a4 4 0 0 1 0 8H8" />
          <path d="m6.5 6-2.5 3 2.5 3" />
          <path d="m14 14-3 3 3 3" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...props}>
          <path d="M4 22V4M4 4h11l-1.6 3.5L15 11H4" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'users':
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...props}>
          <path d="m12 2 9 5-9 5-9-5 9-5z" />
          <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
        </svg>
      );
  }
}

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  full = false,
  title,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  disabled?: boolean;
  full?: boolean;
  title?: string;
  icon?: IconName;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}${full ? ' btn-full' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ProgressBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  mode = 'auto',
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; hint?: string }[];
  label: string;
  mode?: 'auto' | 'dropdown' | 'segmented';
}) {
  const useSegmented = mode === 'segmented' || (mode === 'auto' && options.length > 0 && options.length <= 5);

  if (useSegmented) {
    return (
      <div className="field" role="group" aria-label={label}>
        <span className="field-label">{label}</span>
        <div className="seg-group">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`seg-btn${active ? ' is-selected' : ''}`}
                onClick={() => onChange(option.value)}
                aria-pressed={active}
                title={option.hint ?? option.label}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Checkbox dropdown for multi-value filters. An empty selection means "every
 * value", which is what the pattern-matching engine treats it as, so the
 * trigger always reads "All …" until the student narrows it down.
 */
export function MultiSelect({
  label,
  values,
  onChange,
  options,
  allLabel = 'All',
  hint,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedSet = new Set(values);
  const allSelected = values.length === 0;
  const selectedOptions = options.filter((option) => selectedSet.has(option.value));
  const checkedCount = allSelected ? options.length : selectedOptions.length;
  const summary = allSelected
    ? allLabel
    : selectedOptions.length === 1
    ? selectedOptions[0].label
    : `${selectedOptions.length} selected`;

  const toggle = (value: string) => {
    const current = allSelected ? options.map((option) => option.value) : values;
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : options.map((option) => option.value).filter((item) => current.includes(item) || item === value);
    // Never allow an empty result to silently mean "everything".
    if (next.length === 0) return;
    onChange(next.length === options.length ? [] : next);
  };

  return (
    <div className="field multi-select" ref={wrapRef}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className={`ms-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={summary}
      >
        <span className="ms-summary">{summary}</span>
        {!allSelected ? <span className="ms-count">{checkedCount}</span> : null}
        <span className="ms-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="ms-panel" role="listbox" aria-multiselectable="true" aria-label={label}>
          {options.map((option) => {
            const checked = allSelected || selectedSet.has(option.value);
            return (
              <label key={option.value} className="ms-option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.value)}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
          <div className="ms-foot">
            <span className="ms-hint">{hint ?? 'Tick any number of options.'}</span>
            <button
              type="button"
              className="ms-action"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              Show all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function InfoTip({
  label = 'Details',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // A popover this size should dismiss on ANY click elsewhere on the page, not
  // only on the button that opened it. Capture phase so a click on a control
  // behind the popover still closes it before that control acts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span className="info-tip-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`info-tip-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={label}
      >
        <span className="info-tip-q">?</span>
        {label ? <span className="info-tip-label">{label}</span> : null}
      </button>
      {open ? <div className="info-tip-box">{children}</div> : null}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint ? <em>{hint}</em> : null}
      </span>
    </label>
  );
}

export function Alert({
  tone,
  children,
  onDismiss,
}: {
  tone: 'error' | 'notice' | 'info';
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onDismiss ? (
        <button type="button" className="alert-close" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      ) : null}
    </div>
  );
}
