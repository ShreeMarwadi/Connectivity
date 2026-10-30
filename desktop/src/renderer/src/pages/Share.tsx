import { useState } from 'react';
import type { AppState } from '../../../preload/preload';
import type { SharedFile, TransferItem } from '../../../shared/types';
import { Icon } from '../components/Icons';
import { Card, EmptyState, formatBytes, formatTime, Pill, Progress } from '../components/UI';

export default function Share({
  state,
  shared,
  transfers,
  onAdd,
  onRemove,
}: {
  state: AppState;
  shared: SharedFile[];
  transfers: TransferItem[];
  onAdd: () => Promise<void>;
  onRemove: (token: string) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const paths = [...event.dataTransfer.files]
      .map((file) => window.sc.pathForFile(file))
      .filter((path): path is string => !!path);
    if (paths.length) await window.sc.addShare(paths);
  };

  return (
    <div className="stack">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void drop(e)}
        onClick={() => void onAdd()}
        role="button"
        tabIndex={0}
      >
        <span className="dropzone-icon">
          <Icon name="upload" size={28} />
        </span>
        <strong>Drop files here to share</strong>
        <span className="muted">or click to browse · files stay on this PC until the tablet downloads them</span>
      </div>

      <section>
        <div className="section-head">
          <h3>Shared with tablet ({shared.length})</h3>
          <button className="link-btn" type="button" onClick={() => void window.sc.openPath('receive')}>
            <Icon name="folder" size={15} /> Open received folder
          </button>
        </div>

        {shared.length === 0 ? (
          <EmptyState
            icon="share"
            title="Nothing shared yet"
            description="Add a file above. On the tablet, open “Files from PC” to download it over Wi-Fi."
          />
        ) : (
          <div className="file-list">
            {shared.map((file) => (
              <Card key={file.token} className="file-row">
                <span className="file-icon">
                  <Icon name="folder" size={18} />
                </span>
                <div className="file-main">
                  <strong className="ellipsis">{file.name}</strong>
                  <span className="muted">
                    {formatBytes(file.size)} · added {formatTime(file.addedAt)}
                  </span>
                </div>
                <Pill tone="brand">ready</Pill>
                <button className="icon-btn" type="button" title="Remove" onClick={() => onRemove(file.token)}>
                  <Icon name="close" size={16} />
                </button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h3>Transfers</h3>
          <span className="muted small">HTTP over local Wi-Fi · {state.net.ip}:{state.net.httpPort}</span>
        </div>

        {transfers.length === 0 ? (
          <Card className="hint-card">
            <span className="hint-icon">
              <Icon name="download" size={20} />
            </span>
            <div>
              <strong>No transfers yet</strong>
              <p>
                PC → tablet: open a shared file on the tablet. Tablet → PC: choose “Send to PC” in the tablet app; files
                land in {state.settings.receiveDir}.
              </p>
            </div>
          </Card>
        ) : (
          <div className="file-list">
            {transfers.map((item) => {
              const pct = item.size ? (item.bytes / item.size) * 100 : item.status === 'done' ? 100 : 0;
              return (
                <Card key={item.id} className="file-row transfer-row">
                  <span className={`file-icon ${item.direction}`}>
                    <Icon name={item.direction === 'down' ? 'download' : 'upload'} size={18} />
                  </span>
                  <div className="file-main">
                    <strong className="ellipsis">{item.name}</strong>
                    <span className="muted">
                      {item.direction === 'down' ? 'Tablet → PC' : 'PC → Tablet'} · {formatBytes(item.bytes)} /{' '}
                      {formatBytes(item.size)}
                      {item.error ? ` · ${item.error}` : ''}
                    </span>
                    <Progress value={pct} />
                  </div>
                  <Pill tone={item.status === 'done' ? 'ok' : item.status === 'error' ? 'err' : 'warn'}>
                    {item.status}
                  </Pill>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
