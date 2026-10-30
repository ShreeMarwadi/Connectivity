import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '../../preload/preload';
import type { CaptureTarget, PeerInfo, Settings, SharedFile, TransferItem, WsEnvelope } from '../../shared/types';
import { DesktopRtc, type SessionMode } from './lib/rtc';
import { Sidebar, type Route } from './components/Sidebar';
import { Icon } from './components/Icons';
import Home from './pages/Home';
import Devices from './pages/Devices';
import Mirror from './pages/Mirror';
import Extend from './pages/Extend';
import Share from './pages/Share';
import SettingsPage from './pages/Settings';

interface Toast {
  id: number;
  level: 'success' | 'info' | 'error';
  text: string;
}

let toastSeq = 0;

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [shared, setShared] = useState<SharedFile[]>([]);
  const [route, setRoute] = useState<Route>('home');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [rtcState, setRtcState] = useState<{ state: string; mode: SessionMode | null }>({
    state: 'idle',
    mode: null,
  });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const rtcRef = useRef<DesktopRtc | null>(null);
  const stateRef = useRef<AppState | null>(null);
  /**
   * The tablet only starts receiving when it is showing the viewer. So a PC-initiated
   * session first pushes `open-viewer` and waits for the tablet's `session-request`,
   * which then consumes this remembered capture target.
   */
  const pendingRef = useRef<{ mode: SessionMode; deviceId: string; target: CaptureTarget; timer: number } | null>(null);

  stateRef.current = state;

  const toast = useCallback((level: Toast['level'], text: string) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev.slice(-3), { id, level, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    const next = await window.sc.getState();
    setState(next);
    setPeers(next.peers);
    setShared(next.shared);
    setTransfers(next.transfers);
  }, []);

  useEffect(() => {
    void refresh();
    const offPeers = window.sc.on('peers', (list: PeerInfo[]) => setPeers(list));
    const offTransfers = window.sc.on('transfers', (list: TransferItem[]) => setTransfers(list));
    const offShared = window.sc.on('shared', (list: SharedFile[]) => setShared(list));
    const offToast = window.sc.on('toast', (payload: { level: Toast['level']; text: string }) =>
      toast(payload.level, payload.text),
    );
    const offState = window.sc.on('state', (next: AppState) => {
      setState(next);
      setPeers(next.peers);
      setShared(next.shared);
      setTransfers(next.transfers);
    });
    return () => {
      offPeers();
      offTransfers();
      offShared();
      offToast();
      offState();
    };
  }, [refresh, toast]);

  useEffect(() => {
    const rtc = new DesktopRtc(
      (deviceId, message) => {
        void window.sc.send(deviceId, message);
      },
      {
        onRemoteStream: setRemoteStream,
        onLocalStream: setLocalStream,
        onState: (connectionState, mode) => {
          setRtcState({ state: connectionState, mode });
          // A session that ends on its own (track ended, connection closed) must also
          // bring the windows home, not only the Stop button.
          if (connectionState === 'idle' && mode === 'extend') restoreRef.current();
        },
        onError: (message) => toast('error', message),
      },
    );
    rtcRef.current = rtc;
    return () => {
      rtc.stop(false);
      void window.sc.restoreSession();
      rtcRef.current = null;
    };
  }, [toast]);

  const connectedPeers = useMemo(() => peers.filter((p) => p.connected), [peers]);

  const clearPending = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingRef.current = null;
  }, []);

  /**
   * The tablet no longer shows the extra monitor once the session ends, so bring back any
   * window that was dragged over and park the pointer on the laptop again.
   */
  const restoreAfterSession = useCallback(async () => {
    try {
      const result = await window.sc.restoreSession();
      if (result?.moved > 0) {
        toast(
          'info',
          `${result.moved} window${result.moved > 1 ? 's' : ''} wapas laptop par aa gayi${result.display ? ` (${result.display})` : ''}`,
        );
      }
    } catch {
      /* restoring is best effort */
    }
  }, [toast]);

  const restoreRef = useRef<() => void>(() => {});
  restoreRef.current = () => {
    void restoreAfterSession();
  };

  /**
   * Ask the tablet to open its fullscreen viewer. The actual capture starts when the
   * tablet answers with `session-request`, so no frames are sent into the void.
   */
  const pushToTablet = useCallback(
    async (mode: SessionMode, deviceId: string, target: CaptureTarget) => {
      clearPending();
      try {
        await window.sc.setCaptureTarget(target);
      } catch (err) {
        toast('error', (err as Error).message || 'Could not prepare capture');
        return;
      }
      const timer = window.setTimeout(() => {
        if (pendingRef.current && pendingRef.current.deviceId === deviceId) {
          pendingRef.current = null;
          toast('error', 'Tablet ne viewer nahi khola — tablet par Connectivity app khula rakho');
        }
      }, 15000);
      pendingRef.current = { mode, deviceId, target, timer };
      await window.sc.send(deviceId, { type: 'open-viewer', mode });
      toast('info', 'Tablet par viewer khul raha hai…');
    },
    [clearPending, toast],
  );

  useEffect(() => () => clearPending(), [clearPending]);

  const startStream = useCallback(
    async (mode: SessionMode, deviceId: string, target: CaptureTarget) => {
      try {
        await rtcRef.current?.startSending({
          mode,
          deviceId,
          target,
          quality: stateRef.current?.settings.quality ?? 'balanced',
        });
        const label =
          target.kind === 'screen'
            ? stateRef.current?.displays.find((d) => d.id === target.displayId)?.label
            : target.sourceName;
        toast(
          'success',
          mode === 'extend'
            ? `Second screen live${label ? `: ${label}` : ''}`
            : `Screen sharing started${label ? `: ${label}` : ''}`,
        );
      } catch (err) {
        toast('error', (err as Error).message || 'Could not start screen sharing');
      }
    },
    [toast],
  );

  useEffect(() => {
    const off = window.sc.on('ws:message', ({ deviceId, msg }: { deviceId: string; msg: WsEnvelope }) => {
      if (msg.type === 'signal') {
        void rtcRef.current?.handleSignal(deviceId, msg as never);
        return;
      }
      if (msg.type === 'session-request') {
        const requested = msg.mode as SessionMode;
        const pending = pendingRef.current;
        // If we just pushed a viewer to this tablet, trust our own choice: older tablet
        // builds may echo a stale mode, and a mode mismatch must never silently fall back
        // to the laptop screen (that is exactly what "extend looks like mirror" was).
        const usePending = !!pending && pending.deviceId === deviceId;
        const mode = usePending ? pending.mode : requested;
        const displays = stateRef.current?.displays ?? [];
        const primary = displays.find((d) => d.primary);
        const second = displays.find((d) => !d.primary);
        // Tablet-initiated extend requests must pick the extra monitor, not the laptop panel.
        const fallback: CaptureTarget =
          mode === 'extend' && second
            ? { kind: 'screen', displayId: second.id }
            : { kind: 'screen', displayId: primary?.id };
        const target: CaptureTarget = usePending ? pending!.target : fallback;
        if (usePending && pending!.timer) {
          // Keep the target for a repeated request, but stop the "tablet did not answer" timer.
          window.clearTimeout(pending!.timer);
          pending!.timer = 0;
        }

        if (mode === 'mirror-pc') {
          setRoute('mirror');
          void startStream('mirror-pc', deviceId, target);
        } else if (mode === 'extend') {
          setRoute('extend');
          void startStream('extend', deviceId, target);
        } else {
          setRoute('mirror');
          toast('info', 'Tablet is sharing its screen');
        }
        return;
      }
      if (msg.type === 'session-stop') {
        rtcRef.current?.stop(false);
        void restoreAfterSession();
        toast('info', 'Session ended by tablet');
      }
      if (msg.type === 'clipboard' && msg.text) {
        toast('info', 'Text received from tablet');
      }
    });
    // If the tablet drops off the network the capture must stop too, otherwise the PC
    // keeps encoding a screen nobody watches (that is pure CPU/GPU burn and makes the
    // next session choppy).
    const offDisconnected = window.sc.on('ws:disconnected', ({ deviceId }: { deviceId: string }) => {
      if (rtcRef.current?.activeDevice === deviceId) {
        clearPending();
        rtcRef.current.stop(true);
        void restoreAfterSession();
        toast('info', 'Tablet disconnected — session stopped');
      }
    });
    return () => {
      off();
      offDisconnected();
    };
  }, [startStream, toast, clearPending, restoreAfterSession]);

  const stopStream = useCallback(() => {
    clearPending();
    rtcRef.current?.stop(true);
    void restoreAfterSession();
    toast('info', 'Session stopped');
  }, [clearPending, restoreAfterSession, toast]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await window.sc.setSettings(patch);
      setState((prev) => (prev ? { ...prev, settings: next } : prev));
      if (patch.theme) document.body.dataset.theme = next.theme;
      return next;
    },
    [],
  );

  useEffect(() => {
    if (state?.settings.theme) document.body.dataset.theme = state.settings.theme;
  }, [state?.settings.theme]);

  if (!state) {
    return (
      <div className="boot">
        <span className="boot-logo">
          <Icon name="link" size={28} />
        </span>
        <span>Starting Connectivity…</span>
      </div>
    );
  }

  const primaryPeer = connectedPeers[0]?.id;
  // Prefer the extra (virtual) monitor for "second screen" shortcuts.
  const secondDisplayId = state.displays.find((d) => !d.primary)?.id;

  return (
    <div className="app">
      <Sidebar
        route={route}
        onNavigate={setRoute}
        deviceName={state.settings.deviceName}
        ip={state.net.ip}
        connectedCount={connectedPeers.length}
      />

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{titleFor(route)}</h1>
            <p className="subtitle">{subtitleFor(route)}</p>
          </div>
          <div className="topbar-actions">
            <span className={`conn-chip ${connectedPeers.length ? 'on' : 'off'}`}>
              <span className="dot" />
              {connectedPeers.length ? `${connectedPeers.length} device${connectedPeers.length > 1 ? 's' : ''} online` : 'Waiting for tablet'}
            </span>
            <button
              className="icon-btn"
              title="Toggle theme"
              onClick={() => void updateSettings({ theme: state.settings.theme === 'dark' ? 'light' : 'dark' })}
              type="button"
            >
              <Icon name={state.settings.theme === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
            <button className="icon-btn" title="Refresh devices" onClick={() => void refresh()} type="button">
              <Icon name="refresh" size={18} />
            </button>
          </div>
        </header>

        <div className="content">
          {route === 'home' && (
            <Home
              state={state}
              peers={peers}
              rtcState={rtcState}
              onNavigate={setRoute}
              onStart={(mode) => {
                if (!primaryPeer) {
                  toast('info', 'No tablet connected yet — open Connectivity on your tablet');
                  return;
                }
                const displays = state.displays;
                const primary = displays.find((d) => d.primary);
                const second = displays.find((d) => !d.primary);
                // Mirror = laptop panel, Extend = the extra monitor (never the laptop panel).
                if (mode === 'extend' && !second) {
                  setRoute('extend');
                  toast('info', 'Koi doosri screen nahi mili — Extend page par driver setup dekho');
                  return;
                }
                void pushToTablet(mode, primaryPeer, {
                  kind: 'screen',
                  displayId: mode === 'extend' ? second?.id : primary?.id,
                });
              }}
              onStop={stopStream}
            />
          )}
          {route === 'devices' && (
            <Devices peers={peers} state={state} onStart={() => setRoute('mirror')} onRefresh={() => void refresh()} />
          )}
          {route === 'mirror' && (
            <Mirror
              peers={peers}
              state={state}
              rtcState={rtcState}
              localStream={localStream}
              remoteStream={remoteStream}
              onStartMirror={(deviceId, displayId) =>
                void pushToTablet('mirror-pc', deviceId, { kind: 'screen', displayId })
              }
              onStartTabletView={(deviceId) =>
                void window.sc.send(deviceId, { type: 'request-tablet-screen' })
              }
              onStop={stopStream}
            />
          )}
          {route === 'extend' && (
            <Extend
              peers={peers}
              state={state}
              rtcState={rtcState}
              localStream={localStream}
              onStart={(deviceId, target) => void pushToTablet('extend', deviceId, target)}
              onStop={stopStream}
            />
          )}
          {route === 'share' && (
            <Share
              state={state}
              shared={shared}
              transfers={transfers}
              onAdd={async () => {
                const added = await window.sc.pickShare();
                if (added.length) toast('success', `${added.length} file(s) ready to share`);
              }}
              onRemove={(token) => void window.sc.removeShare(token)}
            />
          )}
          {route === 'settings' && <SettingsPage state={state} onChange={updateSettings} />}
        </div>
      </main>

      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.level}`}>
            <Icon name={item.level === 'error' ? 'close' : item.level === 'success' ? 'check' : 'bolt'} size={16} />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function titleFor(route: Route): string {
  switch (route) {
    case 'devices':
      return 'Devices';
    case 'mirror':
      return 'Mirror & control';
    case 'extend':
      return 'Extend display';
    case 'share':
      return 'File sharing';
    case 'settings':
      return 'Settings';
    default:
      return 'Good to see you';
  }
}

function subtitleFor(route: Route): string {
  switch (route) {
    case 'devices':
      return 'Everything Connectivity can see on your network right now.';
    case 'mirror':
      return 'Stream a screen both ways — no cables, no accounts.';
    case 'extend':
      return 'Turn your tablet into a second screen for this PC.';
    case 'share':
      return 'Drop files here and grab them instantly on your tablet.';
    case 'settings':
      return 'Name, ports, clipboard and connection preferences.';
    default:
      return 'Your PC and tablet, connected over your own Wi-Fi.';
  }
}
