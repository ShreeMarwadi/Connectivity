/**
 * Pumps the live Facecam stream into the Windows virtual camera.
 *
 * Kept outside the Facecam page on purpose: the stream must keep flowing while
 * the user is in Discord/Zoom or browsing another page of the app. A plain
 * interval (not requestAnimationFrame) is used because animation frames can be
 * paused when another app covers the window.
 */
const FEED_WIDTH = 1280;
const FEED_HEIGHT = 720;
const FEED_INTERVAL = 66; // ~15 fps is plenty for a webcam and keeps CPU low

let video: HTMLVideoElement | null = null;
let timer: number | null = null;
let stream: MediaStream | null = null;
let mirror = false;
let registered = false;
let sending = false;
const listeners = new Set<(sending: boolean) => void>();

function report(next: boolean): void {
  if (next === sending) return;
  sending = next;
  for (const listener of listeners) listener(next);
}

export function subscribeVcamSending(listener: (sending: boolean) => void): () => void {
  listeners.add(listener);
  listener(sending);
  return () => {
    listeners.delete(listener);
  };
}

/** Mirror setting of the outgoing camera feed (the in-app preview has its own). */
export function setVcamMirror(value: boolean): void {
  mirror = value;
}

/** Whether the Windows virtual camera is registered; no feed is sent otherwise. */
export function setVcamRegistered(value: boolean): void {
  if (value === registered) return;
  registered = value;
  if (!value) {
    stopVcamFeed(false);
    return;
  }
  if (stream && timer === null) startVcamFeed(stream);
}

export function startVcamFeed(next: MediaStream): void {
  if (stream === next && timer !== null) return;
  stopVcamFeed(false);
  stream = next;

  if (!registered) return;

  const element = document.createElement('video');
  element.muted = true;
  element.playsInline = true;
  element.srcObject = next;
  void element.play().catch(() => undefined);
  video = element;

  const canvas = document.createElement('canvas');
  canvas.width = FEED_WIDTH;
  canvas.height = FEED_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  void window.sc.vcamStart();

  timer = window.setInterval(() => {
    const source = video;
    if (!source || source.readyState < 2 || !source.videoWidth) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, FEED_WIDTH, FEED_HEIGHT);
    const scale = Math.min(FEED_WIDTH / source.videoWidth, FEED_HEIGHT / source.videoHeight);
    const width = source.videoWidth * scale;
    const height = source.videoHeight * scale;
    const x = (FEED_WIDTH - width) / 2;
    const y = (FEED_HEIGHT - height) / 2;
    if (mirror) {
      ctx.save();
      ctx.translate(FEED_WIDTH, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, FEED_WIDTH - x - width, y, width, height);
      ctx.restore();
    } else {
      ctx.drawImage(source, x, y, width, height);
    }

    const rgba = ctx.getImageData(0, 0, FEED_WIDTH, FEED_HEIGHT).data;
    window.sc
      .vcamFrame(rgba.buffer as ArrayBuffer, FEED_WIDTH, FEED_HEIGHT)
      .then(report)
      .catch(() => report(false));
  }, FEED_INTERVAL);
}

export function stopVcamFeed(notifyMain = true): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  if (video) {
    video.srcObject = null;
    video = null;
  }
  stream = null;
  report(false);
  // The main process keeps a "Start Facecam" card in the camera buffer from now
  // on, so apps show that instead of the driver's green error pattern.
  if (notifyMain) void window.sc.vcamStop();
}
