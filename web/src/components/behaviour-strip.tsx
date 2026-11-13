"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import { useView } from "@/lib/store";
import { AXIS_W } from "./signal-chart";

type B = { windows: { t0: number; t1: number; score: number; pct: number }[]; top: { t0: number; t1: number; score: number; pct: number }[]; reference: { n: number; p50: number; p90: number; p99: number } };

/** Each 10 second window of the flight coloured by how unlike every other flight's behaviour it was (blue typical, red unusual), found with a vector search per window. */
export function BehaviourStrip({ flightId, duration }: { flightId: string; duration: number }) {
  const { data, error, isPending } = useQuery({ queryKey: ["behaviour", flightId], queryFn: () => api<B>(`/flights/${flightId}/behaviour`), retry: false });
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  if (error) return null;
  if (isPending) return <div className="mt-3 h-12 text-sm text-muted" style={{ paddingLeft: AXIS_W }} aria-busy>Comparing every window with the other flights</div>;
  const jump = (t: number) => { const { setFocus, setRange } = useView.getState(); setFocus({ t0: t, t1: t }); setRange([Math.max(0, t - 15), Math.min(duration, t + 25)]); };
  const color = (pct: number) => `color-mix(in srgb, var(--critical) ${Math.max(0, (pct - 50) * 2)}%, var(--data))`;
  return (
    <div className="mt-3" style={{ paddingLeft: AXIS_W, paddingRight: 10 }}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-2">
        <span><b className="text-ink">Behaviour</b>: how unusual each 10 seconds were compared with every other flight (blue typical, red unusual)</span>
        <span className="flex items-center gap-1.5">typical <span className="inline-block h-2 w-20 rounded" style={{ background: "linear-gradient(90deg, var(--data), var(--critical))" }} /> unusual</span>
      </div>
      <div className="relative h-5" onPointerLeave={() => setTip(null)}>
        {data.windows.map((w) => (
          <button key={w.t0} aria-label={`${clock(w.t0)} to ${clock(w.t1)}: more unusual than ${w.pct}% of windows`}
            onPointerEnter={() => setTip({ x: ((w.t0 + 5) / duration) * 100, text: `${clock(w.t0)} to ${clock(w.t1)}: more unusual than ${w.pct.toFixed(0)}% of all windows` })}
            onClick={() => jump(w.t0 + 5)} className="absolute top-0 h-5 cursor-pointer border-0 p-0"
            style={{ left: `${(w.t0 / duration) * 100}%`, width: `${Math.max(0.4, (10 / duration) * 100)}%`, background: color(w.pct) }} />))}
        {tip && <div className="pointer-events-none absolute -top-9 z-10 whitespace-nowrap rounded border border-rule bg-panel px-2 py-1 text-xs shadow-sm" style={{ left: `${Math.min(tip.x, 80)}%` }}>{tip.text}</div>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span>Most unusual moments:</span>
        {data.top.map((w) => <button key={w.t0} onClick={() => jump(w.t0 + 5)} className="underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-route">{clock(w.t0)} (top {Math.max(1, Math.round(100 - w.pct))}%)</button>)}
      </div>
    </div>
  );
}
