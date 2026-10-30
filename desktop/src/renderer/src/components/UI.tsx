import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icons';

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Tile({
  icon,
  title,
  description,
  onClick,
  tone = 'blue',
  disabled,
  badge,
}: {
  icon: IconName;
  title: string;
  description: string;
  onClick?: () => void;
  tone?: 'blue' | 'violet' | 'green' | 'amber';
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button className={`tile tone-${tone}`} onClick={onClick} disabled={disabled} type="button">
      <span className="tile-icon">
        <Icon name={icon} size={24} />
      </span>
      <span className="tile-text">
        <span className="tile-title">{title}</span>
        <span className="tile-desc">{description}</span>
      </span>
      {badge ? <span className="tile-badge">{badge}</span> : null}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-desc">{description}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'ok' | 'warn' | 'err' | 'neutral' | 'brand'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function EmptyState({
  icon = 'devices',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DeviceGlyph({ kind }: { kind: 'desktop' | 'tablet' }) {
  return (
    <span className={`glyph glyph-${kind}`}>
      <Icon name={kind === 'desktop' ? 'laptop' : 'tablet'} size={22} />
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
