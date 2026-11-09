import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Discovery, primaryAddress } from './discovery';
import { LocalServer } from './server';
import { FileService } from './files';
import { InputController } from './input';
import { disposeVcam, vcamDisable, vcamEnable, vcamFrame, vcamPlaceholder, vcamPrime, vcamStart, vcamStatus, vcamStop } from './vcam';
import {
  invalidateVirtualDisplays,
  isVirtualDisplay,
  refreshVirtualDisplays,
  setVirtualDisplayListener,
} from './virtualdisplay';
import { getSettings, updateSettings } from './settings';
import type { CaptureTarget, DisplayInfo, PeerInfo, Settings, WindowSource, WsEnvelope } from '../shared/types';

const DEVICE_ID = randomUUID();
const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let discovery: Discovery | null = null;
let server: LocalServer | null = null;
const fileService = new FileService();
const input = new InputController();

let captureTarget: CaptureTarget = { kind: 'screen' };
/**
 * True only while the tablet is *actually* connected to an extend stream. It is not
 * enough for `captureTarget` to point at the virtual monitor: a start that failed or
 * timed out leaves that target behind, and keying the guard off it kept the pointer
 * free to wander into the invisible screen.
 */
let extendSessionLive = false;
let clipboardTimer: NodeJS.Timeout | null = null;
let cursorGuardTimer: NodeJS.Timeout | null = null;
let lastClipboard = '';

const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
const rendererEntry = path.join(__dirname, '..', 'renderer', 'index.html');

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function peersWithStatus() {
  if (!discovery || !server) return [];
  const connected = new Set(server.clientIds());
  return discovery.peerList().map((peer) => ({ ...peer, connected: connected.has(peer.id) }));
}

function displayList(): DisplayInfo[] {
  const displays = screen.getAllDisplays();
  return displays.map((display) => ({
    id: String(display.id),
    label: display.label || `Display ${display.id}`,
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    primary: display.id === screen.getPrimaryDisplay().id,
    virtual: isVirtualDisplay(display.label),
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
  }));
}

/** Physical (not DIP) rectangle of a monitor — needed for SetCursorPos on scaled screens. */
function physicalBounds(displayId: string): { x: number; y: number; width: number; height: number } | null {
  const display = screen.getAllDisplays().find((d) => String(d.id) === displayId);
  if (!display) return null;
  try {
    // null (not mainWindow): a window's rect conversion uses that window's DPI, which
    // rescales a monitor that sits on another display with a different scale factor.
    return screen.dipToScreenRect(null, display.bounds);
  } catch {
    const scale = display.scaleFactor || 1;
    return {
      x: Math.round(display.bounds.x * scale),
      y: Math.round(display.bounds.y * scale),
      width: Math.round(display.bounds.width * scale),
      height: Math.round(display.bounds.height * scale),
    };
  }
}

/**
 * When a session ends the tablet stops showing the extra monitor, so anything left there is
 * invisible: windows dragged over come back to the laptop and the pointer is parked home.
 */
function restoreAfterSession(): { moved: number; display: string } {
  // A session is over no matter which early return we take below: never leave the
  // guard thinking the tablet is still showing the extra monitor.
  extendSessionLive = false;

  const primary = screen.getPrimaryDisplay();
  const home = physicalBounds(String(primary.id));
  if (!home) return { moved: 0, display: '' };

  const targetId = captureTarget.kind === 'screen' ? captureTarget.displayId : undefined;
  if (!targetId || targetId === String(primary.id)) {
    return { moved: 0, display: primary.label || 'laptop' };
  }

  const from = physicalBounds(targetId);
  if (!from) return { moved: 0, display: primary.label || 'laptop' };

  const moved = input.rescueWindows(from, home);

  // Only yank the pointer if it is actually sitting on the tablet screen.
  const monitor = screen.getAllDisplays().find((d) => String(d.id) === targetId);
  if (monitor) {
    const cursor = screen.getCursorScreenPoint();
    const b = monitor.bounds;
    if (cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height) {
      input.moveCursorHome(home);
    }
  }

  // The session is over: the extra monitor is just a black hole now, so treat the laptop
  // as the capture target again (the idle cursor guard keys off this).
  captureTarget = { kind: 'screen', displayId: String(primary.id) };
  input.setTargetRect(home);
  return { moved, display: primary.label || 'laptop' };
}

/**
 * True only while a live extend session is actually streaming that monitor. A stale
 * capture target from a failed/timed-out start must never free the pointer.
 */
function extraMonitorIsLive(): boolean {
  if (!extendSessionLive) return false;
  if (captureTarget.kind !== 'screen' || !captureTarget.displayId) return false;
  const primary = screen.getPrimaryDisplay();
  return captureTarget.displayId !== String(primary.id);
}

/**
 * Windows keeps the virtual monitor attached even when the tablet is off (or the session
 * stopped), so the cursor wanders into an invisible screen and looks like it vanished.
 * While no session is live, push the pointer back to the edge of the laptop panel.
 */
function guardCursor(): void {
  if (!getSettings().cursorGuard) return;
  if (extraMonitorIsLive()) return;

  const primary = screen.getPrimaryDisplay();
  const cursor = screen.getCursorScreenPoint();
  const pb = primary.bounds;
  const insidePrimary =
    cursor.x >= pb.x && cursor.x < pb.x + pb.width && cursor.y >= pb.y && cursor.y < pb.y + pb.height;
  if (insidePrimary) return;

  const strays = screen
    .getAllDisplays()
    .filter((d) => String(d.id) !== String(primary.id) && isVirtualDisplay(d.label));
  const hit = strays.find(
    (d) =>
      cursor.x >= d.bounds.x &&
      cursor.x < d.bounds.x + d.bounds.width &&
      cursor.y >= d.bounds.y &&
      cursor.y < d.bounds.y + d.bounds.height,
  );
  if (!hit) return;

  // Clamp onto the nearest edge of the laptop screen (with a 3px inset so the pointer stays visible).
  const inset = 3;
  const dipX = Math.min(Math.max(cursor.x, pb.x + inset), pb.x + pb.width - inset - 1);
  const dipY = Math.min(Math.max(cursor.y, pb.y + inset), pb.y + pb.height - inset - 1);
  const home = physicalBounds(String(primary.id));
  if (!home) return;
  const px = home.x + ((dipX - pb.x) / Math.max(1, pb.width)) * home.width;
  const py = home.y + ((dipY - pb.y) / Math.max(1, pb.height)) * home.height;
  input.setCursor(px, py);
}

function startCursorGuard(): void {
  if (cursorGuardTimer) clearInterval(cursorGuardTimer);
  const tick = (): void => {
    try {
      guardCursor();
    } catch {
      /* never let the guard throw */
    }
  };
  // Re-arm immediately: the pointer may already be parked on the idle virtual screen
  // from a previous run, and there is no reason to wait for the first 200 ms tick.
  tick();
  cursorGuardTimer = setInterval(tick, 200);
}



function broadcastPeerState(): void {
  send('peers', peersWithStatus());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f4f6fb',
    title: 'Connectivity',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(rendererEntry);
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // Closing the window hides it to the tray instead of quitting: the network server
  // and the cursor guard must keep running so the virtual screen cannot swallow the
  // pointer while the app is "off". Quit is an explicit tray action.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function createTray(): Promise<void> {
  if (tray) return;
  let icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png'));
  if (icon.isEmpty()) {
    try {
      icon = await app.getFileIcon(process.execPath, { size: 'small' });
    } catch {
      /* fall through: no icon means no tray, the app still works */
    }
  }
  if (icon.isEmpty()) return;

  tray = new Tray(icon);
  tray.setToolTip('Connectivity');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Connectivity', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => showWindow());
}

/** `window:<hwnd>:<timestamp>` -> hwnd, so touch input can be mapped onto it. */
function hwndFromSourceId(sourceId: string | undefined): number | null {
  if (!sourceId) return null;
  const match = /^window:(\d+)/.exec(sourceId);
  if (!match) return null;
  const hwnd = Number(match[1]);
  return Number.isFinite(hwnd) && hwnd > 0 ? hwnd : null;
}

function isOwnWindow(name: string, id: string): boolean {
  if (id === 'window:0:0') return true;
  if (name === 'Program Manager' || name === 'Desktop') return true;
  return name.includes('Connectivity') || name.includes('SmartConnectLike');
}

async function listWindows(): Promise<WindowSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });
  return sources
    .filter((source) => source.name && !isOwnWindow(source.name, source.id))
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
      icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function setupDisplayCapture(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const wanted = captureTarget;
        if (wanted.kind === 'window') {
          const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 0, height: 0 },
          });
          const source =
            sources.find((s) => s.id === wanted.sourceId) ??
            (wanted.sourceName ? sources.find((s) => s.name === wanted.sourceName) : undefined) ??
            null;
          if (!source) {
            console.warn('[capture] window is gone:', wanted.sourceName ?? wanted.sourceId);
            callback({});
            return;
          }
          callback({ video: source });
          return;
        }

        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
        let source = null as Electron.DesktopCapturerSource | null;
        const displayId = wanted.displayId;
        const screens = sources.filter((s) => s.id.startsWith('screen:'));
        // Electron ids are like "screen:0:0"; the real display id lives in `display_id`,
        // so matching on `screen:<displayId>` never hits and silently falls back to screen 0.
        if (displayId) {
          source =
            screens.find((s) => s.display_id === displayId) ??
            screens.find((s) => s.id === `screen:${displayId}`) ??
            null;
        }
        if (!source) {
          const primaryId = String(screen.getPrimaryDisplay().id);
          source = screens.find((s) => s.display_id === primaryId) ?? screens[0] ?? null;
        }
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source });
      } catch (err) {
        console.error('[capture] failed', err);
        callback({});
      }
    },
  );

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const name = permission as string;
    callback(name === 'media' || name === 'display-capture' || name === 'screen-wake-lock');
  });
}

function startDiscovery(): void {
  const settings = getSettings();
  discovery = new Discovery({
    id: DEVICE_ID,
    name: settings.deviceName,
    wsPort: server?.wsPort || settings.wsPort,
    httpPort: server?.httpPort || settings.httpPort,
    features: ['mirror', 'extend', 'files', 'input', 'clipboard'],
  });
  discovery.on('peers', (peers: PeerInfo[]) =>
    send(
      'peers',
      peers.map((p) => ({ ...p, connected: server?.isConnected(p.id) ?? false })),
    ),
  );
  discovery.start();
}

async function startServer(): Promise<void> {
  const settings = getSettings();
  fileService.on('transfer', (list) => send('transfers', list));
  fileService.on('shared', (list) => send('shared', list));

  let wsPort = settings.wsPort;
  let httpPort = settings.httpPort;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const instance = new LocalServer({ fileService, deviceId: DEVICE_ID });
    instance.on('message', (incoming: { deviceId: string; msg: WsEnvelope }) => {
      const { deviceId, msg } = incoming;
      if (msg.type === 'clipboard') {
        const text = String((msg as { text?: string }).text ?? '');
        if (text && getSettings().clipboardSync) {
          lastClipboard = text;
          clipboard.writeText(text);
        }
        return;
      }
      if (msg.type === 'input') {
        if (getSettings().inputEnabled) {
          input.handle((msg as unknown as { event: any }).event);
        }
        return;
      }
      send('ws:message', { deviceId, msg });
    });
    instance.on('connected', (info) => {
      send('ws:connected', info);
      broadcastPeerState();
      instance.send(info.deviceId, {
        type: 'welcome',
        deviceId: DEVICE_ID,
        name: getSettings().deviceName,
        capabilities: { extend: true },
      });
      send('toast', { level: 'success', text: `${info.name} connected` });
    });
    instance.on('disconnected', (info) => {
      send('ws:disconnected', info);
      broadcastPeerState();
      send('toast', { level: 'info', text: `${info.name} disconnected` });
    });
    try {
      await instance.start(wsPort, httpPort);
      server = instance;
      break;
    } catch (err) {
      console.warn(`[server] ports ${wsPort}/${httpPort} busy, trying next`, (err as Error).message);
      instance.stop();
      wsPort += 1;
      httpPort += 1;
    }
  }
  if (!server) {
    send('toast', { level: 'error', text: 'Could not open network ports 47800/47801' });
  } else if (wsPort !== settings.wsPort) {
    updateSettings({ wsPort, httpPort });
  }
}

function startClipboardSync(): void {
  lastClipboard = clipboard.readText();
  if (clipboardTimer) clearInterval(clipboardTimer);
  clipboardTimer = setInterval(() => {
    try {
      const text = clipboard.readText();
      if (!text || text === lastClipboard) return;
      lastClipboard = text;
      if (!getSettings().clipboardSync) return;
      if (!server || server.clientIds().length === 0) return;
      server.broadcast({ type: 'clipboard', text });
    } catch {
      /* ignore */
    }
  }, 1200);
}

function statePayload() {
  const settings = getSettings();
  return {
    settings,
    deviceId: DEVICE_ID,
    peers: peersWithStatus(),
    net: {
      ip: primaryAddress(),
      wsPort: server?.wsPort ?? settings.wsPort,
      httpPort: server?.httpPort ?? settings.httpPort,
    },
    shared: fileService.list(),
    transfers: fileService.transferList(),
    inputAvailable: input.available,
    displays: displayList(),
    version: app.getVersion(),
    platform: process.platform,
  };
}

function watchDisplays(): void {
  // Driver installed / monitor unplugged / resolution changed → refresh the UI live.
  const notify = (): void => {
    invalidateVirtualDisplays();
    void refreshVirtualDisplays();
    send('state', statePayload());
    // A monitor may have appeared under the pointer; re-check right away.
    try {
      guardCursor();
    } catch {
      /* never let the guard throw */
    }
  };
  screen.on('display-added', notify);
  screen.on('display-removed', notify);
  screen.on('display-metrics-changed', notify);
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => statePayload());

  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = updateSettings(patch);
    discovery?.setOptions({ name: next.deviceName });
    return next;
  });

  ipcMain.handle('peers:get', () => peersWithStatus());

  ipcMain.handle('ws:send', (_e, deviceId: string, message: WsEnvelope) => {
    return server?.send(deviceId, message) ?? false;
  });

  ipcMain.handle('ws:broadcast', (_e, message: WsEnvelope) => {
    server?.broadcast(message);
    return true;
  });

  ipcMain.handle('ws:clients', () => server?.clientIds() ?? []);

  ipcMain.handle('windows:list', () => listWindows());
  ipcMain.handle('displays:list', () => displayList());

  ipcMain.handle('vcam:status', () => vcamStatus());
  ipcMain.handle('vcam:enable', async () => {
    const status = await vcamEnable();
    // Prime the placeholder writer so a camera opened in another app shows a
    // dark "no signal" card instead of the filter's green error pattern.
    if (status.registered) vcamPrime();
    return status;
  });
  ipcMain.handle('vcam:disable', () => vcamDisable());
  ipcMain.handle('vcam:start', () => vcamStart());
  ipcMain.handle('vcam:frame', (_e, rgba: ArrayBuffer, width: number, height: number) =>
    vcamFrame(rgba, width, height),
  );
  ipcMain.handle('vcam:placeholder', (_e, rgba: ArrayBuffer, width: number, height: number) =>
    vcamPlaceholder(rgba, width, height),
  );
  ipcMain.handle('vcam:stop', () => {
    vcamStop();
    return true;
  });

  ipcMain.handle('capture:target', (_e, target: CaptureTarget) => {
    captureTarget = target;
    if (target.kind === 'window') {
      // Map tablet touches onto the captured window instead of the whole screen.
      input.setTargetRect(null);
      input.setTargetHwnd(hwndFromSourceId(target.sourceId));
    } else {
      input.setTargetHwnd(null);
      // A chosen monitor (usually the virtual one) gets its own touch area.
      input.setTargetRect(target.displayId ? physicalBounds(target.displayId) : null);
    }
    return true;
  });

  ipcMain.handle('session:restore', () => restoreAfterSession());

  // The renderer is the only side that knows whether WebRTC actually connected, so it
  // tells us when the tablet is truly showing the extra monitor. Until then the guard
  // stays armed, even if a capture target was already prepared.
  ipcMain.handle('session:live', (_e, live: boolean) => {
    extendSessionLive = !!live;
    if (!extendSessionLive) {
      try {
        guardCursor();
      } catch {
        /* never let the guard throw */
      }
    }
    return true;
  });

  ipcMain.handle('virtualdisplay:settings', () => {
    void shell.openExternal('ms-settings:display');
    return true;
  });

  ipcMain.handle('virtualdisplay:driver', () => {
    void shell.openExternal('https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/latest');
    return true;
  });

  ipcMain.handle('share:add', (_e, paths: string[]) => fileService.add(paths));

  ipcMain.handle('share:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select files to share with your tablet',
    });
    if (result.canceled) return [];
    return fileService.add(result.filePaths);
  });

  ipcMain.handle('share:remove', (_e, token: string) => {
    fileService.remove(token);
    return fileService.list();
  });

  ipcMain.handle('share:list', () => fileService.list());

  ipcMain.handle('transfers:list', () => fileService.transferList());

  ipcMain.handle('clipboard:write', (_e, text: string) => {
    lastClipboard = text;
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle('files:open', async (_e, target: string) => {
    if (target === 'receive') {
      const dir = getSettings().receiveDir;
      fs.mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
      return true;
    }
    await shell.openPath(target);
    return true;
  });

  ipcMain.handle('net:refresh', () => {
    broadcastPeerState();
    return statePayload();
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    setupDisplayCapture();
    registerIpc();
    await startServer();
    startDiscovery();
    startClipboardSync();

    // Once PnP confirms which monitors are virtual, re-check the pointer and refresh
    // the Extend page's labels (a custom EDID can otherwise look like a real screen).
    setVirtualDisplayListener(() => {
      send('state', statePayload());
      try {
        guardCursor();
      } catch {
        /* never let the guard throw */
      }
    });
    void refreshVirtualDisplays();

    createWindow();
    void createTray();
    watchDisplays();
    startCursorGuard();

    // If the virtual camera is already registered, keep a placeholder frame in
    // its shared buffer from the start so other apps never see the filter's
    // green "sender stopped / never started" pattern.
    void vcamStatus()
      .then((status) => {
        if (status.registered) vcamPrime();
      })
      .catch(() => undefined);

    app.on('activate', () => showWindow());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // Allow the window's close handler to actually close (instead of hiding to tray).
    isQuitting = true;
    if (clipboardTimer) clearInterval(clipboardTimer);
    if (cursorGuardTimer) clearInterval(cursorGuardTimer);
    try {
      disposeVcam();
    } catch {
      /* never block quitting */
    }
    try {
      restoreAfterSession();
    } catch {
      /* never block quitting */
    }
    discovery?.stop();
    server?.stop();
    tray?.destroy();
    tray = null;
  });
}
