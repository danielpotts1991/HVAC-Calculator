// Generic plan symbols for plumbing fixtures. Each draws centred on (0,0), w wide and h deep,
// with the wall (back) side at the top (-y). Rotate the enclosing group to face another wall.

export const SYMBOLS: [string, string][] = [
  ['wc', 'Water closet (flush valve)'], ['wc-tank', 'Water closet (tank)'], ['urinal', 'Urinal'], ['lav', 'Lavatory'],
  ['sink', 'Sink, single'], ['sink2', 'Sink, double'], ['mop', 'Mop / service sink'], ['floordrain', 'Floor drain'],
  ['floorsink', 'Floor sink'], ['shower', 'Shower'], ['tub', 'Bathtub'], ['fountain', 'Drinking fountain'],
  ['hosebibb', 'Hose bibb'], ['washer', 'Clothes washer'], ['dishwasher', 'Dishwasher'], ['bidet', 'Bidet'],
  ['washfountain', 'Wash fountain'], ['generic', 'Generic (circle)'],
];

type P = { symbol: string; w: number; h: number; stroke: string; fill: string; fillOpacity: number; sw: number };

export function FixtureSymbol({ symbol, w, h, stroke, fill, fillOpacity, sw }: P) {
  const x0 = -w / 2, y0 = -h / 2, m = Math.min(w, h);
  const base = { stroke, strokeWidth: sw, fill, fillOpacity };
  const line = { stroke, strokeWidth: sw * 0.8, fill: 'none' };
  const box = <rect x={x0} y={y0} width={w} height={h} {...base} />;
  switch (symbol) {
    case 'wc': case 'wc-tank': case 'bidet': {
      const back = symbol === 'wc-tank' ? h * 0.28 : symbol === 'wc' ? h * 0.14 : 0;
      const bw = symbol === 'wc-tank' ? w * 0.92 : w * 0.6;
      const bowlTop = y0 + back, by = (bowlTop + h / 2) / 2, ry = (h - back) / 2;
      return <g>
        {back > 0 && <rect x={-bw / 2} y={y0} width={bw} height={back} rx={sw} {...base} />}
        <ellipse cx={0} cy={by} rx={w * 0.42} ry={ry * 0.98} {...base} />
        <ellipse cx={0} cy={by + ry * 0.12} rx={w * 0.24} ry={ry * 0.6} {...line} />
      </g>;
    }
    case 'urinal':
      return <path d={`M${x0},${y0} L${-x0},${y0} L${-x0},${y0 + h * 0.35} Q${-x0},${h / 2} 0,${h / 2} Q${x0},${h / 2} ${x0},${y0 + h * 0.35} Z`} {...base} />;
    case 'lav':
      return <g>{box}<ellipse cx={0} cy={h * 0.06} rx={w * 0.33} ry={h * 0.3} {...line} /><circle cx={0} cy={y0 + h * 0.12} r={m * 0.05} fill={stroke} /></g>;
    case 'sink':
      return <g>{box}<rect x={x0 + w * 0.12} y={y0 + h * 0.2} width={w * 0.76} height={h * 0.68} rx={m * 0.06} {...line} /><circle cx={0} cy={h * 0.1} r={m * 0.05} {...line} /></g>;
    case 'sink2':
      return <g>{box}
        <rect x={x0 + w * 0.06} y={y0 + h * 0.2} width={w * 0.41} height={h * 0.68} rx={m * 0.05} {...line} />
        <rect x={w * 0.03} y={y0 + h * 0.2} width={w * 0.41} height={h * 0.68} rx={m * 0.05} {...line} /></g>;
    case 'mop':
      return <g>{box}<rect x={x0 + w * 0.15} y={y0 + h * 0.15} width={w * 0.7} height={h * 0.7} {...line} />
        <path d={`M${x0 + w * 0.15},${y0 + h * 0.15} L0,0 L${w * 0.35},${y0 + h * 0.15} M${x0 + w * 0.15},${h * 0.35} L0,0 L${w * 0.35},${h * 0.35}`} {...line} /></g>;
    case 'floordrain':
      return <g><circle r={m / 2} {...base} /><path d={`M${-m * 0.35},0 L${m * 0.35},0 M0,${-m * 0.35} L0,${m * 0.35} M${-m * 0.25},${-m * 0.25} L${m * 0.25},${m * 0.25} M${-m * 0.25},${m * 0.25} L${m * 0.25},${-m * 0.25}`} {...line} /></g>;
    case 'floorsink':
      return <g>{box}<circle r={m * 0.32} {...line} /><path d={`M${-m * 0.32},0 L${m * 0.32},0 M0,${-m * 0.32} L0,${m * 0.32}`} {...line} /></g>;
    case 'shower':
      return <g>{box}<path d={`M${x0},${y0} L${-x0},${-y0} M${-x0},${y0} L${x0},${-y0}`} {...line} /><circle r={m * 0.08} {...base} /></g>;
    case 'tub':
      return <g>{box}<rect x={x0 + w * 0.06} y={y0 + h * 0.1} width={w * 0.88} height={h * 0.8} rx={m * 0.3} {...line} /><circle cx={x0 + w * 0.18} cy={0} r={m * 0.06} {...line} /></g>;
    case 'fountain':
      return <g><path d={`M${x0},${y0} L${-x0},${y0} L${-x0},0 A${w / 2},${h / 2} 0 0 1 ${x0},0 Z`} {...base} /><circle cx={0} cy={0} r={m * 0.12} {...line} /></g>;
    case 'hosebibb':
      return <g><line x1={0} y1={y0} x2={0} y2={0} {...line} /><circle cx={0} cy={0} r={m * 0.32} {...base} /></g>;
    case 'washer':
      return <g>{box}<circle r={m * 0.32} {...line} /></g>;
    case 'dishwasher':
      return <g>{box}<path d={`M${x0},${y0 + h * 0.2} L${-x0},${y0 + h * 0.2}`} {...line} /><text x={0} y={h * 0.15} textAnchor="middle" fontSize={m * 0.3} fill={stroke}>DW</text></g>;
    case 'washfountain':
      return <g><circle r={m / 2} {...base} /><circle r={m * 0.3} {...line} /></g>;
    default:
      return <circle r={m / 2} {...base} />;
  }
}

// Small preview for lists and pickers (fits a box of `px` pixels).
export function SymbolPreview({ symbol, w, h, px = 34, color = '#0e7490' }: { symbol: string; w: number; h: number; px?: number; color?: string }) {
  const s = (px - 4) / Math.max(w, h, 0.01);
  return <svg width={px} height={px} viewBox={`${-px / 2} ${-px / 2} ${px} ${px}`} aria-hidden="true">
    <FixtureSymbol symbol={symbol} w={w * s} h={h * s} stroke={color} fill={color} fillOpacity={0.12} sw={1.2} />
  </svg>;
}
