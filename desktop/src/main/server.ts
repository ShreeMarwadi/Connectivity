import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { SharedFile, TransferItem } from '../shared/types';
import type { FileService } from './files';
import { getSettings } from './settings';

export interface IncomingMessage {
  deviceId: string;
  ip: string;
  msg: Record<string, unknown>;
}

interface Props {
  fileService: FileService;
  deviceId: string;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

export class LocalServer extends EventEmitter {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WebSocket>();
  private props: Props;
  private info = { ws: 0, http: 0 };

  constructor(props: Props) {
    super();
    this.props = props;
  }

  get wsPort(): number {
    return this.info.ws;
  }

  get httpPort(): number {
    return this.info.http;
  }

  clientIds(): string[] {
    return [...this.clients.keys()];
  }

  isConnected(deviceId: string): boolean {
    const ws = this.clients.get(deviceId);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  async start(wsPort: number, httpPort: number): Promise<void> {
    await this.startHttp(httpPort);
    await this.startWs(wsPort);
  }

  private startHttp(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res));
      server.on('error', reject);
      server.listen(port, '0.0.0.0', () => {
        this.httpServer = server;
        this.info.http = port;
        resolve();
      });
    });
  }

  private startWs(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host: '0.0.0.0', path: '/ws' });
      wss.on('error', reject);
      wss.on('listening', () => {
        this.wss = wss;
        this.info.ws = port;
        resolve();
      });
      wss.on('connection', (socket, req) => this.handleSocket(socket, req));
    });
  }

  stop(): void {
    for (const ws of this.clients.values()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.wss?.close();
    this.httpServer?.close();
    this.wss = null;
    this.httpServer = null;
  }

  send(deviceId: string, message: unknown): boolean {
    const ws = this.clients.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  broadcast(message: unknown, except?: string): void {
    for (const [id] of this.clients) {
      if (id === except) continue;
      this.send(id, message);
    }
  }

  private handleSocket(socket: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    let deviceId = url.searchParams.get('id') ?? '';
    const name = url.searchParams.get('name') ?? 'Tablet';
    const remoteIp = (req.socket.remoteAddress ?? '').replace('::ffff:', '');

    const register = (id: string) => {
      deviceId = id;
      this.clients.set(deviceId, socket);
      this.emit('connected', { deviceId, name, ip: remoteIp });
    };

    if (deviceId) register(deviceId);

    socket.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'hello') {
        const id = String(msg.deviceId || deviceId || '');
        if (id && !deviceId) register(id);
        return;
      }
      if (msg.type === 'ping') {
        try {
          socket.send(JSON.stringify({ type: 'pong', t: msg.t }));
        } catch {
          /* ignore */
        }
        return;
      }
      if (!deviceId) return;
      this.emit('message', { deviceId, ip: remoteIp, msg } as IncomingMessage);
    });

    socket.on('close', () => {
      if (deviceId && this.clients.get(deviceId) === socket) {
        this.clients.delete(deviceId);
        this.emit('disconnected', { deviceId, name, ip: remoteIp });
      }
    });

    socket.on('error', () => {
      /* handled by close */
    });
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      json(res, 204, {});
      return;
    }

    try {
      if (method === 'GET' && url.pathname === '/api/info') {
        const settings = getSettings();
        json(res, 200, {
          app: 'SmartConnectLike',
          version: '1.0.0',
          name: settings.deviceName,
          kind: 'desktop',
          os: `${os.type()} ${os.release()}`,
          deviceId: this.props.deviceId,
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/files') {
        const files = this.props.fileService.list().map((f) => ({
          token: f.token,
          name: f.name,
          size: f.size,
          url: `/api/file/${f.token}`,
        }));
        json(res, 200, { files });
        return;
      }

      if (method === 'GET' && url.pathname.startsWith('/api/file/')) {
        this.serveFile(url, req, res);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/upload') {
        this.receiveUpload(url, req, res);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/share') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { paths?: string[]; path?: string };
            const paths = body.paths ?? (body.path ? [body.path] : []);
            const added = this.props.fileService.add(paths);
            json(res, 200, { added });
          } catch {
            json(res, 400, { error: 'bad request' });
          }
        });
        return;
      }

      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  }

  private serveFile(url: URL, req: http.IncomingMessage, res: http.ServerResponse): void {
    const token = url.pathname.split('/').pop() ?? '';
    const file = this.props.fileService.resolve(token);
    if (!file) {
      json(res, 404, { error: 'file not found' });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file.path);
    } catch {
      json(res, 404, { error: 'file missing on disk' });
      return;
    }

    const item = this.props.fileService.noteDownload(file.name, stat.size);

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Access-Control-Allow-Origin': '*',
    });

    const stream = fs.createReadStream(file.path);
    let sent = 0;
    stream.on('data', (chunk) => {
      sent += chunk.length;
      if (item) this.props.fileService.progressDownload(item, sent);
    });
    stream.on('error', () => {
      if (item) this.props.fileService.finishDownload(item, false);
      res.destroy();
    });
    stream.on('end', () => {
      if (item) this.props.fileService.finishDownload(item, true);
    });
    req.on('close', () => {
      if (item) this.props.fileService.finishDownload(item, false);
    });
    stream.pipe(res);
  }

  private receiveUpload(url: URL, req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawName = url.searchParams.get('name') ?? `upload-${Date.now()}.bin`;
    const total = Number(req.headers['content-length'] ?? 0);
    const { item, filePath } = this.props.fileService.createUpload(rawName);
    const out = fs.createWriteStream(filePath);
    let received = 0;
    let failed = false;

    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      this.props.fileService.trackUpload(item, received, total);
    });
    req.on('error', () => {
      failed = true;
      out.destroy();
      this.props.fileService.finishUpload(item, false, 'connection lost');
    });
    out.on('error', (err) => {
      failed = true;
      this.props.fileService.finishUpload(item, false, err.message);
      json(res, 500, { error: err.message });
    });
    out.on('finish', () => {
      if (failed) return;
      this.props.fileService.finishUpload(item, true);
      json(res, 200, { ok: true, name: item.name });
    });
    req.pipe(out);
  }
}

export type { SharedFile, TransferItem };
