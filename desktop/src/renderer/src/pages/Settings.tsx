import { useEffect, useState } from 'react';
import type { AppState } from '../../../preload/preload';
import type { Settings } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, Pill, Toggle } from '../components/UI';

export default function SettingsPage({
  state,
  onChange,
}: {
  state: AppState;
  onChange: (patch: Partial<Settings>) => Promise<Settings>;
}) {
  const [name, setName] = useState(state.settings.deviceName);
  const [saved, setSaved] = useState(false);

  useEffect(() => setName(state.settings.deviceName), [state.settings.deviceName]);

  const saveName = async () => {
    if (!name.trim() || name === state.settings.deviceName) return;
    await onChange({ deviceName: name.trim().toUpperCase() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="stack">
      <Card className="panel">
        <div className="panel-head">
          <div>
            <h3>This device</h3>
            <p className="muted">How the tablet sees this computer on the network.</p>
          </div>
          {saved ? <Pill tone="ok">Saved</Pill> : null}
        </div>

        <div className="settings-grid">
          <label className="field">
            <span>Device name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => e.key === 'Enter' && void saveName()}
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>Network address</span>
            <input value={`${state.net.ip}:${state.net.wsPort}`} readOnly />
          </label>

          <label className="field">
            <span>File transfer port</span>
            <input value={state.net.httpPort} readOnly />
          </label>

          <label className="field">
            <span>Video quality</span>
            <select
              value={state.settings.quality}
              onChange={(e) => void onChange({ quality: e.target.value as Settings['quality'] })}
            >
              <option value="speed">Fast · 1.5 Mbps (weak Wi-Fi)</option>
              <option value="balanced">Balanced · 3 Mbps</option>
              <option value="quality">Sharp · 6 Mbps</option>
            </select>
          </label>
        </div>

        <div className="field">
          <span>Received files folder</span>
          <div className="inline-field">
            <input value={state.settings.receiveDir} readOnly />
            <button className="btn btn-ghost" type="button" onClick={() => void window.sc.openPath('receive')}>
              <Icon name="folder" size={16} /> Open
            </button>
          </div>
        </div>
      </Card>

      <Card className="panel">
        <h3>Behaviour</h3>
        <div className="toggle-grid">
          <Toggle
            label="Clipboard sync"
            description="Send copied text both ways automatically"
            checked={state.settings.clipboardSync}
            onChange={(value) => void onChange({ clipboardSync: value })}
          />
          <Toggle
            label="Keep the mouse on the laptop"
            description="When the tablet screen is off, stop the pointer from sliding into it"
            checked={state.settings.cursorGuard}
            onChange={(value) => void onChange({ cursorGuard: value })}
          />
          <Toggle
            label="Touch input forwarding"
            description="Taps and drags on the tablet move the PC cursor"
            checked={state.settings.inputEnabled}
            onChange={(value) => void onChange({ inputEnabled: value })}
          />
          <Toggle
            label="Accept sessions automatically"
            description="Skip confirmation prompts when the tablet connects"
            checked={state.settings.autoAccept}
            onChange={(value) => void onChange({ autoAccept: value })}
          />
          <Toggle
            label="Dark appearance"
            description="Easier on the eyes at night"
            checked={state.settings.theme === 'dark'}
            onChange={(value) => void onChange({ theme: value ? 'dark' : 'light' })}
          />
        </div>
      </Card>

      <Card className="panel about">
        <div className="panel-head">
          <div>
            <h3>About</h3>
            <p className="muted">Local-only. No accounts, no cloud, no telemetry.</p>
          </div>
          <Pill tone="brand">v{state.version}</Pill>
        </div>
        <div className="about-grid">
          <span>App</span>
          <b>Connectivity</b>
          <span>Made by</span>
          <b>Shardul</b>
          <span>Protocol</span>
          <b>Discovery UDP 47777 · WS 47800 · HTTP 47801</b>
          <span>Input bridge</span>
          <b>{state.inputAvailable ? 'Win32 SendInput ready' : 'Not available'}</b>
          <span>Platform</span>
          <b>{state.platform}</b>
          <span>Device id</span>
          <b className="mono">{state.deviceId}</b>
        </div>
        <p className="note">
          If Windows Firewall asks, allow the app on <b>private networks</b> so the tablet can reach it.
        </p>
      </Card>
    </div>
  );
}
