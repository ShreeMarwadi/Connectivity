import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VcamStatus } from '../shared/types';

/**
 * Windows virtual camera built on the UnityCapture DirectShow filter (zlib license).
 *
 * The filter is a normal "video input device" that shows up as `CAMERA_NAME`.
 * It allocates a shared memory block + mutex/events, and we push raw frames into
 * that block from the main process. No extra driver install is needed per app,
 * only a one-time COM registration (admin) for the two bundled DLLs.
 */

const CAMERA_NAME = 'Connectivity Camera';
const VIDEO_INPUT_CATEGORY = '{860BB310-5D01-11D0-BD3B-00A0C911CE86}';
// The prebuilt binaries register these CLSIDs (64-bit -> 0010 in the native view,
// 32-bit -> 0020 in the WOW6432Node view). Verified on Windows 11.
const FILTER_CLSID_64 = '{5C2CD55C-92AD-4999-8666-912BD3E70010}';
const FILTER_CLSID_32 = '{5C2CD55C-92AD-4999-8666-912BD3E70020}';

const MUTEX_NAME = 'UnityCapture_Mutx';
const WANT_NAME = 'UnityCapture_Want';
const SENT_NAME = 'UnityCapture_Sent';
const DATA_NAME = 'UnityCapture_Data';

const HEADER_SIZE = 32; // DWORD maxSize + 7 ints, data starts right after
const FORMAT_UINT8 = 0;
// LINEAR lets the filter scale our frames to whatever size the receiving app
// asked for, so the camera works at any resolution instead of showing the
// "please set these to match" warning pattern.
const RESIZE_LINEAR = 1;
const MIRROR_DISABLED = 0;
// How long the filter keeps the last frame on screen while no new frame arrives.
const FRAME_TIMEOUT_MS = 1000;

const FILE_MAP_WRITE = 0x0002;
const SYNCHRONIZE = 0x00100000;
const EVENT_MODIFY_STATE = 0x0002;
const WAIT_OBJECT_0 = 0;
const WAIT_ABANDONED = 0x80;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let koffi: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any = null;
let apiError: string | null = null;

function loadApi(): void {
  if (api || apiError) return;
  if (process.platform !== 'win32') {
    apiError = 'Virtual camera is only supported on Windows.';
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');
    api = {
      OpenMutexA: k32.func('void * __stdcall OpenMutexA(uint32 access, int inherit, const char *name)'),
      OpenEventA: k32.func('void * __stdcall OpenEventA(uint32 access, int inherit, const char *name)'),
      CreateEventA: k32.func(
        'void * __stdcall CreateEventA(void *attrs, int manual, int initial, const char *name)',
      ),
      OpenFileMappingA: k32.func(
        'void * __stdcall OpenFileMappingA(uint32 access, int inherit, const char *name)',
      ),
      MapViewOfFile: k32.func(
        'void * __stdcall MapViewOfFile(void *map, uint32 access, uint32 offsetHigh, uint32 offsetLow, size_t bytes)',
      ),
      UnmapViewOfFile: k32.func('bool __stdcall UnmapViewOfFile(void *address)'),
      CloseHandle: k32.func('bool __stdcall CloseHandle(void *handle)'),
      WaitForSingleObject: k32.func('uint32 __stdcall WaitForSingleObject(void *handle, uint32 ms)'),
      ReleaseMutex: k32.func('bool __stdcall ReleaseMutex(void *handle)'),
      SetEvent: k32.func('bool __stdcall SetEvent(void *handle)'),
      // koffi's `view()` helper builds an external ArrayBuffer, which Electron's
      // N-API layer rejects with a fatal error, so shared memory is copied with
      // plain memcpy/memmove and fields are read with koffi.decode instead.
      memcpy: koffi.load('msvcrt.dll').func('void * __cdecl memcpy(void *dest, const void *src, size_t n)'),
    };
  } catch (err) {
    apiError = (err as Error).message;
    console.warn('[vcam] native bridge unavailable:', apiError);
  }
}

export function vcamDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'vcam')
    : path.join(app.getAppPath(), 'resources', 'vcam');
}

function dllPath(bits: 32 | 64): string {
  return path.join(vcamDir(), `UnityCaptureFilter${bits}.dll`);
}

function hasDlls(): boolean {
  return fs.existsSync(dllPath(64)) && fs.existsSync(dllPath(32));
}

/** 32-bit helpers only exist on 64-bit Windows. */
function has32Bit(): boolean {
  const reg32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'regsvr32.exe');
  return fs.existsSync(reg32) && fs.existsSync(dllPath(32));
}

function queryKey(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // `reg query` exits non-zero when the key is missing - that is not an error here.
      resolve(err && !stdout ? '' : String(stdout || ''));
    });
  });
}

/** True when our friendly name is registered in the video-input device category. */
export async function vcamStatus(): Promise<VcamStatus> {
  const status: VcamStatus = {
    supported: process.platform === 'win32',
    driverPresent: false,
    registered: false,
    name: CAMERA_NAME,
    detail: '',
  };
  if (!status.supported) {
    status.detail = 'Windows only';
    return status;
  }

  status.driverPresent = hasDlls();

  const keys = [
    `HKLM\\SOFTWARE\\Classes\\CLSID\\${VIDEO_INPUT_CATEGORY}\\Instance`,
    `HKLM\\SOFTWARE\\Classes\\WOW6432Node\\CLSID\\${VIDEO_INPUT_CATEGORY}\\Instance`,
  ];
  const outputs = await Promise.all(keys.map(queryKey));
  status.registered = outputs.some((out) => out.toLowerCase().includes(CAMERA_NAME.toLowerCase()));

  if (!status.driverPresent) {
    status.detail = 'Virtual camera files are missing from this installation.';
  } else if (status.registered) {
    status.detail = `"${CAMERA_NAME}" is ready to pick inside any app.`;
  } else {
    status.detail = 'Enable once to add the camera to Windows (needs admin approval).';
  }
  return status;
}

function runElevated(batPath: string, args: string[]): Promise<number> {
  // Start-Process also runs the helper with a UAC prompt; -Wait keeps us in sync
  // so the caller can re-check the registry right after the user approves.
  const quoted = batPath.replace(/'/g, "''");
  const extra = args.length ? ` -ArgumentList '${args.join(' ').replace(/'/g, "''")}'` : '';
  const inner = `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','\"${quoted}\"'${extra} -Verb RunAs -Wait -WindowStyle Hidden`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', inner],
      { windowsHide: true, timeout: 180000 },
      (err) => {
        if (err) {
          const message = String((err as NodeJS.ErrnoException).message || '');
          console.warn('[vcam] elevation failed:', message);
          resolve(-1);
          return;
        }
        resolve(0);
      },
    );
  });
}

function writeHelper(name: string, lines: (result: string) => string[]): { bat: string; result: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connectivity-vcam-'));
  const result = path.join(dir, 'result.txt');
  const bat = path.join(dir, `${name}.cmd`);
  const body = [
    '@echo off',
    'setlocal',
    `> "${result}" echo start`,
    ...lines(result),
    `>> "${result}" echo done`,
    'exit /b 0',
  ].join('\r\n');
  fs.writeFileSync(bat, body, 'ascii');
  return { bat, result };
}

function cleanupHelper(helper: { bat: string; result: string }): void {
  try {
    fs.rmSync(path.dirname(helper.bat), { recursive: true, force: true });
  } catch {
    /* temp leftovers are harmless */
  }
}

/** Registers both DLLs under our name. Returns the fresh status afterwards. */
export async function vcamEnable(): Promise<VcamStatus> {
  let status = await vcamStatus();
  if (!status.supported || !status.driverPresent || status.registered) return status;

  const reg64 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'regsvr32.exe');
  const reg32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'regsvr32.exe');
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const instance = (clsid: string) => `HKLM\\SOFTWARE\\Classes\\CLSID\\${VIDEO_INPUT_CATEGORY}\\Instance\\${clsid}`;
  const server = (clsid: string) => `HKLM\\SOFTWARE\\Classes\\CLSID\\${clsid}`;
  // Register with the filter's default name first (spaces in /i: are unreliable
  // through cmd) and then overwrite both name values with our own. The rename
  // only touches keys that exist, so it never invents stray device entries.
  const helper = writeHelper('enable', (result) => {
    const lines = [
      `"${reg64}" /s "${dllPath(64)}"`,
      `if errorlevel 1 >> "${result}" echo fail64`,
      `"${reg}" query "${instance(FILTER_CLSID_64)}" /reg:64 >nul 2>&1`,
      `if not errorlevel 1 "${reg}" add "${instance(FILTER_CLSID_64)}" /v FriendlyName /t REG_SZ /d "${CAMERA_NAME}" /f /reg:64`,
      `"${reg}" add "${server(FILTER_CLSID_64)}" /ve /t REG_SZ /d "${CAMERA_NAME}" /f /reg:64`,
    ];
    if (has32Bit()) {
      lines.push(
        `"${reg32}" /s "${dllPath(32)}"`,
        `if errorlevel 1 >> "${result}" echo fail32`,
        `"${reg}" query "${instance(FILTER_CLSID_32)}" /reg:32 >nul 2>&1`,
        `if not errorlevel 1 "${reg}" add "${instance(FILTER_CLSID_32)}" /v FriendlyName /t REG_SZ /d "${CAMERA_NAME}" /f /reg:32`,
        `"${reg}" add "${server(FILTER_CLSID_32)}" /ve /t REG_SZ /d "${CAMERA_NAME}" /f /reg:32`,
      );
    }
    return lines;
  });
  const code = await runElevated(helper.bat, []);
  cleanupHelper(helper);
  if (code !== 0) {
    status = await vcamStatus();
    status.detail = 'Admin approval was cancelled, so the camera was not enabled.';
    return status;
  }

  status = await vcamStatus();
  if (!status.registered) {
    status.detail =
      'Windows did not accept the camera driver. Smart App Control or antivirus may be blocking the bundled DLL.';
  }
  return status;
}

/** Removes the COM registration (admin). */
export async function vcamDisable(): Promise<VcamStatus> {
  let status = await vcamStatus();
  if (!status.supported || !status.driverPresent || !status.registered) return status;

  const reg64 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'regsvr32.exe');
  const reg32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'regsvr32.exe');
  const helper = writeHelper('disable', (result) => {
    const lines = [`"${reg64}" /s /u "${dllPath(64)}"`, `if errorlevel 1 >> "${result}" echo fail64`];
    if (has32Bit()) {
      lines.push(`"${reg32}" /s /u "${dllPath(32)}"`, `if errorlevel 1 >> "${result}" echo fail32`);
    }
    return lines;
  });
  const code = await runElevated(helper.bat, []);
  cleanupHelper(helper);

  status = await vcamStatus();
  if (code !== 0 && status.registered) {
    status.detail = 'Admin approval was cancelled, so the camera is still enabled.';
  } else if (!status.registered) {
    status.detail = 'Virtual camera removed from Windows. You can enable it again any time.';
  }
  return status;
}

type Session = {
  mutex: unknown;
  sent: unknown;
  want: unknown;
  mapping: unknown;
  pointer: unknown;
  capacity: number;
  /** Reused staging buffer so each frame needs a single memcpy into shared memory. */
  scratch: Buffer | null;
  lastWrite: number;
};

let session: Session | null = null;
let retryAt = 0;
// Kept alive across sessions so the filter can always find it (sender-side object).
let wantEvent: { name: string; handle: unknown } | null = null;

function ensureWant(name: string): unknown {
  if (wantEvent && wantEvent.name !== name) {
    try {
      api?.CloseHandle(wantEvent.handle);
    } catch {
      /* ignore */
    }
    wantEvent = null;
  }
  if (!wantEvent) {
    const handle = api.CreateEventA(null, 0, 0, name);
    if (!handle) return null;
    wantEvent = { name, handle };
  }
  return wantEvent.handle;
}

function closeSession(zero = true): void {
  if (!session) return;
  const current = session;
  session = null;
  try {
    if (zero && current.pointer) {
      koffi.encode(current.pointer, 4, 'int32', 0); // width = 0 -> "capture inactive"
      api?.SetEvent(current.sent);
    }
  } catch {
    /* mapping may already be gone */
  }
  try {
    if (current.pointer) api?.UnmapViewOfFile(current.pointer);
  } catch {
    /* ignore */
  }
  for (const handle of [current.mutex, current.sent, current.want, current.mapping]) {
    try {
      if (handle) api?.CloseHandle(handle);
    } catch {
      /* ignore */
    }
  }
}

function openSession(): Session | null {
  loadApi();
  if (!api) return null;

  // Names differ between UnityCapture versions: the cap-number suffix is either
  // absent (older filters) or the digit itself.
  for (const names of [
    { mutex: MUTEX_NAME, sent: SENT_NAME, want: WANT_NAME, data: DATA_NAME },
    { mutex: `${MUTEX_NAME}0`, sent: `${SENT_NAME}0`, want: `${WANT_NAME}0`, data: `${DATA_NAME}0` },
  ]) {
    const opened: unknown[] = [];
    const closeAll = (): void => {
      for (const handle of opened) {
        try {
          api.CloseHandle(handle);
        } catch {
          /* ignore */
        }
      }
    };

    try {
      // The filter creates the mutex when it starts receiving. Without it nothing
      // is listening, so there is nothing to attach to.
      const mutex = api.OpenMutexA(SYNCHRONIZE, 0, names.mutex);
      if (!mutex) continue;
      opened.push(mutex);

      // The *sender* side creates the "want" event and must keep it alive: the
      // filter only creates the "sent" event + data mapping once it sees this
      // event, so the first attempt just primes the handshake and the next one
      // a few milliseconds later attaches for real.
      const want = ensureWant(names.want);
      const sent = api.OpenEventA(EVENT_MODIFY_STATE, 0, names.sent);
      if (sent) opened.push(sent);
      const mapping = sent ? api.OpenFileMappingA(FILE_MAP_WRITE, 0, names.data) : null;
      if (mapping) opened.push(mapping);

      if (!want || !sent || !mapping) {
        closeAll();
        return null; // retry shortly; the filter needs a frame to notice our event
      }

      const pointer = api.MapViewOfFile(mapping, FILE_MAP_WRITE, 0, 0, 0);
      if (!pointer) {
        closeAll();
        return null;
      }

      // maxSize lives at offset 0 and tells us how many bytes a frame may use.
      const capacity = koffi.decode(pointer, 0, 'uint32') as number;
      if (capacity < 640 * 480 * 4) {
        api.UnmapViewOfFile(pointer);
        closeAll();
        return null;
      }

      console.log(`[vcam] shared frame buffer attached (${names.data}, ${(capacity / 1024 / 1024).toFixed(1)} MB)`);
      return {
        mutex,
        sent,
        want,
        mapping,
        pointer,
        capacity,
        scratch: null,
        lastWrite: Date.now(),
      };
    } catch (err) {
      console.warn('[vcam] shared memory open failed:', (err as Error).message);
      closeAll();
      return null;
    }
  }
  return null;
}

/**
 * Push one RGBA frame into the filter's shared buffer. Returns true when the
 * frame reached an app that currently has the camera open.
 */
export function vcamFrame(frame: ArrayBuffer, width: number, height: number): boolean {
  loadApi();
  if (!api) return false;
  if (!frame || width <= 0 || height <= 0 || frame.byteLength < width * height * 4) return false;

  if (!session) {
    if (Date.now() < retryAt) return false;
    session = openSession();
    if (!session) {
      retryAt = Date.now() + 250;
      return false;
    }
  }

  const current = session;
  const dataSize = width * height * 4;
  if (dataSize > current.capacity) return false;

  const wait = api.WaitForSingleObject(current.mutex, 400);
  if (wait !== WAIT_OBJECT_0 && wait !== WAIT_ABANDONED) return false;
  try {
    const total = HEADER_SIZE + dataSize;
    let scratch = current.scratch;
    if (!scratch || scratch.length < total) {
      scratch = Buffer.allocUnsafe(total);
      current.scratch = scratch;
    }
    scratch.writeUInt32LE(current.capacity, 0); // maxSize
    scratch.writeInt32LE(width, 4);
    scratch.writeInt32LE(height, 8);
    scratch.writeInt32LE(width, 12); // stride in pixels (UnityCapture indexes uint32 rows)
    scratch.writeInt32LE(FORMAT_UINT8, 16);
    scratch.writeInt32LE(RESIZE_LINEAR, 20);
    scratch.writeInt32LE(MIRROR_DISABLED, 24);
    scratch.writeInt32LE(FRAME_TIMEOUT_MS, 28);
    Buffer.from(frame, 0, dataSize).copy(scratch, HEADER_SIZE);
    api.memcpy(current.pointer, scratch, total);
  } catch (err) {
    console.warn('[vcam] frame write failed:', (err as Error).message);
    closeSession(false);
    return false;
  } finally {
    try {
      api.ReleaseMutex(current.mutex);
    } catch {
      /* ignore */
    }
  }

  api.SetEvent(current.sent);
  current.lastWrite = Date.now();
  return true;
}

/** Called when the stream stops so the camera shows "no signal" again. */
export function vcamStop(): void {
  closeSession(true);
}

export function disposeVcam(): void {
  closeSession(true);
  try {
    if (wantEvent) api?.CloseHandle(wantEvent.handle);
  } catch {
    /* ignore */
  }
  wantEvent = null;
  api = null;
  koffi = null;
}
