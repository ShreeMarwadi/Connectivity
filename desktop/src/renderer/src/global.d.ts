import type { ScApi } from '../../preload/preload';

declare global {
  interface Window {
    sc: ScApi;
  }
}

export {};
