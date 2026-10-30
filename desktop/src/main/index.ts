import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, screen, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Discovery, primaryAddress } from './discovery';
import { LocalServer } from './server';
import { FileService } from './files';
import { InputController } from './input';
import { getSettings, updateSettings } from './settings';
import type { CaptureTarget, DisplayInfo, PeerInfo, Settings, WindowSource, WsEnvelope } from '../shared/types';

const DEVICE_ID = randomUUID();
const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let discovery: Discovery | null = null;
let server: LocalServer | null = null;
const fileService = new FileService();
const input = new InputController();

let captureTarget: CaptureTarget = { kind: 'screen' };
let clipboardTimer: NodeJS.Timeout | null = null;
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

/**
 * A virtual display driver (MTT VDD, Parsec VDD, IddSample…) shows up as an extra
 * monitor. Its label varies, so fall back to "not the primary screen".
 */
const VIRTUAL_LABEL = /virtual|vdd|mtt|parsec|idd|spacedesk|dummy|indirect/i;

function displayList(): DisplayInfo[] {
  const displays = screen.getAllDisplays();
  return displays.map((display) => ({
    id: String(display.id),
    label: display.label || `Display ${display.id}`,
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    primary: display.id === screen.getPrimaryDisplay().id,
    virtual: VIRTUAL_LABEL.test(display.label || ''),
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
  return { moved, display: primary.label || 'laptop' };
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
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  const notify = (): void => send('state', statePayload());
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
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    setupDisplayCapture();
    registerIpc();
    await startServer();
    startDiscovery();
    startClipboardSync();
    createWindow();
    watchDisplays();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (clipboardTimer) clearInterval(clipboardTimer);
    try {
      restoreAfterSession();
    } catch {
      /* never block quitting */
    }
    discovery?.stop();
    server?.stop();
  });
}
