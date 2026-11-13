"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, post, type Evidence, type Investigation } from "@/lib/api";
import { clock } from "@/lib/format";
import { useView } from "@/lib/store";

function Cites({ ids, byId, open, jump }: { ids: string[]; byId: Map<string, Evidence>; open: string | null; jump: (e: Evidence) => void }) {
  return (
    <span className="ml-1 whitespace-nowrap">
      {ids.map((id) => { const e = byId.get(id); return (
        <button key={id} onClick={() => e && jump(e)} title={e?.text} className={`mx-0.5 rounded border px-1.5 py-0.5 text-xs font-semibold tabular-nums ${open === id ? "border-route text-route" : "border-rule text-ink-2 hover:border-route"}`}>{id}</button>
      ); })}
    </span>
  );
}

const CONF: Record<string, string> = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };

/** A cited incident report. The evidence is computed by SQL and numbered; the model writes prose around it and every citation is checked. */
/** Questions about this flight, answered only from the numbered evidence. */
function FlightQuestion({ flightId, jump }: { flightId: string; jump: (e: Evidence) => void }) {
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: (question: string) => post<{ answer: string; cites: string[]; evidence: Evidence[] }>(`/flights/${flightId}/ask`, { question }) });
  const byId = new Map<string, Evidence>((m.data?.evidence ?? []).map((e) => [e.id, e]));
  return (
    <div className="mt-6 max-w-3xl border-t border-rule pt-4">
      <div className="font-semibold">Ask about this flight</div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) m.mutate(q.trim()); }} className="mt-2 flex gap-2" role="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question about this flight" placeholder="Did the battery trigger the failsafe?" className="h-10 min-w-0 flex-1 rounded border border-rule bg-panel px-3 text-[15px]" />
        <button disabled={m.isPending} className="h-10 rounded border border-rule px-4 text-[15px] hover:border-route disabled:opacity-60">{m.isPending ? "Reading the evidence" : "Ask"}</button>
      </form>
      {m.error && <p className="mt-2 text-sm text-critical">{(m.error as Error).message}</p>}
      {m.data && <p className="mt-3 text-[15px]">{m.data.answer}<Cites ids={m.data.cites} byId={byId} open={null} jump={jump} /></p>}
    </div>
  );
}

export function InvestigatePanel({ flightId, duration }: { flightId: string; duration: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const existing = useQuery({ queryKey: ["investigation", flightId], retry: false, queryFn: () => api<Investigation>(`/flights/${flightId}/investigation`) });
  const make = useMutation({ mutationFn: (refresh: boolean) => post<Investigation>(`/flights/${flightId}/investigate`, { refresh }), onSuccess: (d) => qc.setQueryData(["investigation", flightId], d) });
  const data = make.data ?? existing.data;
  const byId = new Map<string, Evidence>((data?.evidence ?? []).map((e) => [e.id, e]));

  const download = () => {
    if (!data) return;
    const r = data.report, cite = (ids: string[]) => (ids.length ? ` [${ids.join(", ")}]` : "");
    const md = [`# ${r.headline}`, "", "## Findings", ...r.findings.map((f, i) => `${i + 1}. ${f.text}${cite(f.cites)}`), "", `## Probable cause (${r.probable_cause.confidence} confidence)`, `${r.probable_cause.text}${cite(r.probable_cause.cites)}`, "",
      "## Next checks", ...r.next_checks.map((c) => `- ${c}`), "", "## Evidence (computed by SQL)", ...data.evidence.map((e) => `- **${e.id}** ${e.text}`), "", `_Written by ${data.model} from the evidence above; numbers and times come from SQL._`].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `incident-report-${flightId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const jump = (e: Evidence) => {
    setOpen(e.id);
    if (e.t != null) { const { setFocus, setRange } = useView.getState(); setFocus({ t0: e.t, t1: e.t }); setRange([Math.max(0, e.t - 20), Math.min(duration, e.t + 20)]); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };

  return (
    <div>
      {!data && (
        <div className="flex flex-wrap items-center gap-4 rounded border border-rule bg-panel px-4 py-3">
          <button onClick={() => make.mutate(false)} disabled={make.isPending} className="h-10 rounded bg-route px-5 font-semibold text-on-route hover:opacity-90 disabled:opacity-60">
            {make.isPending ? "Gathering evidence and writing" : "Write an incident report"}
          </button>
          <span className="text-sm text-ink-2">Facts are pulled from the database and numbered; the model may only cite them.</span>
        </div>
      )}
      {make.error && <p className="mt-3 text-critical">{(make.error as Error).message}</p>}
      {data && (
        <div className="max-w-3xl">
          <p className="font-dense text-xl font-semibold leading-snug">{data.report.headline}</p>
          <ol className="mt-3 space-y-2.5 text-[15px]">
            {data.report.findings.map((f, i) => <li key={i} className="border-l-2 border-rule pl-3">{f.text}<Cites ids={f.cites} byId={byId} open={open} jump={jump} /></li>)}
          </ol>
          <div className="mt-4 rounded border border-rule bg-panel px-4 py-3">
            <div className="flex items-center gap-3"><span className="font-semibold">Probable cause</span><span className="rounded border border-rule px-2 py-0.5 text-xs text-ink-2">{CONF[data.report.probable_cause.confidence] ?? data.report.probable_cause.confidence}</span></div>
            <p className="mt-1 text-[15px]">{data.report.probable_cause.text}<Cites ids={data.report.probable_cause.cites} byId={byId} open={open} jump={jump} /></p>
          </div>
          <div className="mt-4"><div className="font-semibold">Next checks</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] text-ink-2">{data.report.next_checks.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          <details className="mt-4" open={open != null}>
            <summary className="cursor-pointer font-semibold">Evidence ({data.evidence.length} items computed by SQL)</summary>
            <ul className="mt-2 divide-y divide-rule border-y border-rule text-sm">
              {data.evidence.map((e) => (
                <li key={e.id} className={`flex gap-3 py-1.5 ${open === e.id ? "bg-rule-soft" : ""}`}>
                  <span className="w-8 shrink-0 font-semibold tabular-nums">{e.id}</span>
                  <span className="min-w-0 flex-1 text-ink-2">{e.text}</span>
                  {e.t != null && <button onClick={() => jump(e)} className="shrink-0 text-xs underline hover:text-ink">{clock(e.t)}</button>}
                </li>))}
            </ul>
          </details>
          <FlightQuestion flightId={flightId} jump={jump} />
          <p className="mt-3 text-xs text-muted">Written by {data.model} from the evidence above; numbers and times come from SQL, not the model.{data.report.dropped_citations ? ` ${data.report.dropped_citations} citation(s) that did not match any evidence were removed.` : ""}{" "}
            <button onClick={() => make.mutate(true)} disabled={make.isPending} className="underline hover:text-ink">{make.isPending ? "Rewriting" : "Rewrite"}</button>{" "}
            <button onClick={download} className="underline hover:text-ink">Download as Markdown</button></p>
        </div>
      )}
    </div>
  );
}
