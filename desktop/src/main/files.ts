import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { SharedFile, TransferItem } from '../shared/types';
import { getSettings } from './settings';

function uniqueName(dir: string, name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'file';
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  let candidate = path.join(dir, safe);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

export class FileService extends EventEmitter {
  private shared = new Map<string, SharedFile>();
  private transfers: TransferItem[] = [];

  list(): SharedFile[] {
    return [...this.shared.values()].sort((a, b) => b.addedAt - a.addedAt);
  }

  transferList(): TransferItem[] {
    return this.transfers.slice(0, 50);
  }

  add(paths: string[]): SharedFile[] {
    const added: SharedFile[] = [];
    for (const p of paths) {
      try {
        const stat = fs.statSync(p);
        if (!stat.isFile()) continue;
        const existing = [...this.shared.values()].find((f) => f.path === p);
        if (existing) {
          existing.size = stat.size;
          added.push(existing);
          continue;
        }
        const file: SharedFile = {
          token: randomUUID().replace(/-/g, '').slice(0, 16),
          name: path.basename(p),
          size: stat.size,
          path: p,
          addedAt: Date.now(),
        };
        this.shared.set(file.token, file);
        added.push(file);
      } catch {
        /* skip unreadable file */
      }
    }
    this.emit('shared', this.list());
    return added;
  }

  remove(token: string): void {
    this.shared.delete(token);
    this.emit('shared', this.list());
  }

  resolve(token: string): SharedFile | null {
    return this.shared.get(token) ?? null;
  }

  private pushProgress(item: TransferItem): void {
    const now = Date.now();
    const last = (item as TransferItem & { _lastEmit?: number })._lastEmit ?? 0;
    if (now - last < 200 && item.bytes !== item.size) return;
    (item as TransferItem & { _lastEmit?: number })._lastEmit = now;
    this.emit('transfer', this.transferList());
  }

  createUpload(name: string): { item: TransferItem; filePath: string } {
    const settings = getSettings();
    fs.mkdirSync(settings.receiveDir, { recursive: true });
    const filePath = uniqueName(settings.receiveDir, name);
    const item: TransferItem = {
      id: randomUUID(),
      name: path.basename(filePath),
      size: 0,
      bytes: 0,
      direction: 'down',
      status: 'running',
      at: Date.now(),
    };
    this.transfers.unshift(item);
    this.emit('transfer', this.transferList());
    return { item, filePath };
  }

  trackUpload(item: TransferItem, bytes: number, total: number): void {
    item.bytes = bytes;
    if (total) item.size = total;
    this.pushProgress(item);
  }

  finishUpload(item: TransferItem, ok: boolean, error?: string): void {
    item.status = ok ? 'done' : 'error';
    item.error = error;
    if (ok && item.size === 0) {
      try {
        const p = path.join(getSettings().receiveDir, item.name);
        item.size = fs.statSync(p).size;
        item.bytes = item.size;
      } catch {
        /* ignore */
      }
    }
    this.emit('transfer', this.transferList());
  }

  noteDownload(name: string, size: number): TransferItem {
    const item: TransferItem = {
      id: randomUUID(),
      name,
      size,
      bytes: 0,
      direction: 'up',
      status: 'running',
      at: Date.now(),
    };
    this.transfers.unshift(item);
    this.emit('transfer', this.transferList());
    return item;
  }

  progressDownload(item: TransferItem, bytes: number): void {
    item.bytes = bytes;
    this.pushProgress(item);
  }

  finishDownload(item: TransferItem, ok: boolean): void {
    item.status = ok ? 'done' : 'error';
    if (ok) item.bytes = item.size;
    this.emit('transfer', this.transferList());
  }
}
