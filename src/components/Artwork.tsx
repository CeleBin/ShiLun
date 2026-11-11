import type { Video } from '../data/videos';

// Original vector illustrations; these are decorative cards, not video thumbnails.
export function Artwork({ kind }: { kind: Video['artwork'] }) {
  const warm = kind === 'grill' || kind === 'table';
  const town = kind === 'town';
  const bg = town ? '#cbd7ca' : warm ? '#ead5b5' : kind === 'pot' ? '#dfe5cf' : '#e5c6b4';
  return <svg className="video-artwork" viewBox="0 0 600 320" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <rect width="600" height="320" fill={bg} />
    <circle cx="500" cy="65" r="105" fill="#fff9e8" opacity=".23" />
    <path d="M0 271C145 227 218 284 373 260s200-2 227 7v53H0Z" fill="#fffaf0" opacity=".32" />
    {town ? <>
      <circle cx="452" cy="80" r="27" fill="#f7e8b7" />
      <path d="M60 164h125v137H60z" fill="#80937b" /><path d="m43 166 80-59 79 59Z" fill="#3e604c" />
      <path d="M206 130h153v171H206z" fill="#f3e4c6" /><path d="m189 132 94-64 94 64Z" fill="#526b51" />
      <path d="M386 181h141v120H386z" fill="#94a184" /><path d="m371 182 84-57 86 57Z" fill="#5d765b" />
      {[93, 144, 236, 295, 413, 472].map((x, i) => <rect key={x} x={x} y={i < 2 ? 196 : i < 4 ? 159 : 205} width="22" height="34" rx="10" fill="#f7e5a8" />)}
      <rect x="257" y="226" width="48" height="75" rx="24" fill="#5a7053" />
      <path d="M200 182h164l-8 26H207Z" fill="#ca8666" /><path d="M222 182v24m27-24v24m28-24v24m27-24v24m28-24v24" stroke="#e6c19c" strokeWidth="12" />
      <path d="M0 303h600" stroke="#49694d" strokeWidth="4" />
    </> : kind === 'grill' ? <>
      <ellipse cx="301" cy="261" rx="179" ry="19" fill="#7d8265" opacity=".14" />
      <path d="m173 228 24 49m230-49-24 49" stroke="#51664d" strokeWidth="10" strokeLinecap="round" />
      <rect x="153" y="178" width="294" height="59" rx="20" fill="#4d634b" /><ellipse cx="300" cy="179" rx="147" ry="35" fill="#7a8c69" />
      <path d="m178 173 241 19m-229-36 232 20m-220-34 229 19" stroke="#364d3a" strokeWidth="3" />
      {[0, 1, 2].map(i => <g key={i} transform={`translate(${i * 42},${-i * 12}) rotate(-12 260 150)`}><path d="M188 159h172" stroke="#a97d4d" strokeWidth="5" strokeLinecap="round" />{[0, 1, 2].map(j => <rect key={j} x={204 + j * 37} y="145" width="28" height="26" rx="8" fill={j % 2 ? '#d9a06b' : '#bb7652'} />)}</g>)}
      <path d="M241 111c-19-25 16-26-1-51m65 43c-15-26 17-30 0-53m65 59c-11-22 14-25 3-44" stroke="#fdf6de" strokeWidth="7" strokeLinecap="round" />
    </> : kind === 'pot' || kind === 'steam' ? <>
      <ellipse cx="306" cy="272" rx="174" ry="19" fill="#698163" opacity=".12" />
      <path d="M184 167c0 83 22 104 116 104s116-21 116-104" fill={kind === 'pot' ? '#7b9670' : '#c28867'} />
      <path d="M180 175h-19c-32 0-32 40 2 40h25m231-40h20c32 0 32 40-2 40h-24" stroke={kind === 'pot' ? '#5f7b58' : '#a87153'} strokeWidth="14" />
      <ellipse cx="300" cy="170" rx="116" ry="29" fill="#4e684a" /><ellipse cx="300" cy="172" rx="99" ry="21" fill="#e8c28e" />
      <path d="m258 166 19 11m52-17 18 13m-52 3 10-15" stroke="#75945d" strokeWidth="10" strokeLinecap="round" />
      <path d="M225 121q-19-19 0-38t0-34m76 72q-19-19 0-38t0-34m76 72q-19-19 0-38t0-34" stroke="#fffbeb" strokeWidth="8" strokeLinecap="round" opacity=".85" />
      <path d="M213 204q22 48 65 45" stroke="#f1f1d9" strokeWidth="5" opacity=".4" strokeLinecap="round" />
    </> : <>
      <ellipse cx="306" cy="268" rx="164" ry="20" fill="#6d7455" opacity=".12" />
      <ellipse cx="300" cy="224" rx="158" ry="41" fill="#f8f0d7" /><ellipse cx="300" cy="221" rx="136" ry="30" fill="#d7d8b1" />
      <path d="M188 174c10 59 34 79 112 79s102-20 112-79" fill="#fdf6df" /><ellipse cx="300" cy="175" rx="113" ry="37" fill="#a6b589" />
      <ellipse cx="300" cy="173" rx="99" ry="28" fill="#dec38a" />
      <path d="M233 169q67-42 134 0m-132 8q65-40 130 0m-117 9q54-32 108-1" stroke="#f9e4ac" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="331" cy="163" rx="28" ry="16" transform="rotate(-18 331 163)" fill="#faf0cf" /><ellipse cx="332" cy="161" rx="13" ry="10" fill="#e5ae5f" />
      <path d="m235 151 16 7m-5-17 17 10m85 26 13 7" stroke="#567a4e" strokeWidth="8" strokeLinecap="round" />
      <path d="m373 138 92-80m-80 91 97-80" stroke="#82664b" strokeWidth="5" strokeLinecap="round" />
      <path d="M270 119c-15-16 11-24 0-40m42 32c-13-19 15-22 2-42" stroke="#fff8e7" strokeWidth="6" strokeLinecap="round" />
    </>}
    <path d="m68 67 4-11 4 11 11 4-11 4-4 11-4-11-11-4Zm440 140 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill="#fff9e9" opacity=".8" />
  </svg>;
}
