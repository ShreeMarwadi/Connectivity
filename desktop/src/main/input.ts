interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WinRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type InputEvent =
  | { t: 'move'; x: number; y: number }
  | { t: 'down'; x: number; y: number; button?: number }
  | { t: 'up'; x: number; y: number; button?: number }
  | { t: 'tap'; x: number; y: number; button?: number }
  | { t: 'scroll'; x: number; y: number; dy: number }
  | { t: 'key'; key: string }
  | { t: 'text'; text: string };

const MOUSEEVENTF = {
  MOVE: 0x0001,
  LEFTDOWN: 0x0002,
  LEFTUP: 0x0004,
  RIGHTDOWN: 0x0008,
  RIGHTUP: 0x0010,
  WHEEL: 0x0800,
};

const VK: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  alt: 0x12,
  escape: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  delete: 0x2e,
  win: 0x5b,
};

let api: {
  SetCursorPos: (x: number, y: number) => boolean;
  mouse_event: (flags: number, dx: number, dy: number, data: number, extra: number) => void;
  keybd_event: (vk: number, scan: number, flags: number, extra: number) => void;
  VkKeyScanW: (ch: number) => number;
  GetSystemMetrics: (index: number) => number;
  GetWindowRect: (hwnd: number, rect: WinRect) => boolean;
  DwmGetWindowAttribute: (hwnd: number, attr: number, rect: WinRect, size: number) => number;
  IsIconic: (hwnd: number) => boolean;
  IsWindowVisible: (hwnd: number) => boolean;
  IsZoomed: (hwnd: number) => boolean;
  GetWindowLongW: (hwnd: number, index: number) => number;
  SetWindowPos: (hwnd: number, after: number, x: number, y: number, cx: number, cy: number, flags: number) => boolean;
  ShowWindow: (hwnd: number, cmd: number) => boolean;
  EnumWindows: (callback: unknown, lParam: number) => boolean;
} | null = null;

// Kept alive so EnumWindows can call back into JS; koffi needs the module handle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let koffiRef: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enumProcProto: any = null;

let loadError: string | null = null;

function loadApi(): void {
  if (api || loadError) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    // Registered so koffi can pass RECT as an out-parameter.
    koffi.struct('SCLRECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    koffiRef = koffi;
    enumProcProto = koffi.proto('bool __stdcall EnumWindowsProc(uintptr_t hwnd, intptr_t lParam)');
    api = {
      SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
      mouse_event: user32.func('void __stdcall mouse_event(uint32 flags, int32 dx, int32 dy, uint32 data, uintptr_t extra)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'),
      VkKeyScanW: user32.func('int16 __stdcall VkKeyScanW(uint16 ch)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ SCLRECT *rect)'),
      DwmGetWindowAttribute: dwmapi.func('int __stdcall DwmGetWindowAttribute(uintptr_t hwnd, uint32 attr, _Out_ SCLRECT *rect, uint32 size)'),
      IsIconic: user32.func('bool __stdcall IsIconic(uintptr_t hWnd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(uintptr_t hWnd)'),
      IsZoomed: user32.func('bool __stdcall IsZoomed(uintptr_t hWnd)'),
      GetWindowLongW: user32.func('int __stdcall GetWindowLongW(uintptr_t hWnd, int index)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(uintptr_t hWnd, uintptr_t hWndInsertAfter, int x, int y, int cx, int cy, uint32 flags)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(uintptr_t hWnd, int cmd)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(void *lpEnumFunc, intptr_t lParam)'),
    };
    console.log('[input] Win32 input backend ready');
  } catch (err) {
    loadError = (err as Error).message;
    console.warn('[input] native input unavailable:', loadError);
  }
}

const SWP = {
  NOSIZE: 0x0001,
  NOZORDER: 0x0004,
  NOACTIVATE: 0x0010,
};

const SW_RESTORE = 9;
const SW_MAXIMIZE = 3;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;
const DWMWA_CLOAKED = 14;

export class InputController {
  private enabled = true;
  /** null = touches are not forwarded (no valid target). */
  private bounds: Rect | null = { x: 0, y: 0, width: 1920, height: 1080 };
  private targetHwnd: number | null = null;
  private targetRect: Rect | null = null;

  constructor() {
    loadApi();
  }

  get available(): boolean {
    loadApi();
    return !!api;
  }

  get error(): string | null {
    return loadError;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /**
   * When streaming a single app window, touches must land inside that window.
   * Pass null to fall back to the whole desktop.
   */
  setTargetHwnd(hwnd: number | null): void {
    this.targetHwnd = hwnd && hwnd > 0 ? hwnd : null;
    this.refreshBounds();
  }

  /**
   * Touch area in physical screen pixels. Used when streaming one specific monitor,
   * so a tap lands on that monitor even if it is offset to the right of the laptop screen.
   */
  setTargetRect(rect: Rect | null): void {
    this.targetRect = rect && rect.width > 0 && rect.height > 0 ? rect : null;
    this.refreshBounds();
  }

  private windowRect(hwnd: number): Rect | null {
    if (!api) return null;
    try {
      if (api.IsIconic(hwnd)) return null;
      const rect = { left: 0, top: 0, right: 0, bottom: 0 };
      // DWMWA_EXTENDED_FRAME_BOUNDS = 9; excludes the invisible resize border.
      const hr = api.DwmGetWindowAttribute(hwnd, 9, rect, 16);
      if (hr !== 0 || rect.right <= rect.left || rect.bottom <= rect.top) {
        const fallback = { left: 0, top: 0, right: 0, bottom: 0 };
        if (!api.GetWindowRect(hwnd, fallback)) return null;
        return {
          x: fallback.left,
          y: fallback.top,
          width: Math.max(1, fallback.right - fallback.left),
          height: Math.max(1, fallback.bottom - fallback.top),
        };
      }
      return {
        x: rect.left,
        y: rect.top,
        width: Math.max(1, rect.right - rect.left),
        height: Math.max(1, rect.bottom - rect.top),
      };
    } catch (err) {
      console.warn('[input] could not read target window bounds', (err as Error).message);
      return null;
    }
  }

  refreshBounds(): void {
    loadApi();
    if (!api) return;
    if (this.targetHwnd) {
      this.bounds = this.windowRect(this.targetHwnd);
      return;
    }
    if (this.targetRect) {
      this.bounds = { ...this.targetRect };
      return;
    }
    const width = api.GetSystemMetrics(0) || 1920;
    const height = api.GetSystemMetrics(1) || 1080;
    this.bounds = { x: 0, y: 0, width, height };
  }

  /**
   * Windows cannot stay on a monitor the tablet is no longer showing, otherwise they are
   * simply gone from the user's point of view. Every top-level window whose centre sits on
   * `from` (the tablet / virtual monitor) is moved onto `to` (the laptop panel), keeping its
   * size and relative position. Maximized windows come back maximized on the laptop.
   * Returns the number of rescued windows.
   */
  rescueWindows(from: Rect, to: Rect): number {
    loadApi();
    const a = api;
    if (!a || !koffiRef || !enumProcProto) return 0;
    if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return 0;

    const picks: { hwnd: number; rect: Rect; zoomed: boolean }[] = [];

    const inspect = (hwnd: number): void => {
      if (!a.IsWindowVisible(hwnd)) return;
      if (a.IsIconic(hwnd)) return;
      if ((a.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) !== 0) return;
      const cloak = { left: 0, top: 0, right: 0, bottom: 0 };
      if (a.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloak, 4) === 0 && cloak.left !== 0) return;
      const rect = this.windowRect(hwnd);
      if (!rect || rect.width < 80 || rect.height < 60) return;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      if (cx < from.x || cx > from.x + from.width) return;
      if (cy < from.y || cy > from.y + from.height) return;
      picks.push({ hwnd, rect, zoomed: a.IsZoomed(hwnd) });
    };

    let callback: unknown = null;
    try {
      callback = koffiRef.register((hwnd: number) => {
        try {
          inspect(hwnd);
        } catch {
          /* skip a single stubborn window */
        }
        return true;
      }, koffiRef.pointer(enumProcProto));
      a.EnumWindows(callback, 0);
    } catch (err) {
      console.warn('[input] window enumeration failed', (err as Error).message);
    } finally {
      if (callback) {
        try {
          koffiRef.unregister(callback);
        } catch {
          /* already gone */
        }
      }
    }

    let moved = 0;
    for (const pick of picks) {
      try {
        const width = Math.min(pick.rect.width, to.width);
        const height = Math.min(pick.rect.height, to.height);
        const relX = (pick.rect.x - from.x) / Math.max(1, from.width);
        const relY = (pick.rect.y - from.y) / Math.max(1, from.height);
        // Stagger so several windows do not land exactly on top of each other.
        const step = (moved % 6) * 28;
        const maxX = to.x + Math.max(0, to.width - width);
        const maxY = to.y + Math.max(0, to.height - height);
        const x = Math.min(Math.max(Math.round(to.x + relX * Math.max(0, to.width - width)) + step, to.x), maxX);
        const y = Math.min(Math.max(Math.round(to.y + relY * Math.max(0, to.height - height)) + step, to.y), maxY);
        if (pick.zoomed) {
          a.ShowWindow(pick.hwnd, SW_RESTORE);
          a.SetWindowPos(pick.hwnd, 0, x, y, width, height, SWP.NOZORDER | SWP.NOACTIVATE);
          a.ShowWindow(pick.hwnd, SW_MAXIMIZE);
        } else {
          a.SetWindowPos(pick.hwnd, 0, x, y, 0, 0, SWP.NOSIZE | SWP.NOZORDER | SWP.NOACTIVATE);
        }
        moved += 1;
      } catch {
        /* skip a window that refuses to move */
      }
    }
    if (moved > 0) console.log(`[input] moved ${moved} window(s) back to the main screen`);
    return moved;
  }

  /** Parks the pointer in the middle of `to`, so touches no longer land on the tablet area. */
  moveCursorHome(to: Rect): void {
    loadApi();
    if (!api) return;
    try {
      api.SetCursorPos(Math.round(to.x + to.width / 2), Math.round(to.y + to.height / 2));
    } catch {
      /* ignore */
    }
  }

  /** Moves the pointer to an absolute physical pixel position. */
  setCursor(x: number, y: number): void {
    loadApi();
    if (!api) return;
    try {
      api.SetCursorPos(Math.round(x), Math.round(y));
    } catch {
      /* ignore */
    }
  }

  private point(x: number, y: number): { px: number; py: number } | null {    this.refreshBounds();
    const bounds = this.bounds;
    if (!bounds) return null;
    const nx = Math.min(Math.max(x, 0), 1);
    const ny = Math.min(Math.max(y, 0), 1);
    return {
      px: Math.round(bounds.x + nx * (bounds.width - 1)),
      py: Math.round(bounds.y + ny * (bounds.height - 1)),
    };
  }

  handle(event: InputEvent): void {
    loadApi();
    if (!api || !this.enabled) return;
    try {
      if (event.t === 'move') {
        const p = this.point(event.x, event.y);
        if (!p) return;
        api.SetCursorPos(p.px, p.py);
        return;
      }
      if (event.t === 'down' || event.t === 'up' || event.t === 'tap') {
        const p = this.point(event.x, event.y);
        if (!p) return;
        api.SetCursorPos(p.px, p.py);
        const right = event.button === 2;
        const down = right ? MOUSEEVENTF.RIGHTDOWN : MOUSEEVENTF.LEFTDOWN;
        const up = right ? MOUSEEVENTF.RIGHTUP : MOUSEEVENTF.LEFTUP;
        if (event.t === 'tap') {
          api.mouse_event(down, 0, 0, 0, 0);
          setTimeout(() => api?.mouse_event(up, 0, 0, 0, 0), 40);
        } else {
          api.mouse_event(event.t === 'down' ? down : up, 0, 0, 0, 0);
        }
        return;
      }
      if (event.t === 'scroll') {
        const p = this.point(event.x, event.y);
        if (!p) return;
        api.SetCursorPos(p.px, p.py);
        const amount = Math.round(event.dy) * 120;
        api.mouse_event(MOUSEEVENTF.WHEEL, 0, 0, amount, 0);
        return;
      }
      if (event.t === 'key') {
        const vk = VK[event.key.toLowerCase()];
        if (!vk) return;
        api.keybd_event(vk, 0, 0, 0);
        setTimeout(() => api?.keybd_event(vk, 0, 2, 0), 25);
        return;
      }
      if (event.t === 'text') {
        for (const ch of event.text) {
          const scan = api.VkKeyScanW(ch.codePointAt(0) ?? 0) & 0xff;
          if (!scan) continue;
          api.keybd_event(scan, 0, 0, 0);
          setTimeout(() => api?.keybd_event(scan, 0, 2, 0), 10);
        }
      }
    } catch (err) {
      console.warn('[input] failed', (err as Error).message);
    }
  }
}
