import { execFile } from 'node:child_process';

/**
 * A virtual display driver (MTT VDD, Parsec VDD, IddSample…) shows up as a normal
 * monitor. Its friendly name is either the driver name, an empty string, or — if the
 * user installed a custom EDID — a perfectly real-looking model name.
 *
 * The reliable way to tell them apart is the PnP parent: every monitor that hangs off
 * the MttVDD adapter is virtual, whatever its name says. That lookup needs PowerShell,
 * so we cache it and fall back to name heuristics until it lands.
 */
const VIRTUAL_LABEL = /virtual|vdd|mtt|parsec|idd|spacedesk|dummy|indirect/i;
/** Electron's fallback for a monitor without a usable label, e.g. "Display 2". */
const GENERIC_LABEL = /^Display \d+$/i;

const CACHE_TTL_MS = 30_000;
const LOOKUP_TIMEOUT_MS = 15_000;

let virtualNames = new Set<string>();
let checkedAt = 0;
let refreshing: Promise<void> | null = null;
let onChange: (() => void) | null = null;

/** Called after the PnP lookup changes the set of known virtual monitors. */
export function setVirtualDisplayListener(cb: (() => void) | null): void {
  onChange = cb;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/** "Generic Monitor (Odyssey G95C)" -> "odyssey g95c". */
function innerName(name: string): string | null {
  const match = /\(([^)]+)\)\s*$/.exec(name);
  return match ? normalize(match[1]) : null;
}

/**
 * True when this monitor is (or very likely is) a virtual display. Empty labels and
 * Electron's "Display N" placeholder count as virtual because IDD monitors usually
 * report no EDID name; the PnP lookup corrects real monitors once it resolves.
 */
export function isVirtualDisplay(label: string | undefined): boolean {
  const raw = (label || '').trim();
  if (!raw) return true;
  if (GENERIC_LABEL.test(raw)) return true;
  const norm = normalize(raw);
  for (const name of virtualNames) {
    if (name === norm || norm.includes(name) || name.includes(norm)) return true;
  }
  return VIRTUAL_LABEL.test(raw);
}

/** Forces the next refresh() to re-query PnP (e.g. after a display was added). */
export function invalidateVirtualDisplays(): void {
  checkedAt = 0;
}

/**
 * Best-effort, cached PnP lookup of the monitor names that belong to the MTT virtual
 * adapter. Never rejects: on any failure the previous names are kept and the label
 * heuristics still apply.
 */
export function refreshVirtualDisplays(): Promise<void> {
  if (Date.now() - checkedAt < CACHE_TTL_MS) return Promise.resolve();
  if (refreshing) return refreshing;

  refreshing = new Promise<void>((resolve) => {
    const script = [
      `$vddIds = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.HardwareID -match '^Root\\\\MttVDD$' } | ForEach-Object { $_.InstanceId })`,
      `$mons = Get-PnpDevice -Class Monitor -PresentOnly -ErrorAction SilentlyContinue`,
      `$out = foreach ($m in $mons) {`,
      `  $parent = (Get-PnpDeviceProperty -InstanceId $m.InstanceId -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue).Data`,
      `  if ($parent -and ($vddIds -contains $parent)) { $m.FriendlyName }`,
      `}`,
      `@($out) | ConvertTo-Json -Compress`,
    ].join('; ');

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: LOOKUP_TIMEOUT_MS },
      (error, stdout) => {
        checkedAt = Date.now();
        refreshing = null;
        if (error || !stdout) {
          resolve();
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim() || '[]') as string | string[] | null;
          const list = parsed == null ? [] : Array.isArray(parsed) ? parsed : [parsed];
          const next = new Set<string>();
          for (const item of list) {
            if (typeof item !== 'string') continue;
            const full = normalize(item);
            if (full) next.add(full);
            const inner = innerName(item);
            if (inner) next.add(inner);
          }
          const changed =
            next.size !== virtualNames.size || [...next].some((name) => !virtualNames.has(name));
          virtualNames = next;
          if (changed) onChange?.();
        } catch {
          /* keep the previous set */
        }
        resolve();
      },
    );
  });

  return refreshing;
}
