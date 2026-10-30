import { useMemo, useState } from 'react';
import type { AppState } from '../../../preload/preload';
import type { PeerInfo } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, DeviceGlyph, EmptyState, Pill } from '../components/UI';

export default function Devices({
  peers,
  state,
  onStart,
  onRefresh,
}: {
  peers: PeerInfo[];
  state: AppState;
  onStart: () => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => peers.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.ip.includes(query)),
    [peers, query],
  );

  return (
    <div className="stack">
      <Card className="toolbar">
        <div className="search">
          <Icon name="search" size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or IP address"
            spellCheck={false}
          />
        </div>
        <button className="btn btn-ghost" type="button" onClick={onRefresh}>
          <Icon name="refresh" size={16} /> Scan network
        </button>
      </Card>

      <Card className="self-card">
        <DeviceGlyph kind="desktop" />
        <div className="device-main">
          <strong>{state.settings.deviceName} (this PC)</strong>
          <span className="muted">
            Listening on {state.net.ip} · WS {state.net.wsPort} · HTTP {state.net.httpPort}
          </span>
        </div>
        <Pill tone="brand">Host</Pill>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="devices"
          title={peers.length ? 'No device matches that search' : 'No devices discovered yet'}
          description={
            peers.length
              ? 'Try a different name or clear the search field.'
              : 'Open Connectivity on your tablet and make sure both devices are connected to the same Wi-Fi network (not a guest network).'
          }
          action={
            <button className="btn btn-primary" type="button" onClick={onRefresh}>
              <Icon name="refresh" size={16} /> Scan again
            </button>
          }
        />
      ) : (
        <div className="device-list">
          {filtered.map((peer) => (
            <Card key={peer.id} className="device-row">
              <DeviceGlyph kind={peer.kind} />
              <div className="device-main">
                <strong>{peer.name}</strong>
                <span className="muted">
                  {peer.kind === 'tablet' ? 'Tablet' : 'Computer'} · {peer.ip}:{peer.ws}
                </span>
              </div>
              <div className="chips">
                {peer.features.slice(0, 4).map((feature) => (
                  <span key={feature} className="chip">
                    {feature}
                  </span>
                ))}
              </div>
              <Pill tone={peer.connected ? 'ok' : 'neutral'}>{peer.connected ? 'Connected' : 'Pairing…'}</Pill>
              <button className="btn btn-ghost" type="button" onClick={onStart} disabled={!peer.connected}>
                <Icon name="mirror" size={15} /> Open mirror
              </button>
            </Card>
          ))}
        </div>
      )}

      <Card className="hint-card">
        <span className="hint-icon">
          <Icon name="wifi" size={20} />
        </span>
        <div>
          <strong>Connection tips</strong>
          <p>
            Use a normal Wi-Fi network. Guest networks, “AP isolation”, and some VPNs block local traffic. If the
            tablet never appears, allow Connectivity through Windows Firewall (private networks) on ports 47777,
            47800 and 47801.
          </p>
        </div>
      </Card>
    </div>
  );
}
