import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../preload/preload';
import type { PeerInfo } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, EmptyState, Pill, Toggle } from '../components/UI';
import type { SessionMode } from '../lib/rtc';

function Video({
  stream,
  muted,
  placeholder,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      if (stream) void ref.current.play().catch(() => undefined);
    }
  }, [stream]);

  return (
    <div className={`video-frame ${stream ? 'live' : ''}`}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      {!stream ? (
        <div className="video-placeholder">
          <Icon name="screen" size={26} />
          <span>{placeholder}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function Mirror({
  peers,
  state,
  rtcState,
  localStream,
  remoteStream,
  onStartMirror,
  onStartTabletView,
  onStop,
}: {
  peers: PeerInfo[];
  state: AppState;
  rtcState: { state: string; mode: SessionMode | null };
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onStartMirror: (deviceId: string, displayId?: string) => void;
  onStartTabletView: (deviceId: string) => void;
  onStop: () => void;
}) {
  const connected = peers.filter((p) => p.connected);
  const peer = connected[0];
  const [displayId, setDisplayId] = useState(state.displays.find((d) => d.primary)?.id ?? state.displays[0]?.id ?? '');
  const live = rtcState.state === 'connected';

  return (
    <div className="stack">
      <div className="mirror-grid">
        <Card className="panel">
          <div className="panel-head">
            <div>
              <h3>PC → Tablet</h3>
              <p className="muted">The tablet shows this PC’s screen and can control the pointer.</p>
            </div>
            <Pill tone={live && rtcState.mode !== 'mirror-tablet' ? 'ok' : 'neutral'}>
              {live && rtcState.mode !== 'mirror-tablet' ? 'Streaming' : 'Idle'}
            </Pill>
          </div>

          <Video stream={localStream} muted placeholder="Screen capture preview appears here" />

          <div className="field-row">
            <label className="field">
              <span>Capture source</span>
              <select value={displayId} onChange={(e) => setDisplayId(e.target.value)}>
                {state.displays.map((display) => (
                  <option key={display.id} value={display.id}>
                    {display.label} · {display.width}×{display.height}
                    {display.primary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={!peer}
                onClick={() => {
                  if (!peer) return;
                  onStartMirror(peer.id, displayId);
                }}
              >
                <Icon name="play" size={16} /> Start mirroring
              </button>
              <button className="btn btn-ghost" type="button" onClick={onStop} disabled={!localStream && !remoteStream}>
                <Icon name="stop" size={16} /> Stop
              </button>
            </div>
          </div>

          {!peer ? <p className="note">Connect a tablet first — the device list updates automatically.</p> : null}
        </Card>

        <Card className="panel">
          <div className="panel-head">
            <div>
              <h3>Tablet → PC</h3>
              <p className="muted">Reverse mirroring: the tablet’s screen appears in this window.</p>
            </div>
            <Pill tone={live && rtcState.mode === 'mirror-tablet' ? 'ok' : 'neutral'}>
              {live && rtcState.mode === 'mirror-tablet' ? 'Streaming' : 'Idle'}
            </Pill>
          </div>

          <Video stream={remoteStream} placeholder="Start “Share my screen” on the tablet" />

          <div className="panel-actions">
            <button
              className="btn btn-ghost"
              type="button"
              disabled={!peer}
              onClick={() => {
                if (!peer) return;
                onStartTabletView(peer.id);
              }}
            >
              <Icon name="tablet" size={16} /> Ask tablet to share
            </button>
            <button className="btn btn-ghost" type="button" onClick={onStop} disabled={!remoteStream}>
              <Icon name="stop" size={16} /> Disconnect
            </button>
          </div>
          <p className="note">
            Android asks for screen-capture permission on the tablet. Approve it there to start this direction.
          </p>
        </Card>
      </div>

      <Card className="panel">
        <div className="panel-head">
          <div>
            <h3>Input & clipboard</h3>
            <p className="muted">Touches on the tablet are forwarded as real mouse and keyboard events.</p>
          </div>
          {state.inputAvailable ? <Pill tone="ok">Input bridge ready</Pill> : <Pill tone="warn">Unavailable</Pill>}
        </div>
        <div className="toggle-grid">
          <Toggle
            label="Mouse & keyboard forwarding"
            description="Move the cursor inside the mirrored area"
            checked={state.settings.inputEnabled}
            onChange={(value) => void window.sc.setSettings({ inputEnabled: value })}
          />
          <Toggle
            label="Clipboard sync"
            description="Copy text on one device, paste on the other"
            checked={state.settings.clipboardSync}
            onChange={(value) => void window.sc.setSettings({ clipboardSync: value })}
          />
        </div>
        {!state.inputAvailable ? (
          <p className="note">
            The native input helper could not load. Screen sharing still works, but touch input will not be forwarded.
          </p>
        ) : null}
      </Card>

      {connected.length === 0 ? (
        <EmptyState
          icon="tablet"
          title="No tablet connected"
          description="Start the app on the tablet. Discovery is automatic once both devices share a Wi-Fi network."
        />
      ) : null}
    </div>
  );
}
