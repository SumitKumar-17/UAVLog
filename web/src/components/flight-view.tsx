"use client";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { api, type FlightDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { PANELS } from "@/lib/panels";
import { useView } from "@/lib/store";
import Link from "next/link";
import { EventList } from "./event-list";
import { NotesPanel } from "./notes-panel";
import { SimilarFlights } from "./similar-flights";
import { TrackPlot } from "./track-plot";
import { FlightTimeline } from "./flight-timeline";
import { SignalChart } from "./signal-chart";

const ERROR_LABELS: Record<number, string> = { 1: "Other", 2: "Vibration", 3: "Airframe design", 4: "Sensor error", 5: "Component failure", 6: "Software", 7: "Human error", 8: "External conditions" };

export function FlightView({ id }: { id: string }) {
  const t = useSearchParams().get("t");
  const { data: f, error, isPending } = useQuery({ queryKey: ["flight", id], queryFn: () => api<FlightDetail>(`/flights/${id}`) });
  const { setFocus, setRange, reset } = useView.getState();

  useEffect(() => { reset(); return () => reset(); }, [id, reset]);
  useEffect(() => {
    if (!f || t == null) return;
    const at = Number(t);
    if (Number.isFinite(at)) { setFocus({ t0: at, t1: at }); setRange([Math.max(0, at - 20), Math.min(f.duration_s, at + 20)]); }
  }, [f, t, setFocus, setRange]);

  const panels = useMemo(() => {
    const have = new Set(f?.signals.map((s) => s.signal));
    return PANELS.map((p) => ({ ...p, series: p.series.filter((s) => have.has(s.signal)) })).filter((p) => p.series.length > 0);
  }, [f]);

  if (error) return <p className="pt-10 text-critical">Could not load this flight: {(error as Error).message}</p>;
  if (isPending) return <div className="pt-10 text-ink-2" aria-busy>Loading flight</div>;

  const m = f.metadata as Record<string, unknown>;
  const labels = ((m.error_labels as number[] | null) ?? []).map((n) => ERROR_LABELS[n] ?? `Label ${n}`);
  const feedback = String(m.feedback ?? "").trim();
  const note = feedback && !/^none given$/i.test(feedback) ? feedback : "";
  const facts: [string, string][] = [
    ["Board", String(m.sys_hw ?? "unknown")], ["Firmware", f.firmware ?? "unknown"],
    ["Flown", clock(f.duration_s)], ["Date", new Date(f.started_at).toISOString().slice(0, 10)],
  ];

  return (
    <div className="pt-8">
      <header className="mb-6">
        <h1 className="font-dense text-3xl font-semibold tracking-tight">Flight {f.source_ref.slice(0, 8)}</h1>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-[15px]">
          {facts.map(([k, v]) => (<div key={k} className="flex gap-2"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>))}
          <div><a className="underline decoration-rule underline-offset-2 hover:decoration-route" href={`https://review.px4.io/plot_app?log=${f.source_ref}`} target="_blank" rel="noreferrer">Open in Flight Review</a></div>
          <div><Link className="underline decoration-rule underline-offset-2 hover:decoration-route" href={`/compare?a=${f.id}`}>Compare with another flight</Link></div>
        </dl>
        {(labels.length > 0 || m.rating || note) && (
          <div className="mt-3 max-w-3xl border-l-2 border-route pl-3 text-[15px]">
            <div className="font-semibold">Notes from the pilot</div>
            {(labels.length > 0 || (m.rating && m.rating !== "none")) && <p className="text-ink-2">{[...labels, m.rating && m.rating !== "none" ? `Rated ${String(m.rating).replaceAll("_", " ")}` : ""].filter(Boolean).join(", ")}</p>}
            {note && <p className="text-ink-2">{note}</p>}
          </div>
        )}
      </header>

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0">
          <FlightTimeline f={f} />
          <div className="mt-6 space-y-3">
            {panels.map((p) => <SignalChart key={p.id} flightId={f.id} duration={f.duration_s} panel={p} modes={f.modes} />)}
            {panels.length === 0 && <p className="text-ink-2">This flight has none of the signals we chart.</p>}
          </div>
          <section className="mt-12" aria-labelledby="notes"><h2 id="notes" className="mb-3 font-dense text-2xl font-semibold">Notes</h2><NotesPanel flightId={f.id} duration={f.duration_s} /></section>
          <section className="mt-12" aria-labelledby="similar">
            <h2 id="similar" className="font-dense text-2xl font-semibold">Flights that behaved like this one</h2>
            <p className="mb-3 mt-1 max-w-2xl text-ink-2">Matched on how the flights behaved (signal statistics, event rates, time in each mode), not on what their text says.</p>
            <SimilarFlights flightId={f.id} />
          </section>
        </div>
        <aside className="space-y-8 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
          <section aria-labelledby="track"><h2 id="track" className="mb-2 font-dense text-2xl font-semibold">Track</h2><TrackPlot flightId={f.id} events={f.events} duration={f.duration_s} /></section>
          <EventList events={f.events} duration={f.duration_s} />
        </aside>
      </div>
    </div>
  );
}
