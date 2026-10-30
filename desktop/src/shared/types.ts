export type DeviceKind = 'desktop' | 'tablet';

export interface PeerInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  ip: string;
  ws: number;
  http: number;
  features: string[];
  lastSeen: number;
  connected?: boolean;
}

export interface Settings {
  deviceName: string;
  wsPort: number;
  httpPort: number;
  receiveDir: string;
  theme: 'light' | 'dark';
  autoAccept: boolean;
  clipboardSync: boolean;
  inputEnabled: boolean;
  quality: 'balanced' | 'quality' | 'speed';
}

export interface SharedFile {
  token: string;
  name: string;
  size: number;
  path: string;
  addedAt: number;
}

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  bytes: number;
  direction: 'up' | 'down';
  status: 'running' | 'done' | 'error';
  error?: string;
  at: number;
}

export interface WsEnvelope {
  type: string;
  [key: string]: unknown;
}

/** What the desktop captures and sends to the tablet. */
export type CaptureTarget =
  | { kind: 'screen'; displayId?: string }
  | { kind: 'window'; sourceId: string; sourceName?: string };

/** One physical or virtual monitor as reported by Electron. */
export interface DisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  /** Heuristic: the label looks like a virtual display driver. */
  virtual: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}


/** One capturable application window, listed in the Extend page. */
export interface WindowSource {
  id: string;
  name: string;
  thumbnail: string;
  icon: string | null;
}
