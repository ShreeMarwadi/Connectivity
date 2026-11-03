import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Settings } from '../shared/types';

const DEFAULTS: Settings = {
  deviceName: os.hostname().toUpperCase(),
  wsPort: 47800,
  httpPort: 47801,
  receiveDir: '',
  theme: 'light',
  autoAccept: true,
  clipboardSync: true,
  inputEnabled: true,
  cursorGuard: true,
  quality: 'balanced',
};

let cached: Settings | null = null;

function defaults(): Settings {
  const dir = path.join(app.getPath('downloads'), 'SmartConnectLike');
  return {
    ...DEFAULTS,
    deviceName: os.hostname().toUpperCase(),
    receiveDir: dir,
  };
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (cached) return cached;
  const base = defaults();
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    cached = { ...base, ...parsed };
  } catch {
    cached = base;
  }
  if (!cached.receiveDir) cached.receiveDir = base.receiveDir;
  try {
    fs.mkdirSync(cached.receiveDir, { recursive: true });
  } catch {
    /* ignore */
  }
  return cached;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  cached = next;
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] save failed', err);
  }
  if (next.receiveDir) {
    try {
      fs.mkdirSync(next.receiveDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  return next;
}
