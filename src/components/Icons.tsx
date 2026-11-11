import type { CSSProperties } from 'react';

const paths = {
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  external: 'M8 5H5v14h14v-3M12 5h7v7M10 14l9-9',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',
  clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  close: 'm6 6 12 12M6 18 18 6',
  leaf: 'M5 19c-2-10 7-14 14-14 0 7-4 16-14 14Zm0 0L15 9',
  check: 'm5 12 4 4L19 6',
  play: 'm9 5 11 7-11 7V5Z',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
};
export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
