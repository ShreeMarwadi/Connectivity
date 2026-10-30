import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { PeerInfo } from '../shared/types';

export const DISCOVERY_PORT = 47777;
const ANNOUNCE_MS = 2000;
const EXPIRE_MS = 8000;

interface HelloPacket {
  sc: 'hello';
  v: number;
  id: string;
  name: string;
  kind: 'desktop' | 'tablet';
  ws: number;
  http: number;
  features?: string[];
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + (parseInt(part, 10) & 255), 0) >>> 0;
}

function intToIp(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

export function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const ip = ipToInt(info.address);
      const mask = ipToInt(info.netmask);
      out.add(intToIp((ip | (~mask >>> 0)) >>> 0));
    }
  }
  return [...out];
}

export function localAddresses(): { ip: string; iface: string }[] {
  const out: { ip: string; iface: string }[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      out.push({ ip: info.address, iface: name });
    }
  }
  return out;
}

/** Preferred LAN IP: first non-virtual IPv4 address. */
export function primaryAddress(): string {
  const all = localAddresses();
  const preferred = all.find((a) => !/loopback|virtual|vmware|vbox|hyper-v|wsl|tailscale|zerotier/i.test(a.iface));
  return (preferred ?? all[0])?.ip ?? '127.0.0.1';
}

export interface DiscoveryOptions {
  id: string;
  name: string;
  wsPort: number;
  httpPort: number;
  features: string[];
}

export class Discovery extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private peers = new Map<string, PeerInfo>();
  private announceTimer: NodeJS.Timeout | null = null;
  private expireTimer: NodeJS.Timeout | null = null;
  private lastReply = new Map<string, number>();
  private options: DiscoveryOptions;

  constructor(options: DiscoveryOptions) {
    super();
    this.options = options;
  }

  setOptions(patch: Partial<DiscoveryOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  start(): void {
    if (this.socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('error', (err) => {
      console.error('[discovery] socket error', err.message);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
      setTimeout(() => this.start(), 3000);
    });

    socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo));

    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* ignore */
      }
      this.announce();
    });

    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_MS);
    this.expireTimer = setInterval(() => this.expire(), 2000);
  }

  stop(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.expireTimer) clearInterval(this.expireTimer);
    this.announceTimer = null;
    this.expireTimer = null;
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  peerList(): PeerInfo[] {
    return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private payload(): HelloPacket {
    return {
      sc: 'hello',
      v: 1,
      id: this.options.id,
      name: this.options.name,
      kind: 'desktop',
      ws: this.options.wsPort,
      http: this.options.httpPort,
      features: this.options.features,
    };
  }

  private announce(): void {
    const socket = this.socket;
    if (!socket) return;
    const data = Buffer.from(JSON.stringify(this.payload()), 'utf8');
    for (const address of broadcastAddresses()) {
      try {
        socket.send(data, 0, data.length, DISCOVERY_PORT, address);
      } catch {
        /* ignore */
      }
    }
  }

  private onMessage(buf: Buffer, rinfo: dgram.RemoteInfo): void {
    let packet: HelloPacket;
    try {
      packet = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!packet || packet.sc !== 'hello' || !packet.id) return;
    if (packet.id === this.options.id) return;
    if (packet.kind !== 'tablet' && packet.kind !== 'desktop') return;

    const peer: PeerInfo = {
      id: packet.id,
      name: packet.name || 'Unknown device',
      kind: packet.kind,
      ip: rinfo.address,
      ws: packet.ws || 47800,
      http: packet.http || 47801,
      features: packet.features ?? [],
      lastSeen: Date.now(),
    };
    const existed = this.peers.has(peer.id);
    this.peers.set(peer.id, peer);
    if (!existed) this.emit('peers', this.peerList());

    const now = Date.now();
    if (!this.lastReply.has(packet.id) || now - (this.lastReply.get(packet.id) ?? 0) > 3000) {
      this.lastReply.set(packet.id, now);
      const socket = this.socket;
      const data = Buffer.from(JSON.stringify(this.payload()), 'utf8');
      try {
        socket?.send(data, 0, data.length, rinfo.port, rinfo.address);
      } catch {
        /* ignore */
      }
      this.emit('peers', this.peerList());
    }
  }

  private expire(): void {
    const cutoff = Date.now() - EXPIRE_MS;
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('peers', this.peerList());
  }
}
