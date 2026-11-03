import { useCallback, useEffect, useRef, useState } from 'react';
import type { PeerInfo, VcamStatus } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, EmptyState, Pill, Toggle } from '../components/UI';
import type { SessionMode } from '../lib/rtc';

const FEED_WIDTH = 1280;
const FEED_HEIGHT = 720;
const FEED_INTERVAL = 66; // ~15 fps is plenty for a webcam and keeps CPU low

function Preview({
  stream,
  mirrored,
  videoRef,
}: {
  stream: MediaStream | null;
  mirrored: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
}) {
  useEffect(() => {
    const element = videoRef.current;
    if (element && element.srcObject !== stream) {
      element.srcObject = stream;
      if (stream) void element.play().catch(() => undefined);
    }
  }, [stream, videoRef]);

  return (
    <div className={`video-frame ${stream ? 'live' : ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
      />
      {!stream ? (
        <div className="video-placeholder">
          <Icon name="camera" size={26} />
          <span>Start Facecam - the tablet camera preview appears here</span>
        </div>
      ) : null}
    </div>
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case 'connected':
      return 'Live';
    case 'connecting':
    case 'new':
      return 'Connecting...';
    case 'disconnected':
      return 'Reconnecting...';
    case 'failed':
      return 'Failed';
    case 'closed':
      return 'Closed';
    default:
      return 'Waiting...';
  }
}

export default function Facecam({
  peers,
  rtcState,
  remoteStream,
  onStart,
  onStop,
  onFlip,
}: {
  peers: PeerInfo[];
  rtcState: { state: string; mode: SessionMode | null };
  remoteStream: MediaStream | null;
  onStart: (deviceId: string) => void;
  onStop: () => void;
  onFlip: () => void;
}) {
  const connected = peers.filter((p) => p.connected);
  const peerIds = connected.map((p) => p.id).join(',');
  const [deviceId, setDeviceId] = useState(connected[0]?.id ?? '');
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [mirrorFeed, setMirrorFeed] = useState(false);
  const [vcam, setVcam] = useState<VcamStatus | null>(null);
  const [vcamBusy, setVcamBusy] = useState(false);
  const [pumping, setPumping] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!connected.some((p) => p.id === deviceId)) setDeviceId(connected[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerIds]);

  const live = rtcState.mode === 'webcam' && rtcState.state !== 'idle';
  const selected = connected.find((p) => p.id === deviceId);
  const hasPreview = !!remoteStream;

  const refreshVcam = useCallback(async () => {
    try {
      setVcam(await window.sc.vcamStatus());
    } catch {
      setVcam(null);
    }
  }, []);

  useEffect(() => {
    void refreshVcam();
  }, [refreshVcam]);

  const toggleVcam = async () => {
    if (!vcam) return;
    setVcamBusy(true);
    try {
      setVcam(vcam.registered ? await window.sc.vcamDisable() : await window.sc.vcamEnable());
    } finally {
      setVcamBusy(false);
    }
  };

  // Feed the live tablet camera into the Windows virtual camera while streaming.
  useEffect(() => {
    if (!hasPreview || !vcam?.registered) {
      setPumping(false);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = FEED_WIDTH;
    canvas.height = FEED_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let frame = 0;
    let last = 0;
    let stopped = false;
    let wasSending = false;

    const report = (sent: boolean) => {
      if (sent === wasSending) return;
      wasSending = sent;
      setPumping(sent);
    };

    const tick = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      if (now - last < FEED_INTERVAL) return;
      last = now;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, FEED_WIDTH, FEED_HEIGHT);
      const scale = Math.min(FEED_WIDTH / video.videoWidth, FEED_HEIGHT / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      const x = (FEED_WIDTH - width) / 2;
      const y = (FEED_HEIGHT - height) / 2;
      if (mirrorFeed) {
        ctx.save();
        ctx.translate(FEED_WIDTH, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, FEED_WIDTH - x - width, y, width, height);
        ctx.restore();
      } else {
        ctx.drawImage(video, x, y, width, height);
      }

      const rgba = ctx.getImageData(0, 0, FEED_WIDTH, FEED_HEIGHT).data;
      window.sc
        .vcamFrame(rgba.buffer as ArrayBuffer, FEED_WIDTH, FEED_HEIGHT)
        .then(report)
        .catch(() => report(false));
    };

    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      setPumping(false);
      void window.sc.vcamStop();
    };
  }, [hasPreview, vcam?.registered, mirrorFeed]);

  const vcamReady = !!vcam?.registered;
  const vcamTone = pumping && vcamReady ? 'ok' : vcamReady ? 'warn' : 'neutral';
  const vcamLabel = pumping && vcamReady ? 'Sending frames' : vcamReady ? 'Enabled' : 'Not enabled';

  return (
    <div className="stack">
      <div className="mirror-grid">
        <Card className="panel">
          <div className="panel-head">
            <div>
              <h3>Tablet -&gt; PC camera</h3>
              <p className="muted">
                Your tablet becomes the webcam. Start it here, then pick the camera inside the app you are using.
              </p>
            </div>
            <Pill tone={hasPreview ? 'ok' : live ? 'warn' : 'neutral'}>
              {hasPreview ? 'Camera live' : live ? stateLabel(rtcState.state) : 'Idle'}
            </Pill>
          </div>

          <Preview stream={remoteStream} mirrored={mirrorPreview} videoRef={videoRef} />

          <div className="field-row">
            <label className="field">
              <span>Tablet</span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={live}>
                {connected.length === 0 ? <option value="">No tablet connected</option> : null}
                {connected.map((peer) => (
                  <option key={peer.id} value={peer.id}>
                    {peer.name} - {peer.ip}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={!selected || live}
                onClick={() => {
                  if (selected) onStart(selected.id);
                }}
              >
                <Icon name="play" size={16} /> Start Facecam
              </button>
              <button className="btn btn-ghost" type="button" onClick={onStop} disabled={!live && !hasPreview}>
                <Icon name="stop" size={16} /> Stop
              </button>
            </div>
          </div>

          <div className="panel-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" type="button" onClick={onFlip} disabled={!live}>
              <Icon name="camera" size={16} /> Flip camera
            </button>
            <span className="note" style={{ margin: 0 }}>
              Tap the tablet screen to flip too.
            </span>
          </div>

          <p className="note">
            The tablet keeps its screen on while the facecam is running. Keep the app open - the stream stops if the
            tablet disconnects.
          </p>
        </Card>

        <Card className="panel">
          <div className="panel-head">
            <div>
              <h3>Windows virtual camera</h3>
              <p className="muted">Makes the tablet camera show up as a real webcam in any app.</p>
            </div>
            <Pill tone={vcamTone}>{vcamLabel}</Pill>
          </div>

          <div className="toggle-grid">
            <Toggle
              label="Mirror preview"
              description="Only changes what you see on this PC, not the camera feed"
              checked={mirrorPreview}
              onChange={setMirrorPreview}
            />
            <Toggle
              label="Mirror camera output"
              description="Mirrors the feed that other apps receive"
              checked={mirrorFeed}
              onChange={setMirrorFeed}
            />
          </div>

          <div className="panel-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" type="button" disabled={vcamBusy || !vcam?.driverPresent} onClick={toggleVcam}>
              <Icon name={vcamReady ? 'check' : 'bolt'} size={16} />
              {vcamBusy ? 'Waiting for Windows...' : vcamReady ? 'Disable virtual camera' : 'Enable virtual camera'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => void refreshVcam()} disabled={vcamBusy}>
              <Icon name="refresh" size={16} /> Refresh
            </button>
          </div>

          <p className="note">
            {vcam?.detail ??
              'Connectivity ships the camera driver with the app. It only has to be enabled once per PC (Windows asks for admin approval).'}
          </p>
          <p className="note">
            <strong>Inside other apps:</strong> pick <strong>{vcam?.name ?? 'Connectivity Camera'}</strong> in Zoom,
            Meet, Discord, OBS or any website camera picker. Frames only flow while Facecam is running above - until then
            the camera shows a black image.
          </p>
        </Card>
      </div>

      {connected.length === 0 ? (
        <EmptyState
          icon="tablet"
          title="No tablet connected"
          description="Open Connectivity on the tablet, keep both devices on the same Wi-Fi, then start Facecam."
        />
      ) : null}
    </div>
  );
}
