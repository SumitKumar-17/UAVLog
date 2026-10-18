"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { api, type Ontology, type SearchResponse, type SearchResult } from "@/lib/api";
import { clock, kindLabel } from "@/lib/format";
import { EXAMPLES, SearchBox } from "./search-box";
import { Severity } from "./severity";

const SHOW = 25;

export function SearchView() {
  const q = useSearchParams().get("q") ?? "";
  const [kinds, setKinds] = useState<string[]>([]);
  const [minSev, setMinSev] = useState(0);
  const [perFlight, setPerFlight] = useState(true);
  const [details, setDetails] = useState(false);

  const ontology = useQuery({ queryKey: ["ontology"], queryFn: () => api<Ontology>("/ontology") });
  const eventKinds = useMemo(() => ontology.data?.concepts.filter((c) => c.kind === "event").map((c) => c.key) ?? [], [ontology.data]);

  const res = useQuery({
    queryKey: ["search", q, kinds, minSev],
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => api<SearchResponse>("/search", { q, k: 80, kind: kinds, min_severity: minSev || undefined }),
  });

  // Identical events (same kind and text, e.g. "Motors disarmed") collapse into one row listing the other flights.
  const groups = useMemo(() => {
    let all = res.data?.results ?? [];
    if (perFlight) {
      const seen = new Set<string>();
      all = all.filter((r) => (seen.has(r.flight_id) ? false : (seen.add(r.flight_id), true)));
    }
    const byText = new Map<string, SearchResult[]>();
    for (const r of all) {
      const key = `${r.kind}|${r.description}`;
      byText.set(key, [...(byText.get(key) ?? []), r]);
    }
    return [...byText.values()].map((rs) => ({ first: rs[0], rest: rs.slice(1) })).slice(0, SHOW);
  }, [res.data, perFlight]);

  const toggleKind = (k: string) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <div className="pt-10">
      <h1 className="mb-4 font-dense text-3xl font-semibold tracking-tight">Search</h1>
      <div className="max-w-3xl"><SearchBox key={q} initial={q} autoFocus={!q} /></div>

      {q && (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-rule py-3 text-[15px]">
            <details className="relative">
              <summary className="cursor-pointer list-none rounded border border-rule px-3 py-1.5 hover:border-route">
                Event types{kinds.length ? `: ${kinds.length} selected` : ": all"}
              </summary>
              <div className="absolute z-30 mt-1 max-h-80 w-64 overflow-auto rounded border border-rule bg-panel p-2 shadow-md">
                {eventKinds.map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-rule-soft">
                    <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} className="accent-[var(--route)]" />{kindLabel(k)}
                  </label>
                ))}
                {kinds.length > 0 && <button onClick={() => setKinds([])} className="mt-1 w-full rounded px-2 py-1 text-left text-ink-2 underline">Clear selection</button>}
              </div>
            </details>
            <label className="flex items-center gap-2">Severity
              <select value={minSev} onChange={(e) => setMinSev(+e.target.value)} className="rounded border border-rule bg-panel px-2 py-1.5">
                <option value={0}>Any</option><option value={1}>Warning or worse</option><option value={2}>Critical only</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={perFlight} onChange={(e) => setPerFlight(e.target.checked)} className="accent-[var(--route)]" />Best match per flight</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} className="accent-[var(--route)]" />Show how results were ranked</label>
          </div>

          {details && res.data?.filter_estimated_rows != null && (
            <p className="mt-3 text-sm text-ink-2">The filter keeps about {res.data.filter_estimated_rows.toLocaleString("en-US")} events, so the search used its {res.data.strategy?.startsWith("exact") ? "exact path (filter first, then sort by distance)" : "approximate index path"}.</p>
          )}
          <div className={`${res.isFetching ? "opacity-60" : ""}`} aria-live="polite">
            {res.error && <p className="py-8 text-critical">Search failed: {(res.error as Error).message}</p>}
            {!res.error && res.data && groups.length === 0 && (
              <div className="py-10 text-ink-2">
                <p className="font-semibold text-ink">No events match these filters.</p>
                <p className="mt-1">Clear the event type or severity filter, or describe the problem differently, for example “{EXAMPLES[0]}”.</p>
              </div>
            )}
            <ol>
              {groups.map(({ first: r, rest }, i) => (
                <li key={r.id} className="border-b border-rule">
                  <Link href={`/flights/${r.flight_id}?t=${Math.floor(r.t)}`} className="grid gap-x-6 gap-y-1 px-1 py-3.5 hover:bg-rule-soft sm:grid-cols-[minmax(0,1fr)_14rem]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="font-semibold">{kindLabel(r.kind)}</span><Severity level={r.severity} />
                      </div>
                      <p className="mt-0.5 max-w-3xl text-ink-2">{r.description}</p>
                      {details && (
                        <p className="mt-1 text-sm tabular-nums text-muted">
                          Rank {i + 1}, fused score {r.score.toFixed(4)}. Meaning match: {r.vec_rank ? `#${r.vec_rank}` : "not in top results"}
                          {r.distance != null ? ` (cosine distance ${r.distance.toFixed(2)})` : ""}. Word match: {r.fts_rank ? `#${r.fts_rank}` : "none"}.
                        </p>
                      )}
                    </div>
                    <div className="font-dense text-sm text-ink-2 sm:text-right">
                      <div className="font-semibold text-ink">{r.source_ref.slice(0, 8)}</div>
                      <div>at {clock(r.t)} into the log</div>
                    </div>
                  </Link>
                  {rest.length > 0 && (
                    <details className="px-1 pb-3 text-sm text-ink-2">
                      <summary className="cursor-pointer">The same event in {rest.length} more flight{rest.length > 1 ? "s" : ""}</summary>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {rest.map((x) => (
                          <li key={x.id}><Link className="rounded border border-rule px-2 py-0.5 hover:border-route" href={`/flights/${x.flight_id}?t=${Math.floor(x.t)}`}>{x.source_ref.slice(0, 8)} at {clock(x.t)}</Link></li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
      {!q && <p className="mt-8 max-w-2xl text-ink-2">Search matches the meaning of what you type against {" "}events extracted from every flight: failures, warnings, mode changes, takeoffs and landings. You do not need the autopilot’s own wording.</p>}
    </div>
  );
}
