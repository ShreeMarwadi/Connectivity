import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  CaptureTarget,
  DisplayInfo,
  PeerInfo,
  Settings,
  SharedFile,
  TransferItem,
  WindowSource,
  WsEnvelope,
  VcamStatus,
} from '../shared/types';

const channels = [
  'peers',
  'ws:message',
  'ws:connected',
  'ws:disconnected',
  'transfers',
  'shared',
  'toast',
  'state',
] as const;

type Channel = (typeof channels)[number];

const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  getPeers: () => ipcRenderer.invoke('peers:get'),
  send: (deviceId: string, message: WsEnvelope) => ipcRenderer.invoke('ws:send', deviceId, message),
  broadcast: (message: WsEnvelope) => ipcRenderer.invoke('ws:broadcast', message),
  clients: () => ipcRenderer.invoke('ws:clients'),
  listWindows: (): Promise<WindowSource[]> => ipcRenderer.invoke('windows:list'),
  listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('displays:list'),
  vcamStatus: (): Promise<VcamStatus> => ipcRenderer.invoke('vcam:status'),
  vcamEnable: (): Promise<VcamStatus> => ipcRenderer.invoke('vcam:enable'),
  vcamDisable: (): Promise<VcamStatus> => ipcRenderer.invoke('vcam:disable'),
  vcamStart: (): Promise<boolean> => ipcRenderer.invoke('vcam:start'),
  vcamFrame: (rgba: ArrayBuffer, width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke('vcam:frame', rgba, width, height),
  vcamPlaceholder: (rgba: ArrayBuffer, width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke('vcam:placeholder', rgba, width, height),
  vcamStop: (): Promise<boolean> => ipcRenderer.invoke('vcam:stop'),
  openDisplaySettings: () => ipcRenderer.invoke('virtualdisplay:settings'),
  openDriverPage: () => ipcRenderer.invoke('virtualdisplay:driver'),
  setCaptureTarget: (target: CaptureTarget) => ipcRenderer.invoke('capture:target', target),
  setSessionLive: (live: boolean) => ipcRenderer.invoke('session:live', live),
  restoreSession: (): Promise<{ moved: number; display: string }> => ipcRenderer.invoke('session:restore'),
  addShare: (paths: string[]) => ipcRenderer.invoke('share:add', paths),
  pickShare: () => ipcRenderer.invoke('share:pick'),
  removeShare: (token: string) => ipcRenderer.invoke('share:remove', token),
  listShare: () => ipcRenderer.invoke('share:list'),
  listTransfers: () => ipcRenderer.invoke('transfers:list'),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  openPath: (target: string) => ipcRenderer.invoke('files:open', target),
  refresh: () => ipcRenderer.invoke('net:refresh'),
  quit: () => ipcRenderer.invoke('app:quit'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  on: (channel: Channel, callback: (payload: any) => void) => {
    const listener = (_event: unknown, payload: any) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('sc', api);

export type ScApi = {
  getState: () => Promise<AppState>;
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
  getPeers: () => Promise<PeerInfo[]>;
  send: (deviceId: string, message: WsEnvelope) => Promise<boolean>;
  broadcast: (message: WsEnvelope) => Promise<boolean>;
  clients: () => Promise<string[]>;
  listWindows: () => Promise<WindowSource[]>;
  listDisplays: () => Promise<DisplayInfo[]>;
  vcamStatus: () => Promise<VcamStatus>;
  vcamEnable: () => Promise<VcamStatus>;
  vcamDisable: () => Promise<VcamStatus>;
  vcamStart: () => Promise<boolean>;
  vcamFrame: (rgba: ArrayBuffer, width: number, height: number) => Promise<boolean>;
  vcamPlaceholder: (rgba: ArrayBuffer, width: number, height: number) => Promise<boolean>;
  vcamStop: () => Promise<boolean>;
  openDisplaySettings: () => Promise<boolean>;
  openDriverPage: () => Promise<boolean>;
  setCaptureTarget: (target: CaptureTarget) => Promise<boolean>;
  setSessionLive: (live: boolean) => Promise<boolean>;
  restoreSession: () => Promise<{ moved: number; display: string }>;
  addShare: (paths: string[]) => Promise<SharedFile[]>;
  pickShare: () => Promise<SharedFile[]>;
  removeShare: (token: string) => Promise<SharedFile[]>;
  listShare: () => Promise<SharedFile[]>;
  listTransfers: () => Promise<TransferItem[]>;
  writeClipboard: (text: string) => Promise<boolean>;
  openPath: (target: string) => Promise<boolean>;
  refresh: () => Promise<AppState>;
  quit: () => Promise<boolean>;
  pathForFile: (file: File) => string;
  on: (channel: Channel, callback: (payload: any) => void) => () => void;
};

export interface AppState {
  settings: Settings;
  deviceId: string;
  peers: PeerInfo[];
  net: { ip: string; wsPort: number; httpPort: number };
  shared: SharedFile[];
  transfers: TransferItem[];
  inputAvailable: boolean;
  displays: DisplayInfo[];
  version: string;
  platform: string;
}
