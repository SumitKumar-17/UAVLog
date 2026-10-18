"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type EventRow, type Track } from "@/lib/api";
import { clock, kindLabel } from "@/lib/format";
import { modeColor } from "@/lib/modes";
import { useView } from "@/lib/store";

const SIZE = 340, PAD = 18;
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** Ground track in local metres (north up, east right), coloured by flight mode, with critical events marked. Click to jump the charts. */
export function TrackPlot({ flightId, events, duration }: { flightId: string; events: EventRow[]; duration: number }) {
  const { data, error } = useQuery({ queryKey: ["track", flightId], queryFn: () => api<Track>(`/flights/${flightId}/track`), retry: false });
  const focus = useView((s) => s.focus);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  if (error) return <p className="text-sm text-muted">This flight has no position track.</p>;
  if (!data) return <div style={{ height: SIZE }} aria-busy />;

  const pts = data.points;
  const east = pts.map((p) => p.y), north = pts.map((p) => p.x);
  const cx = (Math.min(...east) + Math.max(...east)) / 2, cy = (Math.min(...north) + Math.max(...north)) / 2;
  const span = Math.max(Math.max(...east) - Math.min(...east), Math.max(...north) - Math.min(...north), 20);
  const k = (SIZE - 2 * PAD) / span;
  const X = (e: number) => SIZE / 2 + (e - cx) * k, Y = (n: number) => SIZE / 2 - (n - cy) * k;
  const modeAt = (t: number) => { let m = data.modes[0]?.mode ?? ""; for (const s of data.modes) if (s.t0 <= t) m = s.mode; return m; };

  // runs of equal mode, each starting from the previous point so the line stays connected
  const runs: { mode: string; d: string }[] = [];
  pts.forEach((p, i) => {
    const m = modeAt(p.t), seg = `${X(p.y).toFixed(1)},${Y(p.x).toFixed(1)}`;
    const last = runs[runs.length - 1];
    if (last && last.mode === m) last.d += ` L${seg}`;
    else runs.push({ mode: m, d: `${i ? `M${X(pts[i - 1].y).toFixed(1)},${Y(pts[i - 1].x).toFixed(1)} L` : "M"}${seg}` });
  });
  const nearest = (t: number) => pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), pts[0]);
  const crit = events.filter((e) => e.severity >= 2 && pts.length).map((e) => ({ e, p: nearest(e.t_start) }));
  const bar = NICE.find((m) => m * k >= 50) ?? NICE[NICE.length - 1];
  const foc = focus ? nearest(focus.t0) : null;

  const jump = (t: number) => { const { setFocus, setRange } = useView.getState(); setFocus({ t0: t, t1: t }); setRange([Math.max(0, t - 20), Math.min(duration, t + 20)]); };
  const onMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * SIZE, my = ((ev.clientY - r.top) / r.height) * SIZE;
    const p = pts.reduce((b, q) => (Math.hypot(X(q.y) - mx, Y(q.x) - my) < Math.hypot(X(b.y) - mx, Y(b.x) - my) ? q : b), pts[0]);
    setTip(Math.hypot(X(p.y) - mx, Y(p.x) - my) < 24 ? { x: X(p.y), y: Y(p.x), text: `${clock(p.t)} into the log, ${modeAt(p.t)} mode${p.z != null ? `, ${Math.round(-p.z)} m above the start` : ""}` } : null);
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label="Ground track of the flight, coloured by flight mode" onPointerMove={onMove} onPointerLeave={() => setTip(null)}
        onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); const mx = ((ev.clientX - r.left) / r.width) * SIZE, my = ((ev.clientY - r.top) / r.height) * SIZE;
          const p = pts.reduce((b, q) => (Math.hypot(X(q.y) - mx, Y(q.x) - my) < Math.hypot(X(b.y) - mx, Y(b.x) - my) ? q : b), pts[0]); jump(p.t); }}>
        <rect x={0.5} y={0.5} width={SIZE - 1} height={SIZE - 1} fill="none" stroke="var(--rule)" />
        {runs.map((r, i) => <path key={i} d={r.d} fill="none" stroke={modeColor(r.mode)} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />)}
        <circle cx={X(pts[0].y)} cy={Y(pts[0].x)} r={5} fill="var(--panel)" stroke="var(--ink)" strokeWidth={2} />
        <rect x={X(pts[pts.length - 1].y) - 4.5} y={Y(pts[pts.length - 1].x) - 4.5} width={9} height={9} fill="var(--ink)" stroke="var(--panel)" strokeWidth={2} />
        {crit.map(({ e, p }) => <path key={e.id} d={`M${X(p.y) - 6},${Y(p.x) - 5} L${X(p.y) + 6},${Y(p.x) - 5} L${X(p.y)},${Y(p.x) + 6} Z`} fill="var(--critical)" stroke="var(--panel)" strokeWidth={1.5}><title>{`${clock(e.t_start)}: ${kindLabel(e.kind)}`}</title></path>)}
        {foc && <circle cx={X(foc.y)} cy={Y(foc.x)} r={8} fill="none" stroke="var(--route)" strokeWidth={3} />}
        <g transform={`translate(${PAD}, ${SIZE - 14})`}><line x1={0} x2={bar * k} y1={0} y2={0} stroke="var(--ink-2)" strokeWidth={2} /><text x={bar * k + 6} y={4} fontSize={12} fill="var(--ink-2)">{bar >= 1000 ? `${bar / 1000} km` : `${bar} m`}</text></g>
        <g transform={`translate(${SIZE - 24}, 26)`}><path d="M0,-14 L5,0 L0,-3 L-5,0 Z" fill="var(--ink-2)" /><text y={14} textAnchor="middle" fontSize={11} fill="var(--ink-2)">N</text></g>
        {tip && <circle cx={tip.x} cy={tip.y} r={6} fill="none" stroke="var(--ink)" strokeWidth={2} />}
      </svg>
      {tip && <div className="pointer-events-none absolute z-10 max-w-[16rem] rounded border border-rule bg-panel px-2 py-1 text-xs shadow-sm" style={{ left: `${(tip.x / SIZE) * 100}%`, top: `${(tip.y / SIZE) * 100}%`, transform: "translate(-50%, -130%)" }}>{tip.text}</div>}
      <p className="mt-1 text-xs text-muted">Open circle: start. Square: end. Triangles: critical events. Click the track to jump the charts to that moment.</p>
    </div>
  );
}
