import { Icon, type IconName } from './Icons';

export type Route = 'home' | 'devices' | 'mirror' | 'extend' | 'facecam' | 'share' | 'settings';

const items: { route: Route; label: string; icon: IconName }[] = [
  { route: 'home', label: 'Overview', icon: 'home' },
  { route: 'devices', label: 'Devices', icon: 'devices' },
  { route: 'mirror', label: 'Mirror & control', icon: 'mirror' },
  { route: 'extend', label: 'Extend display', icon: 'extend' },
  { route: 'facecam', label: 'Facecam', icon: 'camera' },
  { route: 'share', label: 'File sharing', icon: 'share' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

export function Sidebar({
  route,
  onNavigate,
  deviceName,
  ip,
  connectedCount,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  deviceName: string;
  ip: string;
  connectedCount: number;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="link" size={22} />
        </span>
        <span className="brand-text">
          <strong>Connectivity</strong>
          <small>Made by Shardul</small>
        </span>
      </div>

      <nav className="nav">
        {items.map((item) => (
          <button
            key={item.route}
            type="button"
            className={`nav-item ${route === item.route ? 'active' : ''}`}
            onClick={() => onNavigate(item.route)}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-device">
        <div className="sidebar-device-head">
          <span className="glyph glyph-desktop">
            <Icon name="laptop" size={18} />
          </span>
          <div>
            <strong>{deviceName}</strong>
            <span className="muted">{ip}</span>
          </div>
        </div>
        <div className={`sidebar-status ${connectedCount ? 'on' : ''}`}>
          <span className="dot" />
          {connectedCount ? `${connectedCount} tablet connected` : 'Searching for devices…'}
        </div>
      </div>
    </aside>
  );
}
