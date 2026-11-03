import type { AppState } from '../../../preload/preload';
import type { PeerInfo } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, DeviceGlyph, Pill, Tile } from '../components/UI';
import type { Route } from '../components/Sidebar';
import type { SessionMode } from '../lib/rtc';

interface Props {
  state: AppState;
  peers: PeerInfo[];
  rtcState: { state: string; mode: SessionMode | null };
  onNavigate: (route: Route) => void;
  onStart: (mode: SessionMode) => void;
  onStop: () => void;
}

export default function Home({ state, peers, rtcState, onNavigate, onStart, onStop }: Props) {
  const connected = peers.filter((p) => p.connected);
  const live = rtcState.state === 'connected';

  return (
    <div className="stack">
      <Card className="hero">
        <div className="hero-copy">
          <Pill tone="brand">
            <Icon name="wifi" size={13} /> Same Wi-Fi · no account
          </Pill>
          <h2>Your tablet, part of your PC.</h2>
          <p>
            Mirror screens both ways, use the tablet as a second display, share files instantly and control this PC
            from the touchscreen. Everything stays on your local network.
          </p>
          <div className="hero-actions">
            {live ? (
              <button className="btn btn-danger" type="button" onClick={onStop}>
                <Icon name="stop" size={16} /> Stop session
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => onStart('mirror-pc')}
                disabled={connected.length === 0}
              >
                <Icon name="play" size={16} /> Mirror this PC
              </button>
            )}
            <button className="btn btn-ghost" type="button" onClick={() => onNavigate('share')}>
              <Icon name="share" size={16} /> Send a file
            </button>
          </div>
          <div className="hero-meta">
            <span>
              <Icon name="laptop" size={15} /> {state.settings.deviceName}
            </span>
            <span>
              <Icon name="wifi" size={15} /> {state.net.ip}
            </span>
            <span className={connected.length ? 'ok' : 'muted'}>
              <span className="dot" /> {connected.length ? 'Tablet online' : 'Waiting for tablet'}
            </span>
          </div>
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="art-screen">
            <div className="art-bar" />
            <div className="art-grid">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="art-tablet">
            <div className="art-tablet-inner">
              <Icon name="tablet" size={22} />
            </div>
          </div>
          <span className="art-wave" />
        </div>
      </Card>

      <div className="tiles">
        <Tile
          icon="mirror"
          title="Mirror & control"
          description="See and touch your PC from the tablet"
          onClick={() => onNavigate('mirror')}
          tone="blue"
          badge={live ? 'Live' : undefined}
        />
        <Tile
          icon="extend"
          title="Second screen"
          description="Send this PC's screen or one app to the tablet"
          onClick={() => onNavigate('extend')}
          tone="violet"
          badge={live && rtcState.mode === 'extend' ? 'Live' : undefined}
        />
        <Tile
          icon="camera"
          title="Facecam"
          description="Use the tablet camera as this PC's webcam"
          onClick={() => onNavigate('facecam')}
          tone="green"
          badge={live && rtcState.mode === 'webcam' ? 'Live' : undefined}
        />
        <Tile
          icon="share"
          title="File sharing"
          description="Drag files and grab them on the tablet"
          onClick={() => onNavigate('share')}
          tone="green"
        />
        <Tile
          icon="cursor"
          title="Cross control"
          description={state.inputAvailable ? 'Mouse & keyboard forwarding' : 'Input bridge unavailable'}
          onClick={() => onNavigate('mirror')}
          tone="amber"
          disabled={!state.inputAvailable}
          badge={state.inputAvailable ? 'Ready' : 'N/A'}
        />
      </div>

      <section>
        <div className="section-head">
          <h3>Nearby devices</h3>
          <button className="link-btn" type="button" onClick={() => onNavigate('devices')}>
            View all
          </button>
        </div>
        {peers.length === 0 ? (
          <Card className="hint-card">
            <span className="hint-icon">
              <Icon name="tablet" size={22} />
            </span>
            <div>
              <strong>Install the tablet app</strong>
              <p>
                Copy <code>Connectivity.apk</code> to your tablet, install it, and keep both devices on the same
                Wi-Fi. The tablet appears here automatically within a few seconds.
              </p>
            </div>
          </Card>
        ) : (
          <div className="device-grid">
            {peers.map((peer) => (
              <Card key={peer.id} className="device-card">
                <DeviceGlyph kind={peer.kind} />
                <div className="device-main">
                  <strong>{peer.name}</strong>
                  <span className="muted">
                    {peer.kind === 'tablet' ? 'Tablet' : 'Computer'} · {peer.ip}
                  </span>
                </div>
                <Pill tone={peer.connected ? 'ok' : 'neutral'}>{peer.connected ? 'Connected' : 'Available'}</Pill>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="split">
        <Card className="mini-card">
          <span className="mini-icon">
            <Icon name="clipboard" size={18} />
          </span>
          <div>
            <strong>Clipboard sync</strong>
            <p>{state.settings.clipboardSync ? 'Copy here, paste on the tablet.' : 'Disabled in settings.'}</p>
          </div>
        </Card>
        <Card className="mini-card">
          <span className="mini-icon">
            <Icon name="folder" size={18} />
          </span>
          <div>
            <strong>Received files</strong>
            <p className="ellipsis">{state.settings.receiveDir}</p>
          </div>
          <button className="icon-btn" type="button" onClick={() => void window.sc.openPath('receive')}>
            <Icon name="folder" size={17} />
          </button>
        </Card>
      </div>
    </div>
  );
}
