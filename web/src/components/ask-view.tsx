"use client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ask, type AskAnswer } from "@/lib/api";

const EXAMPLES = [
  "Which three boards had the most critical events?",
  "How many flights had a motor failure detected?",
  "What is the average flight length in minutes?",
  "Which flight had the highest vibration?",
  "How many flights did the pilot label with vibration as a cause?",
];

const show = (v: unknown): string =>
  v === null || v === undefined ? "–" : typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : String(Math.round(v * 1000) / 1000)) : Array.isArray(v) ? v.map(show).join(", ") : String(v);

function Evidence({ a }: { a: AskAnswer }) {
  const repaired = a.attempts.length > 1;
  return (
    <details className="mt-6 border-t border-rule pt-4 text-[15px]">
      <summary className="cursor-pointer font-semibold">How this was answered</summary>
      <div className="mt-3 max-w-4xl space-y-4">
        {a.sql && (
          <div>
            <div className="mb-1 text-ink-2">The query that ran, rebuilt by the guard from what the model wrote</div>
            <pre className="overflow-auto rounded border border-rule bg-panel p-3 text-[13px] leading-relaxed whitespace-pre-wrap">{a.sql}</pre>
          </div>
        )}
        <ul className="space-y-1 text-ink-2">
          {a.notes.map((n) => <li key={n}>The guard {n}.</li>)}
          {a.cost != null && <li>The planner estimated a cost of {Math.round(a.cost).toLocaleString("en-US")}; queries above 100,000 are refused before they run.</li>}
          <li>Generating took {Math.round(a.generate_ms)} ms and running took {a.run_ms < 10 ? a.run_ms.toFixed(1) : Math.round(a.run_ms)} ms.</li>
          <li>The query ran in a read-only transaction as a role that can only see the curated views, with an 8 second limit.</li>
        </ul>
        {repaired && (
          <div>
            <div className="mb-1 text-ink-2">The model needed {a.attempts.length} attempts. Earlier ones that failed:</div>
            {a.attempts.filter((t) => t.error).map((t, i) => (
              <div key={i} className="mb-2 rounded border border-rule p-3">
                <pre className="overflow-auto text-[13px] whitespace-pre-wrap">{t.sql}</pre>
                <p className="mt-1 text-critical">{t.error}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function Result({ a }: { a: AskAnswer }) {
  if (a.cannot_answer)
    return (
      <div className="mt-8 max-w-3xl border-l-2 border-route pl-4">
        <p className="font-semibold">The data cannot answer this.</p>
        <p className="mt-1 text-ink-2">{a.cannot_answer}</p>
        <p className="mt-3 text-ink-2">The corpus holds flights, the events found in them, 34 telemetry signals and how those relate. Try asking about boards, failures, battery, GPS, vibration or flight length.</p>
      </div>
    );
  if (a.error)
    return (
      <div className="mt-8 max-w-3xl border-l-2 border-critical pl-4">
        <p className="font-semibold">No safe query could be produced for this question.</p>
        <p className="mt-1 text-ink-2">{a.error}</p>
        <p className="mt-3 text-ink-2">Rephrase it more specifically, for example name the signal or event kind you care about.</p>
        <Evidence a={a} />
      </div>
    );
  return (
    <div className="mt-8">
      {a.explanation && <p className="max-w-3xl text-xl leading-snug">{a.explanation}</p>}
      <div className="mt-5 overflow-x-auto">
        <table className="min-w-[24rem] text-[15px] tabular-nums">
          <thead><tr>{a.columns.map((c, j) => <th key={c} className={`border-b border-rule pb-1.5 pr-8 font-normal text-muted ${typeof a.rows[0]?.[j] === "number" ? "text-right" : "text-left"}`}>{c.replaceAll("_", " ")}</th>)}</tr></thead>
          <tbody>
            {a.rows.map((r, i) => <tr key={i} className="border-b border-rule-soft">{r.map((v, j) => <td key={j} className={`py-1.5 pr-8 ${typeof v === "number" ? "text-right" : ""}`}>{show(v)}</td>)}</tr>)}
          </tbody>
        </table>
        {a.rows.length === 0 && <p className="py-4 text-ink-2">The query ran and matched nothing.</p>}
      </div>
      {a.truncated && <p className="mt-2 text-sm text-muted">Showing the first 200 rows; there are more.</p>}
      <Evidence a={a} />
    </div>
  );
}

export function AskView() {
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: ask });
  const go = (text: string) => text.trim().length >= 3 && m.mutate(text.trim());
  return (
    <div className="pt-10">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Ask the data</h1>
      <p className="mb-5 mt-1 max-w-2xl text-ink-2">Ask a question about the flights in plain English. The app writes a database query, checks it, runs it read-only and shows both the answer and the query.</p>
      <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="flex max-w-3xl gap-2" role="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Your question" placeholder="For example: which board had the most failsafes?"
          className="h-12 min-w-0 flex-1 rounded border border-rule bg-panel px-4 text-lg text-ink placeholder:text-muted focus:border-route" />
        <button disabled={m.isPending} className="h-12 rounded bg-route px-6 text-base font-semibold text-on-route hover:opacity-90 disabled:opacity-60">{m.isPending ? "Working" : "Ask"}</button>
      </form>
      <div className="mt-3 flex max-w-3xl flex-wrap gap-2 text-sm">
        {EXAMPLES.map((x) => <button key={x} onClick={() => { setQ(x); go(x); }} className="rounded border border-rule px-3 py-1 text-ink-2 hover:border-route hover:text-ink">{x}</button>)}
      </div>
      <div aria-live="polite" className={m.isPending ? "opacity-60" : ""}>
        {m.error && <p className="mt-8 text-critical">{(m.error as Error).message}</p>}
        {m.data && <Result a={m.data} />}
        {m.isPending && !m.data && <p className="mt-8 text-ink-2" aria-busy>Writing and checking the query</p>}
      </div>
    </div>
  );
}
