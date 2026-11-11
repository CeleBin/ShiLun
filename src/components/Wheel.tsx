import { characters } from '../lib/domain';

export const COLORS = ['#d9e4b9', '#f1d7ad', '#e6ad8f', '#e8dfbd', '#aec7ac', '#efc9b3', '#c9d5b3', '#eddfb7', '#cedbb0', '#deb298', '#b8d0c0', '#dfcc9f', '#c5cfb8', '#ecc4a2', '#d7dda9', '#dfb8a9'];

function point(degrees: number, radius = 181) {
  const radians = degrees * Math.PI / 180;
  return [200 + radius * Math.cos(radians), 200 + radius * Math.sin(radians)];
}

export function Wheel({ items, angle, busy, duration }: { items: string[]; angle: number; busy: boolean; duration: number }) {
  const count = items.length;
  return <div className="wheel-wrap">
    <div className="wheel-shadow" />
    <svg className="pointer" viewBox="0 0 32 44" aria-hidden="true"><path d="M5 4Q16-1 27 4L20 34Q16 44 12 34Z" fill="#355d45" stroke="#fffdf4" strokeWidth="3.5" /></svg>
    <svg className="wheel" viewBox="0 0 400 400" role="img" aria-label={`转盘，共 ${count} 个选项${count ? `：${items.join('、')}` : '，请先添加想吃的'}`}>
      <circle cx="200" cy="200" r="196" fill="#fdfaf0" />
      <g className="rotor" style={{ transform: `rotate(${angle}deg)`, transition: busy ? `transform ${duration}ms cubic-bezier(.12,.7,.14,1)` : 'none' }}>
        {!count && <><circle cx="200" cy="200" r="183" fill="#dde3d0" /><text x="200" y="113" textAnchor="middle" fill="#58694c" fontSize="15">先加几个想吃的吧</text></>}
        {items.map((name, index) => {
          const start = index * 360 / count - 90;
          const end = (index + 1) * 360 / count - 90;
          const middle = (start + end) / 2;
          const [x1, y1] = point(start);
          const [x2, y2] = point(end);
          const [tx, ty] = point(middle, count > 10 ? 139 : 129);
          const max = count > 10 ? 4 : count > 5 ? 6 : 9;
          const letters = characters(name);
          const label = letters.length > max ? `${letters.slice(0, max - 1).join('')}…` : name;
          return <g key={name}>
            <title>{name}</title>
            {count === 1 ? <circle cx="200" cy="200" r="183" fill={COLORS[index]} /> : <path d={`M200 200L${x1} ${y1}A181 181 0 0 1 ${x2} ${y2}Z`} fill={COLORS[index]} stroke="#fff8e9" strokeWidth="2" />}
            <text x={tx} y={ty} transform={`rotate(${middle + 90},${tx},${ty})`} textAnchor="middle" dominantBaseline="middle" fill="#344a33" fontSize={count > 10 ? 12 : count > 6 ? 14 : 16} fontWeight="600">{label}</text>
          </g>;
        })}
      </g>
      <circle cx="200" cy="200" r="186" fill="none" stroke="#fffaf0" strokeWidth="8" />
      {Array.from({ length: 32 }, (_, i) => { const [x, y] = point(i * 11.25, 190); return <circle key={i} cx={x} cy={y} r="1.4" fill="#b3bda4" />; })}
    </svg>
    <div className="wheel-hub" aria-hidden="true"><svg viewBox="0 0 44 44"><ellipse cx="23" cy="23" rx="12" ry="13" fill="none" stroke="currentColor" strokeWidth="1.6" /><ellipse cx="23" cy="23" rx="8" ry="9" fill="none" stroke="currentColor" strokeWidth="1" /><path d="M6 9v10m3-10v10m3-10v10M6 15h6m-3 4v17M39 9c-5 3-5 12 0 12v15m0-27v12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></div>
  </div>;
}
