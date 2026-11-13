"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Correlations } from "@/lib/api";

const color = (r: number | null) => (r == null ? "var(--rule-soft)" : r >= 0 ? `color-mix(in srgb, var(--s2) ${Math.round(Math.abs(r) * 100)}%, var(--panel))` : `color-mix(in srgb, var(--data) ${Math.round(Math.abs(r) * 100)}%, var(--panel))`);

/** Which signals moved together in this flight: Pearson correlation on a one-second grid (orange together, blue opposite). */
export function CorrelationHeatmap({ flightId }: { flightId: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["corr", flightId], queryFn: () => api<Correlations>(`/flights/${flightId}/correlations`), retry: false });
  const [tip, setTip] = useState<string | null>(null);
  if (error) return <p className="text-ink-2">Not enough signals in this flight to correlate.</p>;
  if (isPending) return <p className="text-ink-2" aria-busy>Correlating the signals</p>;
  const n = data.signals.length, C = 30, L = 150;
  const pairs = data.matrix.flatMap((row, i) => row.map((r, j) => ({ i, j, r }))).filter((p) => p.i < p.j && p.r != null).sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!)).slice(0, 3);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-ink-2"><span className="min-h-5 font-semibold text-ink" aria-live="polite">{tip ?? "Hover a cell"}</span>
        <span className="ml-auto flex items-center gap-2 text-xs">opposite <span className="inline-block h-2.5 w-28 rounded" style={{ background: "linear-gradient(90deg, var(--data), var(--panel), var(--s2))" }} /> together</span></div>
      <div className="overflow-x-auto rounded border border-rule bg-panel p-3">
        <svg width={L + n * C + 8} height={L + n * C + 8} role="img" aria-label="Correlation matrix of the flight's signals">
          {data.signals.map((s, i) => <text key={s.key} x={L - 6} y={L + i * C + C / 2 + 4} fontSize={11} textAnchor="end" fill="var(--ink-2)">{s.label.slice(0, 22)}</text>)}
          {data.signals.map((s, i) => <text key={s.key + "c"} transform={`translate(${L + i * C + C / 2 + 4},${L - 6}) rotate(-60)`} fontSize={11} fill="var(--ink-2)">{s.label.slice(0, 22)}</text>)}
          {data.matrix.map((row, i) => row.map((r, j) => (
            <rect key={`${i}-${j}`} x={L + j * C} y={L + i * C} width={C - 2} height={C - 2} rx={3} fill={color(r)}
              onPointerEnter={() => setTip(`${data.signals[i].label} and ${data.signals[j].label}: r = ${r == null ? "n/a" : r.toFixed(2)}`)} onPointerLeave={() => setTip(null)} />)))}
        </svg>
      </div>
      <p className="mt-2 text-sm text-ink-2">Strongest pairs: {pairs.map((p) => `${data.signals[p.i].label} and ${data.signals[p.j].label} (${p.r!.toFixed(2)})`).join("; ")}.</p>
    </div>
  );
}
