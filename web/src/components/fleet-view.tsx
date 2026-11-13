"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, type FleetStats, type Galaxy, type GalaxyPoint } from "@/lib/api";
import { clock, compact, kindLabel } from "@/lib/format";

const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const OTHER = "var(--m-other)";
type By = "board" | "firmware" | "critical" | "unusual";
const family = (fw: string | null) => (fw?.match(/^v?\d+\.\d+/)?.[0] ?? "unknown");

function Stat({ n, label }: { n: string | number; label: string }) {
  return <div className="rounded border border-rule bg-panel px-4 py-3"><div className="font-dense text-3xl font-semibold tabular-nums">{n}</div><div className="text-sm text-ink-2">{label}</div></div>;
}

/** Horizontal bars with the value written at the end of each bar. */
function HBars({ rows, fmt = (v: number) => String(v), color = "var(--data)", label }: { rows: { name: string; value: number; note?: string }[]; fmt?: (v: number) => string; color?: string; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[9.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-sm">
          <span className="truncate text-ink-2" title={r.name}>{r.name}</span>
          <span className="h-4 rounded-sm bg-rule-soft"><span className="block h-4 rounded-sm" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} /></span>
          <span className="tabular-nums"><span className="font-semibold">{fmt(r.value)}</span>{r.note && <span className="ml-1 text-xs text-muted">{r.note}</span>}</span>
        </li>))}
    </ul>
  );
}

function Columns({ rows, label }: { rows: { name: string; value: number }[]; label: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex items-end gap-2" role="img" aria-label={label}>
      {rows.map((r) => (
        <div key={r.name} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-xs font-semibold tabular-nums">{r.value}</span>
          <div className="flex h-32 w-full items-end"><span className="w-full rounded-t-sm" style={{ height: `${(r.value / max) * 100}%`, minHeight: 3, background: "var(--data)" }} /></div>
          <span className="w-full truncate text-center text-xs text-ink-2">{r.name}</span>
        </div>))}
    </div>
  );
}

/** Each flight is a point; flights that behaved alike sit close together. Colour by board, firmware, critical events or how unusual the flight is. */
function GalaxyPlot({ g }: { g: Galaxy }) {
  const router = useRouter();
  const [by, setBy] = useState<By>("board");
  const [tip, setTip] = useState<GalaxyPoint | null>(null);
  const W = 860, H = 520, P = 28;
  const xs = g.points.map((p) => p.x), ys = g.points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (v: number) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (v: number) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const { colorOf, legend } = useMemo(() => {
    const top = (keyOf: (p: GalaxyPoint) => string) => {
      const c = new Map<string, number>();
      g.points.forEach((p) => c.set(keyOf(p), (c.get(keyOf(p)) ?? 0) + 1));
      const names = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
      return { colorOf: (p: GalaxyPoint) => { const i = names.indexOf(keyOf(p)); return i < 0 ? OTHER : SERIES[i]; }, legend: [...names.map((n, i) => ({ name: n, color: SERIES[i] })), { name: "other", color: OTHER }] };
    };
    if (by === "board") return top((p) => p.hw ?? "unknown");
    if (by === "firmware") return top((p) => family(p.firmware));
    if (by === "critical") return { colorOf: (p: GalaxyPoint) => (p.critical_events >= 3 ? "var(--critical)" : p.critical_events >= 1 ? "var(--warning)" : "var(--data)"), legend: [{ name: "no critical events", color: "var(--data)" }, { name: "1 or 2", color: "var(--warning)" }, { name: "3 or more", color: "var(--critical)" }] };
    return { colorOf: (p: GalaxyPoint) => (p.unusual > 0.45 ? "var(--critical)" : p.unusual > 0.3 ? "var(--warning)" : "var(--data)"), legend: [{ name: "typical", color: "var(--data)" }, { name: "somewhat unusual", color: "var(--warning)" }, { name: "very unusual", color: "var(--critical)" }] };
  }, [g, by]);
  const unusual = [...g.points].sort((a, b) => b.unusual - a.unusual).slice(0, 8);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Colour the flights by">
          <span className="text-ink-2">Colour by</span>
          {([["board", "Board"], ["firmware", "Firmware"], ["critical", "Critical events"], ["unusual", "How unusual"]] as [By, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setBy(k)} aria-pressed={by === k} className={`rounded border px-3 py-1 ${by === k ? "border-route bg-route text-on-route" : "border-rule text-ink-2 hover:border-route"}`}>{l}</button>))}
        </div>
        <div className="relative rounded border border-rule bg-panel">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Flights placed by how they behaved" onPointerLeave={() => setTip(null)}>
            {[0.25, 0.5, 0.75].map((f) => <g key={f}><line x1={P + f * (W - 2 * P)} x2={P + f * (W - 2 * P)} y1={P} y2={H - P} stroke="var(--grid)" /><line y1={P + f * (H - 2 * P)} y2={P + f * (H - 2 * P)} x1={P} x2={W - P} stroke="var(--grid)" /></g>)}
            {g.points.map((p) => (
              <circle key={p.id} cx={X(p.x)} cy={Y(p.y)} r={4 + Math.min(5, Math.sqrt(p.duration_s / 120))} fill={colorOf(p)} fillOpacity={0.8} stroke="var(--panel)" strokeWidth={1.5}
                className="cursor-pointer" onPointerEnter={() => setTip(p)} onClick={() => router.push(`/flights/${p.id}`)} />))}
          </svg>
          {tip && (
            <div className="pointer-events-none absolute z-10 rounded border border-rule bg-panel px-2.5 py-1.5 text-xs shadow-sm" style={{ left: `${(X(tip.x) / W) * 100}%`, top: `${(Y(tip.y) / H) * 100}%`, transform: "translate(12px, -110%)" }}>
              <div className="font-semibold">Flight {tip.source_ref.slice(0, 8)}</div>
              <div className="text-ink-2">{tip.hw ?? "unknown"} · {tip.firmware ?? "?"}</div>
              <div className="text-ink-2">{clock(tip.duration_s)} · {tip.critical_events} critical · unusualness {tip.unusual.toFixed(2)}</div>
            </div>)}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">{legend.map((l) => <li key={l.name} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: l.color }} />{l.name}</li>)}</ul>
        <p className="mt-2 max-w-2xl text-xs text-muted">Position is the 32 dimension behavioural signature projected onto its two main directions ({Math.round(g.explained * 100)}% of the variation is kept). Nearby points behaved alike; larger points are longer flights. Click a point to open the flight.</p>
      </div>
      <div>
        <h3 className="font-dense text-lg font-semibold">Most unusual flights</h3>
        <p className="mb-2 text-sm text-ink-2">Mean distance to the 5 nearest flights; large means nothing else behaved like it.</p>
        <ol className="divide-y divide-rule border-y border-rule">
          {unusual.map((p, i) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="w-5 text-sm tabular-nums text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1"><Link href={`/flights/${p.id}`} className="font-semibold underline decoration-rule underline-offset-2 hover:decoration-route">Flight {p.source_ref.slice(0, 8)}</Link>
                <div className="truncate text-xs text-ink-2">{p.hw ?? "unknown"} · {clock(p.duration_s)} · {p.critical_events} critical</div></div>
              <span className="text-sm font-semibold tabular-nums">{p.unusual.toFixed(2)}</span>
            </li>))}
        </ol>
      </div>
    </div>
  );
}

export function FleetView() {
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => api<FleetStats>("/fleet") });
  const galaxy = useQuery({ queryKey: ["galaxy"], queryFn: () => api<Galaxy>("/galaxy"), retry: false });
  const f = fleet.data;
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">The fleet</h1>
      <p className="mt-1 max-w-3xl text-ink-2">The whole corpus at a glance: who flew what, how often things went wrong, and which flights behave unlike any other.</p>
      {fleet.error && <p className="mt-6 text-critical">Could not load the fleet statistics: {(fleet.error as Error).message}</p>}
      {f && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat n={f.totals.flights} label="flights" /><Stat n={f.totals.boards} label="boards" /><Stat n={compact(f.totals.events)} label="events" />
          <Stat n={f.totals.critical} label="critical events" /><Stat n={`${f.totals.hours} h`} label="flown" />
        </div>)}

      <section className="mt-10" aria-labelledby="galaxy">
        <h2 id="galaxy" className="font-dense text-2xl font-semibold">Flight galaxy</h2>
        <p className="mb-3 mt-1 max-w-2xl text-ink-2">Every flight placed by how it behaved, not by what its text says.</p>
        {galaxy.isPending ? <p className="text-ink-2" aria-busy>Projecting the flights</p> : galaxy.error ? <p className="text-ink-2">The galaxy needs the flight signatures (run scripts/build_signatures.py).</p> : <GalaxyPlot g={galaxy.data} />}
      </section>

      {f && (
        <>
          <div className="mt-12 grid gap-x-12 gap-y-10 lg:grid-cols-2">
            <section aria-labelledby="boards"><h2 id="boards" className="font-dense text-2xl font-semibold">Critical events per flight, by board</h2>
              <p className="mb-3 mt-1 text-sm text-ink-2">The 12 most common boards; the number after each bar is flights.</p>
              <HBars label="Critical events per flight by board" color="var(--critical)" fmt={(v) => v.toFixed(2)} rows={f.boards.map((b) => ({ name: b.hw, value: Number(b.critical_per_flight), note: `${b.flights} flights` }))} /></section>
            <section aria-labelledby="fw"><h2 id="fw" className="font-dense text-2xl font-semibold">Critical events per flight, by firmware</h2>
              <p className="mb-3 mt-1 text-sm text-ink-2">Firmware families with at least 3 flights.</p>
              <HBars label="Critical events per flight by firmware family" color="var(--serious)" fmt={(v) => v.toFixed(2)} rows={f.firmware.map((b) => ({ name: b.family, value: Number(b.critical_per_flight), note: `${b.flights} flights` }))} /></section>
            <section aria-labelledby="kinds"><h2 id="kinds" className="font-dense text-2xl font-semibold">What happens in flights</h2>
              <p className="mb-3 mt-1 text-sm text-ink-2">Events by kind; the note shows how many flights each kind occurs in.</p>
              <HBars label="Events by kind" rows={f.kinds.slice(0, 12).map((k) => ({ name: kindLabel(k.kind), value: k.events, note: `${k.flights} flights` }))} /></section>
            <div className="space-y-8">
              <section aria-labelledby="years"><h2 id="years" className="font-dense text-2xl font-semibold">Flights by year</h2><div className="mt-3"><Columns label="Flights by year" rows={f.years.slice(-8).map((y) => ({ name: String(y.year), value: y.flights }))} /></div></section>
              <section aria-labelledby="dur"><h2 id="dur" className="font-dense text-2xl font-semibold">Flight length</h2><div className="mt-3"><Columns label="Flights by length" rows={f.durations.map((d) => ({ name: d.bucket, value: d.flights }))} /></div></section>
            </div>
          </div>
        </>)}
    </div>
  );
}
