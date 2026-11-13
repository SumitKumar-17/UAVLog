"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Step = { path: string; title: string; text: string };

const steps = (flight: string): Step[] => [
  { path: "/", title: "Overview", text: "Search by meaning, entry points to every feature, and the flights ranked by critical events. The vertical bar on the left lists every page; Ctrl+K jumps anywhere." },
  { path: `/flights/${flight}`, title: "One flight", text: "A strip of flight modes with event marks, a behaviour strip showing how unusual each 10 seconds were, synchronized charts, the ground track and the events. Try Replay." },
  { path: `/flights/${flight}#investigate`, title: "Incident report with citations", text: "The database gathers numbered evidence with SQL; the model only writes prose and must cite it. Click a citation to jump the charts to that moment." },
  { path: `/flights/${flight}#moments`, title: "Similar moments", text: "Find where other flights behaved the same way, with an HNSW index over 10-second windows. Overlay draws the two matches on top of each other." },
  { path: "/map", title: "Map", text: "Every flight with a GPS fix, coloured by critical events." },
  { path: "/fleet", title: "Fleet and galaxy", text: "Boards, firmware, a year calendar and the galaxy: every flight placed by how it behaved." },
  { path: "/incidents", title: "Incidents", text: "Every warning and failure across flights; open one at the exact moment." },
  { path: "/patterns", title: "Patterns", text: "What tends to happen before and after an event, computed live with a windowed self-join." },
  { path: "/signals", title: "Signals", text: "The distribution of every canonical signal across the corpus, named the same for both autopilots." },
  { path: "/rules", title: "Rule lab", text: "Move a detector's threshold and see precision and recall against the autopilot's warnings change immediately." },
  { path: "/ask", title: "Ask", text: "Natural language to guarded SQL. Open 'How this was answered' to see the SQL, the cost and the guard's actions." },
  { path: "/workbench", title: "SQL workbench", text: "Write your own SQL under the same four checks; Explain draws the plan." },
  { path: "/data", title: "Data explorer", text: "The schema as a diagram read from the catalog, every table, its columns, indexes and rows." },
  { path: "/performance", title: "Performance", text: "Live cache hit ratio, costliest statements and how tables are scanned." },
  { path: "/benchmarks", title: "Benchmarks", text: "Every experiment in the report, drawn from the saved result files." },
];

/** A guided walk through the application: Next and Back (or the arrow keys) move between pages and a card says what to look at. */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [flight, setFlight] = useState("");
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!open || flight) return;
    api<{ id: string; critical_events: number }[]>("/flights", { limit: 40 }).then((d) => setFlight([...d].sort((a, b) => b.critical_events - a.critical_events)[0]?.id ?? "")).catch(() => {});
  }, [open, flight]);
  const list = steps(flight || "unknown");
  const go = (n: number) => { const k = Math.min(Math.max(n, 0), list.length - 1); setI(k); router.push(list[k].path); };
  useEffect(() => { if (open) { setI(0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" || e.key === "Enter") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!open) return null;
  const s = list[i];
  return (
    <div className="fixed bottom-5 right-5 z-50 w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-lg border border-route bg-panel p-4 shadow-2xl" role="dialog" aria-label="Guided tour">
      <div className="flex items-baseline justify-between text-xs text-muted"><span>Tour, step {i + 1} of {list.length}</span><button onClick={onClose} className="underline hover:text-ink">End tour</button></div>
      <div className="mt-1 font-dense text-xl font-semibold">{s.title}</div>
      <p className="mt-1 text-[15px] text-ink-2">{s.text}</p>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => go(i - 1)} disabled={i === 0} className="rounded border border-rule px-3 py-1.5 text-sm hover:border-route disabled:opacity-40">Back</button>
        <button onClick={() => (i === list.length - 1 ? onClose() : go(i + 1))} className="rounded bg-route px-4 py-1.5 text-sm font-semibold text-on-route hover:opacity-90">{i === list.length - 1 ? "Finish" : i === 0 && pathIs(s.path) ? "Start" : "Next"}</button>
        <span className="ml-auto h-1.5 w-24 rounded bg-rule"><span className="block h-1.5 rounded bg-route" style={{ width: `${((i + 1) / list.length) * 100}%` }} /></span>
      </div>
    </div>
  );
}
const pathIs = (p: string) => p === "/";
