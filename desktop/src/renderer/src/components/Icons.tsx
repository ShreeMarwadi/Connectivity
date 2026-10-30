import type { CSSProperties } from 'react';

interface IconProps {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}

export type IconName =
  | 'home'
  | 'devices'
  | 'mirror'
  | 'extend'
  | 'share'
  | 'settings'
  | 'laptop'
  | 'tablet'
  | 'phone'
  | 'link'
  | 'wifi'
  | 'check'
  | 'copy'
  | 'folder'
  | 'upload'
  | 'download'
  | 'play'
  | 'stop'
  | 'cursor'
  | 'clipboard'
  | 'sun'
  | 'moon'
  | 'close'
  | 'search'
  | 'refresh'
  | 'bolt'
  | 'screen';

const paths: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h5v-5.5h3V20h5V9.5',
  devices: 'M4 5.5h10.5A2.5 2.5 0 0 1 17 8v3M7 19h5M9.5 15.5V19M17.5 11h3.2c.7 0 1.3.6 1.3 1.3v7.4c0 .7-.6 1.3-1.3 1.3h-3.2c-.7 0-1.3-.6-1.3-1.3v-7.4c0-.7.6-1.3 1.3-1.3Z',
  mirror: 'M3.5 5.5h13v9h-13zM7 19h6M10 14.5V19M19 9.5h2.5v10H13',
  extend: 'M3 6.5h11v8H3zM7 19h3M8.5 14.5V19M16.5 8h5v8.5h-5zM15 20h8',
  share: 'M12 15.5V4m0 0L8 8m4-4 4 4M4.5 14v5.5h15V14',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9v.09A1.7 1.7 0 0 0 20.96 10H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z',
  laptop: 'M5 6.5h14v9.5H5zM2.5 19.5h19l-1.5-3.5H4z',
  tablet: 'M6.5 3.5h11c.8 0 1.5.7 1.5 1.5v14c0 .8-.7 1.5-1.5 1.5h-11c-.8 0-1.5-.7-1.5-1.5V5c0-.8.7-1.5 1.5-1.5ZM11 17.5h2',
  phone: 'M8 3.5h8c.8 0 1.5.7 1.5 1.5v14c0 .8-.7 1.5-1.5 1.5H8c-.8 0-1.5-.7-1.5-1.5V5c0-.8.7-1.5 1.5-1.5ZM11 17h2',
  link: 'M9.5 14.5 14.5 9.5M8 12 5.8 14.2a3.7 3.7 0 0 0 5.2 5.2L13.2 17M16 12l2.2-2.2a3.7 3.7 0 0 0-5.2-5.2L10.8 7',
  wifi: 'M2.5 8.5a14 14 0 0 1 19 0M5.8 11.8a9 9 0 0 1 12.4 0M9.2 15.2a4.5 4.5 0 0 1 5.6 0M12 18.8h.01',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  copy: 'M8.5 8.5h10v11h-10zM5.5 15.5h-1v-11h10v1',
  folder: 'M3.5 6.5h6l2 2h9v11h-17z',
  upload: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 15v4.5h15V15',
  download: 'M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4.5 19.5h15',
  play: 'M7.5 4.5 19 12 7.5 19.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  cursor: 'M5.5 3.5 18 11l-5.7 1.3L9.6 18z',
  clipboard: 'M8.5 4.5h7v2.5h-7zM6.5 6.5h-2v14h15v-14h-2M9 12h6M9 16h4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16.5 16.5 21 21',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 3.5V9h-5.5',
  bolt: 'M13 2 4.5 13.5H11L10 22l8.5-11.5H12z',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
};

export function Icon({ name, size = 20, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
