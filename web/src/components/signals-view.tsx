"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, type SignalDist, type SignalTop } from "@/lib/api";
import { clock } from "@/lib/format";

const num = (v: number) => Number(v.toPrecision(3)).toString();

function Histogram({ d, big }: { d: SignalDist; big?: boolean }) {
  const max = Math.max(...d.bins, 1);
  const W = big ? 560 : 200, H = big ? 150 : 46, bw = W / d.bins.length;
  const medX = d.hi > d.lo ? ((d.med - d.lo) / (d.hi - d.lo)) * W : W / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H + (big ? 18 : 0)}`} className="w-full" role="img" aria-label={`Distribution of the per-flight mean of ${d.label}`}>
      {d.bins.map((n, i) => <rect key={i} x={i * bw + 1} y={H - (n / max) * H} width={bw - 2} height={Math.max(n ? 1.5 : 0, (n / max) * H)} fill="var(--data)" rx={1}><title>{n} flights</title></rect>)}
      <line x1={medX} x2={medX} y1={0} y2={H} stroke="var(--route)" strokeWidth={big ? 2 : 1.5} />
      {big && <><text x={0} y={H + 14} fontSize={11} fill="var(--muted)">{num(d.lo)}</text><text x={W} y={H + 14} fontSize={11} textAnchor="end" fill="var(--muted)">{num(d.hi)} {d.unit ?? ""}</text><text x={Math.min(Math.max(medX, 40), W - 60)} y={H + 14} fontSize={11} textAnchor="middle" fill="var(--route)">median {num(d.med)}</text></>}
    </svg>
  );
}

function Detail({ d }: { d: SignalDist }) {
  const [by, setBy] = useState<"max" | "min">("max");
  const { data } = useQuery({ queryKey: ["signal-top", d.signal, by], queryFn: () => api<SignalTop[]>(`/signals/${d.signal}/top`, { by, limit: 8 }) });
  return (
    <div className="mb-8 rounded-lg border border-route bg-panel p-5">
      <div className="flex flex-wrap items-baseline gap-x-4"><h2 className="font-dense text-2xl font-semibold">{d.label}</h2><code className="text-sm text-ink-2">{d.signal}</code><span className="text-sm text-ink-2">{d.n} flights{d.unit ? `, unit ${d.unit}` : ""}</span></div>
      {d.description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{d.description}</p>}
      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div><div className="mb-1 text-sm text-ink-2">Per-flight mean across all flights (2nd to 98th percentile); the pink line is the median</div><Histogram d={d} big />
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-muted">lowest ever</dt><dd className="font-semibold tabular-nums">{num(d.vmin)}</dd></div><div><dt className="text-muted">median of means</dt><dd className="font-semibold tabular-nums">{num(d.med)}</dd></div><div><dt className="text-muted">highest ever</dt><dd className="font-semibold tabular-nums">{num(d.vmax)}</dd></div></dl></div>
        <div>
          <div className="mb-2 flex gap-2 text-sm" role="group" aria-label="Order"><span className="text-ink-2">Flights with the</span>
            {(["max", "min"] as const).map((k) => <button key={k} onClick={() => setBy(k)} aria-pressed={by === k} className={`rounded border px-2.5 py-0.5 ${by === k ? "border-route bg-route text-on-route" : "border-rule text-ink-2 hover:border-route"}`}>{k === "max" ? "highest" : "lowest"}</button>)}</div>
          <ol className="divide-y divide-rule border-y border-rule">{data?.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-1.5 text-sm"><Link href={`/flights/${f.id}`} className="font-semibold underline decoration-rule underline-offset-2 hover:decoration-route">Flight {f.source_ref.slice(0, 8)}</Link>
              <span className="truncate text-ink-2">{f.hw ?? "unknown"} · {clock(f.duration_s)}</span><span className="ml-auto font-semibold tabular-nums">{num(f.value)}</span></li>))}</ol>
        </div>
      </div>
    </div>
  );
}

/** Every canonical signal at a glance: how many flights have it and how its per-flight mean is distributed; click one for the extremes. */
export function SignalsView() {
  const { data, error, isPending } = useQuery({ queryKey: ["signals-overview"], queryFn: () => api<SignalDist[]>("/signals/overview") });
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  if (error) return <p className="pt-10 text-critical">{(error as Error).message}</p>;
  const shown = (data ?? []).filter((d) => !q || d.label.toLowerCase().includes(q.toLowerCase()) || d.signal.includes(q.toLowerCase()));
  const cur = data?.find((d) => d.signal === sel);
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Signals</h1>
      <p className="mt-1 max-w-3xl text-ink-2">The {data?.length ?? 34} canonical signals, named the same for both autopilots. Each card shows how the signal's per-flight mean is distributed across the corpus (computed in SQL with <code>width_bucket</code> over the signal summary); click one for its extremes and the flights behind them.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter signals" aria-label="Filter signals" className="mb-5 mt-4 h-10 w-64 rounded border border-rule bg-panel px-3 text-[15px]" />
      {isPending && <p className="text-ink-2" aria-busy>Reading the signal summary</p>}
      {cur && <Detail d={cur} />}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((d) => (
          <li key={d.signal}><button onClick={() => { setSel(d.signal); window.scrollTo({ top: 0, behavior: "smooth" }); }} aria-pressed={sel === d.signal}
            className={`w-full rounded-lg border bg-panel px-4 py-3 text-left transition-colors hover:border-route ${sel === d.signal ? "border-route" : "border-rule"}`}>
            <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{d.label}</span><span className="text-xs tabular-nums text-muted">{d.n} flights</span></div>
            <div className="text-xs text-ink-2">{d.signal}{d.unit ? ` · ${d.unit}` : ""} · median {num(d.med)}</div>
            <div className="mt-2"><Histogram d={d} /></div></button></li>))}
      </ul>
    </div>
  );
}
