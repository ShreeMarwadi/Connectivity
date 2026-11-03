import type { CaptureTarget, WsEnvelope } from '../../../shared/types';

export type SessionMode = 'mirror-pc' | 'mirror-tablet' | 'extend' | 'webcam';

export interface RtcCallbacks {
  onRemoteStream: (stream: MediaStream | null) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onState: (state: RTCPeerConnectionState | 'idle', mode: SessionMode | null) => void;
  onError: (message: string) => void;
}

const BITRATES: Record<string, number> = {
  speed: 2_500_000,
  balanced: 5_000_000,
  quality: 8_000_000,
};

/** Steady 30 fps beats a jumpy 60: this class of tablet decodes ~30 anyway. */
const CAPTURE_FPS = 30;

/**
 * Chromium's default VP8 path is software-only and cannot hold 1920x1200 at 30 fps on
 * most laptops, so it drops frames (the "slow / choppy" feel). H.264 is encoded by the
 * GPU (Media Foundation on Windows), so prefer it when the sender offers it.
 */
function preferHardwareCodec(transceiver: RTCRtpTransceiver): void {
  try {
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps) return;
    const h264 = caps.codecs.filter((codec) => /h264/i.test(codec.mimeType));
    if (h264.length === 0) return;
    const rest = caps.codecs.filter((codec) => !/h264/i.test(codec.mimeType));
    transceiver.setCodecPreferences([...h264, ...rest]);
  } catch {
    /* keep Chromium's default order */
  }
}

function makeSessionId(): string {
  return crypto.randomUUID();
}

/**
 * RTCSessionDescription exposes `type`/`sdp` on the prototype in Chromium, so plain
 * JSON.stringify() would send `{}`. Always convert to a plain object before sending.
 */
function plainSdp(description: RTCSessionDescription | null): RTCSessionDescriptionInit | null {
  if (!description) return null;
  return { type: description.type, sdp: description.sdp };
}

export class DesktopRtc {
  private pc: RTCPeerConnection | null = null;
  private session: string | null = null;
  private mode: SessionMode | null = null;
  private deviceId: string | null = null;
  private remoteIce: RTCIceCandidateInit[] = [];
  private remoteReady = false;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  constructor(
    private send: (deviceId: string, message: WsEnvelope) => void,
    private callbacks: RtcCallbacks,
  ) {}

  get activeMode(): SessionMode | null {
    return this.mode;
  }

  /** Device currently receiving our screen, or null when idle. */
  get activeDevice(): string | null {
    return this.deviceId;
  }

  async startSending(options: {
    mode: SessionMode;
    deviceId: string;
    target: CaptureTarget;
    quality: string;
  }): Promise<void> {
    this.stop(false);
    this.mode = options.mode;
    this.deviceId = options.deviceId;
    this.session = makeSessionId();

    try {
      await window.sc.setCaptureTarget(options.target);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: CAPTURE_FPS, max: CAPTURE_FPS },
          width: { ideal: 1920 },
          height: { ideal: 1200 },
        },
        audio: false,
      });

      const [track] = stream.getVideoTracks();
      if (!track) throw new Error('No screen video track available');
      track.addEventListener('ended', () => this.stop(true));
      // "motion" tells the encoder to spend bits on movement instead of fine detail:
      // that is what makes a desktop feel fluid while dragging windows / scrolling.
      track.contentHint = 'motion';

      this.localStream = stream;
      this.callbacks.onLocalStream(stream);

      const pc = this.createPeer();
      // addTransceiver (instead of addTrack) so we can order the codecs before the offer.
      for (const t of stream.getTracks()) {
        const transceiver = pc.addTransceiver(t, { direction: 'sendonly', streams: [stream] });
        if (t.kind === 'video') preferHardwareCodec(transceiver);
      }

      const bitrate = BITRATES[options.quality] ?? BITRATES.balanced;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.applyBitrate(bitrate);

      this.send(options.deviceId, {
        type: 'signal',
        session: this.session,
        mode: this.mode,
        data: { kind: 'offer', sdp: plainSdp(pc.localDescription) },
      });
      this.callbacks.onState(pc.connectionState, this.mode);
    } catch (err) {
      this.callbacks.onError((err as Error).message || 'Screen capture failed');
      this.stop(false);
      throw err;
    }
  }

  private createPeer(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 0 });
    this.pc = pc;
    this.remoteReady = false;
    this.remoteIce = [];

    pc.onicecandidate = (event) => {
      if (!event.candidate || !this.session || !this.deviceId) return;
      this.send(this.deviceId, {
        type: 'signal',
        session: this.session,
        mode: this.mode,
        data: { kind: 'ice', candidate: event.candidate.toJSON() },
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.remoteStream = stream;
      this.callbacks.onRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      this.callbacks.onState(pc.connectionState, this.mode);
      if (pc.connectionState === 'failed') {
        this.callbacks.onError('Connection failed. Make sure both devices are on the same Wi-Fi.');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this.callbacks.onError('Network path failed (ICE). Try restarting the session.');
      }
    };

    return pc;
  }

  async handleSignal(
    deviceId: string,
    message: { session?: string; mode?: SessionMode; data?: { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } },
  ): Promise<void> {
    const data = message.data;
    if (!data) return;
    this.deviceId = deviceId;

    try {
      if (data.kind === 'offer' && data.sdp) {
        // Tablet initiated (mirror-tablet). Answer it.
        this.mode = message.mode ?? 'mirror-tablet';
        this.session = message.session ?? makeSessionId();
        this.closePeer();
        const pc = this.createPeer();
        this.callbacks.onState(pc.connectionState, this.mode);
        await pc.setRemoteDescription(data.sdp);
        this.remoteReady = true;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send(deviceId, {
          type: 'signal',
          session: this.session,
          mode: this.mode,
          data: { kind: 'answer', sdp: plainSdp(pc.localDescription) },
        });
        await this.flushIce();
        return;
      }

      if (!this.pc || message.session !== this.session) return;

      if (data.kind === 'answer' && data.sdp) {
        await this.pc.setRemoteDescription(data.sdp);
        this.remoteReady = true;
        await this.flushIce();
        return;
      }

      if (data.kind === 'ice' && data.candidate) {
        if (this.remoteReady) {
          await this.pc.addIceCandidate(data.candidate);
        } else {
          this.remoteIce.push(data.candidate);
        }
      }
    } catch (err) {
      this.callbacks.onError(`Signaling error: ${(err as Error).message}`);
    }
  }

  private async flushIce(): Promise<void> {
    if (!this.pc) return;
    const pending = this.remoteIce;
    this.remoteIce = [];
    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        /* ignore stale candidate */
      }
    }
  }

  private async applyBitrate(bitrate: number): Promise<void> {
    if (!this.pc) return;
    for (const sender of this.pc.getSenders()) {
      if (!sender.track || sender.track.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].maxBitrate = bitrate;
        // Cap the frame rate at the source rate; without this the encoder can overshoot
        // and then dump a burst of frames, which reads as stutter on the tablet.
        params.encodings[0].maxFramerate = CAPTURE_FPS;
        // Default ("balanced") drops frames to keep the picture sharp. For a second
        // monitor the frame rate matters more than fine detail, so keep the rate up.
        try {
          params.degradationPreference = 'maintain-framerate';
        } catch {
          /* older Chromium ignores the hint */
        }
        await sender.setParameters(params);
      } catch {
        /* some platforms reject parameter changes */
      }
    }
  }

  private closePeer(): void {
    if (!this.pc) return;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.remoteReady = false;
    this.remoteIce = [];
  }

  stop(notify = true): void {
    if (notify && this.deviceId && this.session) {
      this.send(this.deviceId, { type: 'session-stop', session: this.session });
    }
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    this.remoteStream = null;
    this.closePeer();
    this.session = null;
    this.deviceId = null;
    const previousMode = this.mode;
    this.mode = null;
    this.callbacks.onLocalStream(null);
    this.callbacks.onRemoteStream(null);
    this.callbacks.onState('idle', previousMode);
  }
}


