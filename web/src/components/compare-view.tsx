"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api, type Envelope, type FlightDetail, type FlightSummary } from "@/lib/api";
import { clock, kindLabel } from "@/lib/format";
import { PANELS } from "@/lib/panels";
import { LineChart } from "./line-chart";
import { ModeRibbon } from "./mode-ribbon";

const SIGNALS = PANELS.flatMap((p) => p.series.map((s) => ({ signal: s.signal, label: `${p.title}: ${s.label}`, unit: p.unit })));

function Picker({ label, value, onChange, flights }: { label: string; value: string; onChange: (v: string) => void; flights: FlightSummary[] }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 rounded border border-rule bg-panel px-2 py-2">
        <option value="">Choose a flight</option>
        {flights.map((f) => <option key={f.id} value={f.id}>{f.source_ref.slice(0, 8)} · {f.hw ?? "unknown board"} · {clock(f.duration_s)}</option>)}
      </select>
    </label>
  );
}

const useFlight = (id: string) => useQuery({ queryKey: ["flight", id], queryFn: () => api<FlightDetail>(`/flights/${id}`), enabled: !!id });
const useEnvelope = (id: string, signal: string, on: boolean) =>
  useQuery({ queryKey: ["compare-env", id, signal], queryFn: () => api<Envelope>(`/flights/${id}/signals/${signal}`, { buckets: 300 }), enabled: !!id && on, retry: false });

export function CompareView() {
  const router = useRouter();
  const params = useSearchParams();
  const a = params.get("a") ?? "", b = params.get("b") ?? "";
  const [signal, setSignal] = useState("battery.voltage");
  const [align, setAlign] = useState(true);
  const list = useQuery({ queryKey: ["flights", "picker"], queryFn: () => api<FlightSummary[]>("/flights", { limit: 300, sort: "recent" }) });
  const fa = useFlight(a), fb = useFlight(b);
  const ea = useEnvelope(a, signal, true), eb = useEnvelope(b, signal, true);
  const set = (k: "a" | "b", v: string) => { const q = new URLSearchParams(params.toString()); v ? q.set(k, v) : q.delete(k); router.replace(`/compare?${q}`); };

  const common = useMemo(() => SIGNALS.filter((s) => [fa.data, fb.data].every((f) => !f || f.signals.some((x) => x.signal === s.signal))), [fa.data, fb.data]);
  const takeoff = (f?: FlightDetail) => (align ? f?.events.find((e) => e.kind === "takeoff")?.t_start ?? 0 : 0);
  const series = useMemo(() => [[fa.data, ea.data, "var(--s1)", "A"], [fb.data, eb.data, "var(--s2)", "B"]].flatMap(([f, e, color, tag]) => {
    const fl = f as FlightDetail | undefined, env = e as Envelope | undefined;
    if (!fl || !env) return [];
    const off = takeoff(fl);
    return [{ name: `${tag}: ${fl.source_ref.slice(0, 8)}`, color: color as string, points: env.points.map((p) => ({ x: p.t - off, y: p.mean, tip: `${tag} at ${clock(Math.abs(p.t - off))}${p.t - off < 0 ? " before takeoff" : ""}: mean ${p.mean.toFixed(2)}, range ${p.lo.toFixed(2)} to ${p.hi.toFixed(2)}` })) }];
  }), [fa.data, fb.data, ea.data, eb.data, align]); // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = useMemo(() => [...new Set([...(fa.data?.events ?? []), ...(fb.data?.events ?? [])].map((e) => e.kind))].sort(), [fa.data, fb.data]);
  const count = (f: FlightDetail | undefined, k: string) => f?.events.filter((e) => e.kind === k).length ?? 0;
  const unit = SIGNALS.find((s) => s.signal === signal)?.unit ?? "";

  return (
    <div className="pt-10">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Compare flights</h1>
      <p className="mb-5 mt-1 max-w-2xl text-ink-2">Overlay the same signal from two flights. The signal names are the canonical ones, so flights from different boards line up.</p>
      <div className="flex max-w-3xl flex-wrap gap-4">
        <Picker label="Flight A" value={a} onChange={(v) => set("a", v)} flights={list.data ?? []} />
        <Picker label="Flight B" value={b} onChange={(v) => set("b", v)} flights={list.data ?? []} />
      </div>

      {(!a || !b) && <p className="mt-8 max-w-2xl text-ink-2">Choose two flights to compare. From a flight page, use “Compare with another flight” or the Compare button on a similar flight.</p>}
      {a && b && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
            <label className="flex items-center gap-2">Signal
              <select value={signal} onChange={(e) => setSignal(e.target.value)} className="rounded border border-rule bg-panel px-2 py-1.5">
                {common.map((s) => <option key={s.signal} value={s.signal}>{s.label}{s.unit ? ` (${s.unit})` : ""}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} className="accent-[var(--route)]" />Align both flights at takeoff</label>
          </div>
          <div className="mt-4 grid max-w-4xl gap-3">
            {[["A", fa.data], ["B", fb.data]].map(([tag, f]) => f && (
              <div key={tag as string} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="font-semibold">{tag as string}</span>
                <ModeRibbon modes={(f as FlightDetail).modes} marks={(f as FlightDetail).events.filter((e) => e.severity >= 1).map((e) => ({ t: e.t_start, severity: e.severity, kind: e.kind, description: e.description }))} duration={(f as FlightDetail).duration_s} height={14} label={`Flight modes of flight ${tag}`} />
              </div>
            ))}
          </div>
          <div className="mt-6 max-w-5xl">
            {series.length === 2 ? <LineChart series={series} xLabel={align ? "Seconds from takeoff" : "Seconds from the start of the log"} yLabel={unit ? `${signal} (${unit})` : signal} xFormat={(v) => `${Math.round(v)}`} yFormat={(v) => `${+v.toPrecision(3)}`} label={`${signal} for both flights`} />
              : <p className="text-ink-2" aria-busy={ea.isPending || eb.isPending}>{ea.error || eb.error ? "One of the flights has no data for this signal. Choose another signal." : "Loading"}</p>}
          </div>
          {fa.data && fb.data && (
            <div className="mt-8 max-w-3xl overflow-x-auto">
              <table className="w-full text-[15px] tabular-nums">
                <thead><tr className="text-left text-muted"><th className="pb-1.5 font-normal">&nbsp;</th><th className="pb-1.5 font-normal"><Link className="underline" href={`/flights/${fa.data.id}`}>A: {fa.data.source_ref.slice(0, 8)}</Link></th><th className="pb-1.5 font-normal"><Link className="underline" href={`/flights/${fb.data.id}`}>B: {fb.data.source_ref.slice(0, 8)}</Link></th></tr></thead>
                <tbody>
                  <tr className="border-t border-rule"><td className="py-1.5 text-ink-2">Board</td><td>{String(fa.data.metadata.sys_hw ?? "unknown")}</td><td>{String(fb.data.metadata.sys_hw ?? "unknown")}</td></tr>
                  <tr className="border-t border-rule"><td className="py-1.5 text-ink-2">Firmware</td><td>{fa.data.firmware ?? "unknown"}</td><td>{fb.data.firmware ?? "unknown"}</td></tr>
                  <tr className="border-t border-rule"><td className="py-1.5 text-ink-2">Flown</td><td>{clock(fa.data.duration_s)}</td><td>{clock(fb.data.duration_s)}</td></tr>
                  {kinds.map((k) => <tr key={k} className="border-t border-rule"><td className="py-1.5 text-ink-2">{kindLabel(k)} events</td><td>{count(fa.data, k)}</td><td>{count(fb.data, k)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
