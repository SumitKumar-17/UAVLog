"use client";
import "uplot/dist/uPlot.min.css";
import uPlot from "uplot";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { api, type Envelope, type Segment } from "@/lib/api";
import { clock } from "@/lib/format";
import { modeColorVar } from "@/lib/modes";
import { useView } from "@/lib/store";
import { cssVar, useThemeVersion } from "@/lib/theme";
import type { Panel } from "@/lib/panels";

export const AXIS_W = 56;
const BUCKETS = 600;

type Env = { lo: (number | null)[]; hi: (number | null)[] };

function align(envs: (Envelope | undefined)[]): { data: uPlot.AlignedData; env: Env[] } {
  const xs = new Set<number>();
  envs.forEach((e) => e?.points.forEach((p) => xs.add(p.t)));
  const x = [...xs].sort((a, b) => a - b);
  const idx = new Map(x.map((t, i) => [t, i]));
  const means: (number | null)[][] = [];
  const env: Env[] = [];
  for (const e of envs) {
    const mean: (number | null)[] = Array(x.length).fill(null);
    const lo = [...mean], hi = [...mean];
    e?.points.forEach((p) => { const i = idx.get(p.t)!; mean[i] = p.mean; lo[i] = p.lo; hi[i] = p.hi; });
    means.push(mean);
    env.push({ lo, hi });
  }
  return { data: [x, ...means] as uPlot.AlignedData, env };
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

export function SignalChart({ flightId, duration, panel, modes, height = 170 }: { flightId: string; duration: number; panel: Panel; modes: Segment[]; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const envRef = useRef<Env[]>([]);
  const rangeRef = useRef<[number, number]>([0, duration]);
  const modesRef = useRef(modes);
  modesRef.current = modes;
  const range = useView((s) => s.range) ?? [0, duration];
  const setRange = useView((s) => s.setRange);
  const theme = useThemeVersion();
  rangeRef.current = range;
  const a = Math.round(range[0] * 10) / 10, b = Math.round(range[1] * 10) / 10;

  const results = useQueries({
    queries: panel.series.map((s) => ({
      queryKey: ["env", flightId, s.signal, a, b],
      queryFn: () => api<Envelope>(`/flights/${flightId}/signals/${s.signal}`, { from_s: a, to_s: b, buckets: BUCKETS }),
      placeholderData: keepPreviousData,
      retry: false,
    })),
  });
  const envs = results.map((r) => r.data);
  const fetching = results.some((r) => r.isFetching);
  const failed = results.every((r) => r.isError);
  const aligned = useMemo(() => align(envs), [results.map((r) => r.dataUpdatedAt).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the chart once per theme; data and range update it in place.
  useEffect(() => {
    if (!host.current) return;
    const muted = cssVar("--muted"), grid = cssVar("--grid"), route = cssVar("--route");
    const colors = panel.series.map((_, i) => cssVar(`--s${i + 1}`));
    const opts: uPlot.Options = {
      width: host.current.clientWidth, height,
      padding: [10, 10, 0, 0],
      cursor: { sync: { key: "flight" }, drag: { x: true, y: false, setScale: false }, points: { size: 8 } },
      scales: {
        x: { time: false, range: () => rangeRef.current },
        y: {
          range: () => {
            let lo = Infinity, hi = -Infinity;
            for (const e of envRef.current) for (let i = 0; i < e.lo.length; i++) { if (e.lo[i] != null) lo = Math.min(lo, e.lo[i]!); if (e.hi[i] != null) hi = Math.max(hi, e.hi[i]!); }
            if (!isFinite(lo)) return [0, 1];
            const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
            return [lo - pad, hi + pad];
          },
        },
      },
      axes: [
        { size: 30, stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, values: (_u, t) => t.map(clock), space: 80 },
        { size: AXIS_W, stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { show: false }, values: (_u, t) => t.map((v) => (Math.abs(v) >= 1000 ? `${v / 1000}k` : String(+v.toFixed(2)))) },
      ],
      series: [
        { label: "", value: (_u, v) => (v == null ? "" : clock(v)) }, // blank at rest; CSS hides empty legend entries
        ...panel.series.map((s, i) => ({
          label: s.label, stroke: colors[i], width: 2, spanGaps: true, points: { show: false },
          // blank while the pointer is away (idx null); a dash only where the hovered bucket truly has no sample
          value: (_u: uPlot, v: number | null, _si: number, idx: number | null) => (idx == null ? "" : v == null ? "–" : `${fmt(v)}${panel.unit ? ` ${panel.unit}` : ""}`),
        })),
      ],
      legend: { live: true },
      hooks: {
        drawClear: [(u) => { // flight-mode shading behind everything
          const { ctx, bbox } = u;
          ctx.save(); ctx.beginPath(); ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height); ctx.clip(); ctx.globalAlpha = 0.16;
          for (const m of modesRef.current) {
            const x0 = u.valToPos(m.t0, "x", true), x1 = u.valToPos(m.t1, "x", true);
            ctx.fillStyle = cssVar(modeColorVar(m.mode)); ctx.fillRect(x0, bbox.top, Math.max(x1 - x0 - 2, 1), bbox.height);
          }
          ctx.restore();
        }],
        drawAxes: [(u) => { // min/max envelope: the worst reading in each bucket is always visible
          const { ctx, bbox } = u; const x = u.data[0];
          ctx.save(); ctx.beginPath(); ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height); ctx.clip();
          envRef.current.forEach((e, si) => {
            ctx.fillStyle = colors[si]; ctx.globalAlpha = 0.16;
            let i = 0;
            while (i < x.length) {
              if (e.lo[i] == null) { i++; continue; }
              let j = i; while (j + 1 < x.length && e.lo[j + 1] != null) j++;
              ctx.beginPath();
              for (let k = i; k <= j; k++) ctx.lineTo(u.valToPos(x[k], "x", true), u.valToPos(e.hi[k]!, "y", true));
              for (let k = j; k >= i; k--) ctx.lineTo(u.valToPos(x[k], "x", true), u.valToPos(e.lo[k]!, "y", true));
              ctx.closePath(); ctx.fill(); i = j + 1;
            }
          });
          ctx.restore();
        }],
        draw: [(u) => { // selected event
          const f = useView.getState().focus; if (!f) return;
          const { ctx, bbox } = u; const x0 = u.valToPos(f.t0, "x", true), x1 = u.valToPos(Math.max(f.t1, f.t0), "x", true);
          ctx.save(); ctx.beginPath(); ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height); ctx.clip();
          ctx.fillStyle = route; ctx.globalAlpha = 0.14; ctx.fillRect(x0, bbox.top, Math.max(x1 - x0, 3), bbox.height);
          ctx.globalAlpha = 1; ctx.fillStyle = route; ctx.fillRect(x0, bbox.top, 2, bbox.height);
          ctx.restore();
        }],
        setSelect: [(u) => {
          const { left, width } = u.select;
          if (width > 8) setRange([u.posToVal(left, "x"), u.posToVal(left + width, "x")]);
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
        }],
      },
    };
    const u = new uPlot(opts, aligned.data, host.current);
    plot.current = u;
    u.over.addEventListener("dblclick", () => useView.getState().reset());
    const unsub = useView.subscribe(() => u.redraw(false));
    const ro = new ResizeObserver(() => host.current && u.setSize({ width: host.current.clientWidth, height }));
    ro.observe(host.current);
    return () => { unsub(); ro.disconnect(); u.destroy(); plot.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, panel.id, height]);

  useEffect(() => {
    envRef.current = aligned.env;
    plot.current?.setData(aligned.data, true);
  }, [aligned, a, b]);

  const stats = panel.series.map((s, i) => {
    const m = aligned.data[i + 1] as (number | null)[] | undefined;
    const e = aligned.env[i];
    const vals = (m ?? []).filter((v): v is number => v != null);
    const lo = e ? Math.min(...(e.lo.filter((v) => v != null) as number[])) : NaN;
    const hi = e ? Math.max(...(e.hi.filter((v) => v != null) as number[])) : NaN;
    return { label: s.label, min: lo, max: hi, mean: vals.length ? vals.reduce((p, c) => p + c, 0) / vals.length : NaN };
  });

  return (
    <section className="border-t border-rule pt-3" aria-label={panel.title}>
      <div className="flex items-baseline justify-between" style={{ paddingLeft: AXIS_W }}>
        <h3 className="font-dense text-lg font-semibold">{panel.title}{panel.unit && <span className="ml-1.5 text-sm font-normal text-muted">{panel.unit}</span>}</h3>
        {fetching && <span className="text-xs text-muted">updating</span>}
      </div>
      {failed ? <p className="py-6 text-muted" style={{ paddingLeft: AXIS_W }}>No data for this signal in this flight.</p> : (
        <div ref={host} className={fetching ? "opacity-70" : ""} />
      )}
      {!failed && (
        <details className="pb-2 text-sm text-ink-2" style={{ paddingLeft: AXIS_W }}>
          <summary className="cursor-pointer">Table</summary>
          <table className="mt-2 tabular-nums">
            <thead><tr className="text-left text-muted"><th className="pr-6 font-normal">Series</th><th className="pr-6 font-normal">Lowest</th><th className="pr-6 font-normal">Mean</th><th className="font-normal">Highest</th></tr></thead>
            <tbody>{stats.map((s) => <tr key={s.label}><td className="pr-6">{s.label}</td><td className="pr-6">{isFinite(s.min) ? fmt(s.min) : "–"}</td><td className="pr-6">{isFinite(s.mean) ? fmt(s.mean) : "–"}</td><td>{isFinite(s.max) ? fmt(s.max) : "–"}</td></tr>)}</tbody>
          </table>
          <p className="mt-1 text-xs text-muted">Over the visible window. Lowest and highest are the true extremes, not averages.</p>
        </details>
      )}
    </section>
  );
}
