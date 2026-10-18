"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type ChartPoint = { x: number; y: number; tip: string };
export type ChartSeries = { name: string; color: string; points: ChartPoint[]; dashed?: boolean };
type Props = {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  xLog?: boolean;
  yLog?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  height?: number;
  label: string;
};

const M = { l: 58, r: 150, t: 14, b: 44 };

function ticks(lo: number, hi: number, log: boolean): number[] {
  if (log) {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
    return out;
  }
  const step = 10 ** Math.floor(Math.log10((hi - lo) / 5));
  const mult = [1, 2, 5, 10].find((m) => (hi - lo) / (step * m) <= 6) ?? 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / (step * mult)) * step * mult; v <= hi + 1e-9; v += step * mult) out.push(+v.toFixed(10));
  return out;
}

/** Lines with markers, a legend, direct labels at line ends, per-point tooltips (24px hit targets) and a table view. */
export function LineChart({ series, xLabel, yLabel, xLog, yLog, xDomain, yDomain, xFormat = String, yFormat = String, height = 340, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(() => host.current && setW(host.current.clientWidth));
    ro.observe(host.current);
    setW(host.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  const dom = useMemo(() => {
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    return { x: xDomain ?? ([Math.min(...xs), Math.max(...xs)] as [number, number]), y: yDomain ?? ([Math.min(...ys) * (yLog ? 0.8 : 1), Math.max(...ys) * (yLog ? 1.25 : 1)] as [number, number]) };
  }, [all, xDomain, yDomain, yLog]);
  const iw = Math.max(w - M.l - M.r, 100), ih = height - M.t - M.b;
  const sx = (v: number) => M.l + ((xLog ? Math.log10(v / dom.x[0]) / Math.log10(dom.x[1] / dom.x[0]) : (v - dom.x[0]) / (dom.x[1] - dom.x[0])) * iw);
  const sy = (v: number) => M.t + ih - ((yLog ? Math.log10(v / dom.y[0]) / Math.log10(dom.y[1] / dom.y[0]) : (v - dom.y[0]) / (dom.y[1] - dom.y[0])) * ih);

  return (
    <div>
      <div ref={host} className="relative w-full">
        <svg width={w} height={height} role="img" aria-label={label} className="block">
          {ticks(dom.y[0], dom.y[1], !!yLog).map((t) => (
            <g key={`y${t}`}><line x1={M.l} x2={M.l + iw} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth={1} /><text x={M.l - 8} y={sy(t) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">{yFormat(t)}</text></g>
          ))}
          {ticks(dom.x[0], dom.x[1], !!xLog).map((t) => (
            <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={M.t + ih} y2={M.t + ih + 4} stroke="var(--grid)" /><text x={sx(t)} y={M.t + ih + 18} textAnchor="middle" fontSize={12} fill="var(--muted)">{xFormat(t)}</text></g>
          ))}
          <line x1={M.l} x2={M.l + iw} y1={M.t + ih} y2={M.t + ih} stroke="var(--rule)" />
          <text x={M.l + iw / 2} y={height - 6} textAnchor="middle" fontSize={13} fill="var(--ink-2)">{xLabel}</text>
          <text transform={`translate(14 ${M.t + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={13} fill="var(--ink-2)">{yLabel}</text>
          {series.map((s) => {
            const pts = [...s.points].sort((a, b) => a.x - b.x);
            const last = pts[pts.length - 1];
            return (
              <g key={s.name}>
                <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} />
                {pts.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />)}
                {last && <text x={sx(last.x) + 10} y={sy(last.y) + 4} fontSize={12} fill="var(--ink-2)">{s.name.length > 24 ? s.name.slice(0, 23) + "…" : s.name}</text>}
                {pts.map((p, i) => <circle key={`h${i}`} cx={sx(p.x)} cy={sy(p.y)} r={12} fill="transparent" tabIndex={0} aria-label={p.tip}
                  onPointerEnter={() => setTip({ x: sx(p.x), y: sy(p.y), text: p.tip })} onPointerLeave={() => setTip(null)} onFocus={() => setTip({ x: sx(p.x), y: sy(p.y), text: p.tip })} onBlur={() => setTip(null)} />)}
              </g>
            );
          })}
        </svg>
        {tip && <div className="pointer-events-none absolute z-10 max-w-[18rem] rounded border border-rule bg-panel px-2 py-1 text-xs shadow-sm" style={{ left: Math.min(Math.max(tip.x, 100), w - 100), top: tip.y - 10, transform: "translate(-50%, -100%)" }}>{tip.text}</div>}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">
        {series.map((s) => <li key={s.name} className="flex items-center gap-1.5"><svg width="18" height="4" aria-hidden><line x1="0" x2="18" y1="2" y2="2" stroke={s.color} strokeWidth="3" strokeDasharray={s.dashed ? "4 3" : undefined} /></svg>{s.name}</li>)}
      </ul>
      <details className="mt-2 text-sm text-ink-2">
        <summary className="cursor-pointer">Table</summary>
        <div className="mt-2 overflow-x-auto"><table className="tabular-nums"><thead><tr className="text-left text-muted"><th className="pr-6 font-normal">Series</th><th className="pr-6 font-normal">Point</th></tr></thead>
          <tbody>{series.flatMap((s) => s.points.map((p, i) => <tr key={`${s.name}${i}`}><td className="pr-6">{s.name}</td><td>{p.tip}</td></tr>))}</tbody></table></div>
      </details>
    </div>
  );
}
