"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, type FleetStats } from "@/lib/api";
import { compact } from "@/lib/format";

/** A row of four small live charts on the overview: flights per year, critical events by board, the commonest events, and flight lengths. */
export function FleetPulse() {
  const { data: f } = useQuery({ queryKey: ["fleet"], queryFn: () => api<FleetStats>("/fleet") });
  if (!f) return <div className="mt-10 h-40" aria-busy />;
  const years = f.years.slice(-8), maxY = Math.max(...years.map((y) => y.flights), 1);
  const boards = f.boards.slice(0, 5), maxB = Math.max(...boards.map((b) => Number(b.critical_per_flight)), 0.01);
  const kinds = f.kinds.slice(0, 5), maxK = Math.max(...kinds.map((k) => k.events), 1);
  const durs = f.durations, maxD = Math.max(...durs.map((d) => d.flights), 1);
  const Card = ({ title, href, children }: { title: string; href: string; children: React.ReactNode }) => (
    <Link href={href} className="block rounded-lg border border-rule bg-panel px-4 py-3 transition-colors hover:border-route"><div className="mb-2 text-sm font-semibold">{title}</div>{children}</Link>);
  return (
    <section className="mt-10" aria-labelledby="pulse">
      <div className="mb-3 flex items-baseline justify-between"><h2 id="pulse" className="font-dense text-2xl font-semibold">Fleet pulse</h2>
        <span className="text-sm text-ink-2"><b className="text-ink tabular-nums">{f.totals.flights}</b> flights, <b className="text-ink tabular-nums">{compact(f.totals.events)}</b> events, <b className="text-ink tabular-nums">{f.totals.critical}</b> critical</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Flights per year" href="/fleet">
          <div className="flex h-24 items-end gap-1.5">{years.map((y) => <div key={y.year} className="flex flex-1 flex-col items-center justify-end" title={`${y.year}: ${y.flights}`}><span className="w-full rounded-t-sm" style={{ height: `${(y.flights / maxY) * 100}%`, minHeight: 2, background: "var(--data)" }} /><span className="mt-1 text-[10px] text-muted">{String(y.year).slice(2)}</span></div>)}</div></Card>
        <Card title="Critical events per flight" href="/fleet">
          <ul className="space-y-1.5">{boards.map((b) => <li key={b.hw} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs"><span className="truncate text-ink-2">{b.hw.replace("PX4_FMU_", "")}</span><span className="h-2 rounded-sm bg-rule-soft"><span className="block h-2 rounded-sm" style={{ width: `${(Number(b.critical_per_flight) / maxB) * 100}%`, background: "var(--critical)" }} /></span><span className="text-right tabular-nums">{Number(b.critical_per_flight).toFixed(1)}</span></li>)}</ul></Card>
        <Card title="What happens most" href="/patterns">
          <ul className="space-y-1.5">{kinds.map((k) => <li key={k.kind} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.2rem] items-center gap-2 text-xs"><span className="truncate text-ink-2">{k.label.toLowerCase()}</span><span className="h-2 rounded-sm bg-rule-soft"><span className="block h-2 rounded-sm" style={{ width: `${(k.events / maxK) * 100}%`, background: "var(--data)" }} /></span><span className="text-right tabular-nums">{k.events}</span></li>)}</ul></Card>
        <Card title="Flight length" href="/signals">
          <div className="flex h-24 items-end gap-1.5">{durs.map((d) => <div key={d.bucket} className="flex flex-1 flex-col items-center justify-end" title={`${d.bucket}: ${d.flights}`}><span className="w-full rounded-t-sm" style={{ height: `${(d.flights / maxD) * 100}%`, minHeight: 2, background: "var(--s3)" }} /><span className="mt-1 whitespace-nowrap text-[10px] text-muted">{d.bucket.replace(" min", "m")}</span></div>)}</div></Card>
      </div>
    </section>
  );
}
