import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../preload/preload';
import type { CaptureTarget, PeerInfo, WindowSource } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, EmptyState, Pill } from '../components/UI';
import type { SessionMode } from '../lib/rtc';

type SourceKind = 'display' | 'window';

export default function Extend({
  peers,
  state,
  rtcState,
  localStream,
  onStart,
  onStop,
}: {
  peers: PeerInfo[];
  state: AppState;
  rtcState: { state: string; mode: SessionMode | null };
  localStream: MediaStream | null;
  onStart: (deviceId: string, target: CaptureTarget) => void;
  onStop: () => void;
}) {
  const peer = peers.find((p) => p.connected);
  const [kind, setKind] = useState<SourceKind>('display');
  const [displayId, setDisplayId] = useState('');
  const [windows, setWindows] = useState<WindowSource[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = rtcState.state === 'connected' && rtcState.mode === 'extend';

  const displays = state.displays;
  const second = displays.find((d) => !d.primary);
  const hasSecond = displays.length > 1;

  // Keep the picker on something that still exists; prefer a second monitor.
  useEffect(() => {
    setDisplayId((prev) => {
      if (prev && displays.some((d) => d.id === prev)) return prev;
      const preferred = displays.find((d) => !d.primary) ?? displays.find((d) => d.primary) ?? displays[0];
      return preferred?.id ?? '';
    });
  }, [displays]);

  const loadWindows = useCallback(async () => {
    setLoading(true);
    try {
      const list: WindowSource[] = await window.sc.listWindows();
      setWindows(list);
      setSelected((prev) => (prev && list.some((w: WindowSource) => w.id === prev) ? prev : (list[0]?.id ?? '')));
    } catch {
      setWindows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (kind === 'window' && windows.length === 0) void loadWindows();
  }, [kind, windows.length, loadWindows]);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== localStream) {
      videoRef.current.srcObject = localStream;
      if (localStream) void videoRef.current.play().catch(() => undefined);
    }
  }, [localStream]);

  const currentDisplay = displays.find((d) => d.id === displayId);
  const selectedWindow = windows.find((w) => w.id === selected);
  const canStart = !!peer && (kind === 'window' ? !!selectedWindow : !!currentDisplay);

  const start = () => {
    if (!peer || !canStart) return;
    if (kind === 'window') {
      if (!selectedWindow) return;
      onStart(peer.id, { kind: 'window', sourceId: selectedWindow.id, sourceName: selectedWindow.name });
      return;
    }
    if (!currentDisplay) return;
    onStart(peer.id, { kind: 'screen', displayId: currentDisplay.id });
  };

  return (
    <div className="stack">
      {!hasSecond ? (
        <Card className="panel driver-card">
          <div className="panel-head">
            <div>
              <h3>Asli doosri screen ke liye ek virtual display chahiye</h3>
              <p className="muted">
                Windows abhi sirf <b>1 screen</b> dekh raha hai. Isliye jo dikh raha hai wo mirror hai — mouse
                doosri screen par ja hi nahi sakta, kyunki wo screen exist hi nahi karti.
              </p>
            </div>
            <Pill tone="warn">Setup needed</Pill>
          </div>
          <div className="driver-steps">
            <span>
              <b>1.</b> Free &amp; signed driver install karo (SpaceDesk bhi apna driver install karta hai)
            </span>
            <span>
              <b>2.</b> Driver install hone par Windows me naya monitor aa jayega — Display settings me{' '}
              <b>Extend these displays</b> chuno
            </span>
            <span>
              <b>3.</b> Yahan wapas aao — list apne aap update ho jayegi, phir us screen ko tablet par bhejo
            </span>
          </div>
          <div className="panel-actions">
            <button className="btn btn-primary" type="button" onClick={() => void window.sc.openDriverPage()}>
              <Icon name="download" size={16} /> Driver page kholo
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => void window.sc.openDisplaySettings()}>
              <Icon name="screen" size={16} /> Windows display settings
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={16} /> Refresh
            </button>
          </div>
          <p className="note">
            Driver: <b>MTT Virtual Display Driver</b> — open source, SignPath se signed, test mode ki zaroorat nahi.
            Install admin permission maangega, ek baar.
          </p>
        </Card>
      ) : (
        <Card className="panel ready-card">
          <span className="hint-icon">
            <Icon name="check" size={18} />
          </span>
          <div>
            <strong>{displays.length} screens detected</strong>
            <p className="muted">
              Tablet ko neeche chuni hui screen banayenge. Windows me mouse laptop se us screen par jayega, aur windows
              drag karke wahan le ja sakte ho — bilkul extra monitor ki tarah.
            </p>
          </div>
        </Card>
      )}

      <Card className="panel">
        <div className="panel-head">
          <div>
            <h3>What should the tablet show?</h3>
            <p className="muted">
              Ek monitor ko poora bhejo (second screen ki tarah), ya sirf ek app window — fullscreen, touch control ke
              saath.
            </p>
          </div>
          <Pill tone={live ? 'ok' : 'brand'}>{live ? 'Streaming' : 'Idle'}</Pill>
        </div>

        <div className="extend-grid">
          <div className="extend-preview">
            <video ref={videoRef} autoPlay playsInline muted />
            {!localStream ? (
              <div className="video-placeholder">
                <Icon name="extend" size={26} />
                <span>Preview appears here</span>
              </div>
            ) : null}
          </div>

          <div className="extend-controls">
            <label className="field">
              <span>Source</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)} disabled={live}>
                <option value="display">A monitor (second screen)</option>
                <option value="window">One app window</option>
              </select>
            </label>

            {kind === 'display' ? (
              <>
                <label className="field">
                  <span>Monitor</span>
                  <select value={displayId} onChange={(e) => setDisplayId(e.target.value)} disabled={live}>
                    {displays.map((display) => (
                      <option key={display.id} value={display.id}>
                        {display.label} · {display.width}×{display.height}
                        {display.primary ? ' (this laptop)' : ' (extended)'}
                      </option>
                    ))}
                  </select>
                </label>
                {currentDisplay ? (
                  <p className="note">
                    {currentDisplay.primary
                      ? 'Ye laptop ki apni screen hai — isse mirror kaha jaata hai, extend nahi. Doosri screen chuno.'
                      : `Tablet par ye screen fullscreen dikhegi (${currentDisplay.width}×${currentDisplay.height}). Touch usi screen par click karega.`}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <label className="field">
                  <span>App window</span>
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    disabled={live || loading || windows.length === 0}
                  >
                    {windows.length === 0 ? (
                      <option value="">{loading ? 'Looking for windows…' : 'No open windows found'}</option>
                    ) : (
                      windows.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <button className="btn btn-ghost" type="button" onClick={() => void loadWindows()} disabled={live}>
                  <Icon name="refresh" size={16} /> Refresh window list
                </button>
                {selectedWindow?.thumbnail ? (
                  <img className="window-thumb" src={selectedWindow.thumbnail} alt="" />
                ) : null}
              </>
            )}

            <div className="panel-actions">
              <button className="btn btn-primary" type="button" disabled={!canStart || live} onClick={start}>
                <Icon name="play" size={16} /> Show on tablet
              </button>
              <button className="btn btn-ghost" type="button" onClick={onStop} disabled={!localStream}>
                <Icon name="stop" size={16} /> Stop
              </button>
            </div>

            <div className="extend-steps">
              <span>
                <b>1.</b> Monitor ya app window chuno
              </span>
              <span>
                <b>2.</b> Show on tablet dabao (tablet par viewer khud khulega)
              </span>
              <span>
                <b>3.</b> Windows me windows drag karke us screen par le jao
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="hint-card">
        <span className="hint-icon">
          <Icon name="bolt" size={20} />
        </span>
        <div>
          <strong>SpaceDesk jaisa kaise kaam karta hai</strong>
          <p>
            SpaceDesk/apna driver Windows me ek <b>fake monitor</b> add karta hai — OS use asli screen samajhta hai,
            isliye mouse us par jaata hai. Hum wahi monitor capture karke tablet par bhejte hain aur tablet ke touch
            ko usi screen par click banate hain. Bina driver ke Windows ke paas doosri screen hoti hi nahi, isliye
            sirf mirror/ek-window wala option kaam karta hai.
          </p>
          <p className="note">
            Tip: Windows Display settings me virtual monitor ki resolution tablet ke aspect ratio par rakhna (jaise
            1920×1200) — picture stretch nahi hogi.
          </p>
        </div>
      </Card>

      {!peer ? (
        <EmptyState
          icon="tablet"
          title="Connect a tablet first"
          description="Discovery is automatic. Keep the tablet app open on the same Wi-Fi."
        />
      ) : (
        <p className="note">
          Connected to <b>{peer.name}</b> · {peer.ip}. Input forwarding is{' '}
          {state.settings.inputEnabled ? 'enabled' : 'disabled'}.
        </p>
      )}
    </div>
  );
}
