"use client";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Envelope } from "@/lib/api";

const SIGNALS: [string, string][] = [["battery.voltage", "Battery voltage"], ["attitude.roll", "Roll"], ["attitude.pitch", "Pitch"], ["vibration.accel", "Vibration"], ["position.z", "Height"], ["gps.speed", "Ground speed"], ["battery.current", "Battery current"], ["attitude.yaw", "Yaw"]];
const W = 760, H = 220, P = { l: 52, r: 12, t: 12, b: 28 };

/** The same signal over the two matching 10 second windows, drawn on top of each other, so the similarity can be seen. */
export function MomentOverlay({ a, b }: { a: { id: string; t0: number; name: string }; b: { id: string; t0: number; name: string } }) {
  const [signal, setSignal] = useState("battery.voltage");
  const res = useQueries({ queries: [a, b].map((w) => ({ queryKey: ["overlay", w.id, signal, w.t0], retry: false,
    queryFn: () => api<Envelope>(`/flights/${w.id}/signals/${signal}`, { from_s: w.t0, to_s: w.t0 + 10, buckets: 40 }) })) });
  const series = res.map((r) => r.data?.points ?? []);
  const all = series.flat().flatMap((p) => [p.lo, p.hi]);
  const lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1, pad = (hi - lo || 1) * 0.08;
  const X = (t: number, t0: number) => P.l + ((t - t0) / 10) * (W - P.l - P.r), Y = (v: number) => P.t + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - P.t - P.b);
  const colors = ["var(--route)", "var(--data)"];
  const line = (pts: Envelope["points"], t0: number) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.t, t0).toFixed(1)},${Y(p.mean).toFixed(1)}`).join(" ");
  const missing = res.every((r) => r.isError);
  return (
    <div className="mt-2 rounded border border-route bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Overlay</span>
        <select value={signal} onChange={(e) => setSignal(e.target.value)} className="rounded border border-rule bg-panel px-2 py-1" aria-label="Signal to overlay">{SIGNALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {[a, b].map((w, i) => <span key={i} className="flex items-center gap-1.5 text-ink-2"><span className="h-0.5 w-5" style={{ background: colors[i], height: 3 }} />{w.name}</span>)}
      </div>
      {missing ? <p className="text-sm text-ink-2">Neither flight has this signal in these windows.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="The same signal in the two windows">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => { const v = lo - pad + f * (hi - lo + 2 * pad); return <g key={f}><line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" /><text x={P.l - 6} y={Y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Number(v.toPrecision(3))}</text></g>; })}
          {[0, 2, 4, 6, 8, 10].map((s) => <text key={s} x={P.l + (s / 10) * (W - P.l - P.r)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">{s} s</text>)}
          {[a, b].map((w, i) => series[i].length > 0 && <path key={i} d={line(series[i], w.t0)} fill="none" stroke={colors[i]} strokeWidth={2.4} strokeLinejoin="round" />)}
        </svg>)}
    </div>
  );
}
