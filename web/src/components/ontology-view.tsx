"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type Ontology } from "@/lib/api";
import { kindLabel } from "@/lib/format";

const COLS = [
  { kind: "subsystem", title: "Subsystems", x: 20, color: "var(--s3)" },
  { kind: "signal", title: "Signals", x: 270, color: "var(--s1)" },
  { kind: "failure_mode", title: "Failure modes", x: 560, color: "var(--s2)" },
  { kind: "event", title: "Event kinds", x: 800, color: "var(--s5)" },
] as const;
const ROW = 22, TOP = 40, W = 1000;

/** The semantic layer as a diagram: signals belong to subsystems and indicate failure modes; event kinds indicate failure modes too. */
export function OntologyView() {
  const { data } = useQuery({ queryKey: ["ontology"], queryFn: () => api<Ontology>("/ontology") });
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const focus = pinned ?? active;

  const layout = useMemo(() => {
    if (!data) return null;
    const byKind = Object.fromEntries(COLS.map((c) => [c.kind, data.concepts.filter((n) => n.kind === c.kind)]));
    const height = TOP + Math.max(...Object.values(byKind).map((l) => l.length)) * ROW + 20;
    const pos: Record<string, { x: number; y: number; kind: string }> = {};
    COLS.forEach((c) => {
      const list = byKind[c.kind], gap = c.kind === "signal" ? ROW : (height - TOP - 20) / Math.max(list.length, 1);
      list.forEach((n, i) => { pos[n.key] = { x: c.x, y: TOP + i * gap + ROW / 2, kind: c.kind }; });
    });
    return { byKind, pos, height };
  }, [data]);
  if (!data || !layout) return <div className="pt-10 text-ink-2" aria-busy>Loading</div>;

  const edges = data.relations.filter((r) => layout.pos[r.src] && layout.pos[r.dst]);
  const linked = (k: string) => new Set(edges.filter((e) => e.src === k || e.dst === k).flatMap((e) => [e.src, e.dst]));
  const lit = focus ? linked(focus) : null;
  const on = (k: string) => !focus || k === focus || lit!.has(k);
  const node = data.concepts.find((c) => c.key === focus);
  const rel = focus ? edges.filter((e) => e.src === focus || e.dst === focus) : [];
  const nameOf = (k: string) => data.concepts.find((c) => c.key === k)?.label ?? k;

  return (
    <div className="pt-10">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Ontology</h1>
      <p className="mb-5 mt-1 max-w-3xl text-ink-2">The vocabulary that sits between each autopilot&apos;s field names and the questions people ask. A signal belongs to a subsystem and can indicate a failure mode; event kinds indicate failure modes too. Hover or focus a node to see what it connects to, click to keep it selected.</p>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${layout.height}`} className="min-w-[900px] w-full" role="img" aria-label="Diagram of subsystems, signals, failure modes and event kinds and how they relate">
          {COLS.map((c) => <text key={c.kind} x={c.x} y={22} fontSize={15} fontWeight={600} fill="var(--ink)">{c.title}</text>)}
          {edges.map((e, i) => {
            const a = layout.pos[e.src], b = layout.pos[e.dst];
            const [from, to] = a.x < b.x ? [a, b] : [b, a];
            const x1 = from.x + (from.kind === "signal" ? 205 : from.kind === "subsystem" ? 110 : 150), x2 = to.x - 8, mid = (x1 + x2) / 2;
            const hot = !!focus && (e.src === focus || e.dst === focus);
            return <path key={i} d={`M${x1},${from.y} C${mid},${from.y} ${mid},${to.y} ${x2},${to.y}`} fill="none" stroke={hot ? "var(--route)" : "var(--ink-2)"} strokeWidth={hot ? 2.5 : 1} opacity={focus ? (hot ? 1 : 0.07) : 0.28} />;
          })}
          {data.concepts.filter((c) => layout.pos[c.key]).map((c) => {
            const p = layout.pos[c.key], col = COLS.find((x) => x.kind === c.kind)!;
            return (
              <g key={c.key} opacity={on(c.key) ? 1 : 0.25} tabIndex={0} role="button" aria-pressed={pinned === c.key} aria-label={`${c.label}, ${kindLabel(c.kind)}`} className="cursor-pointer outline-none"
                onPointerEnter={() => setActive(c.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(c.key)} onBlur={() => setActive(null)}
                onClick={() => setPinned(pinned === c.key ? null : c.key)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPinned(pinned === c.key ? null : c.key))}>
                <rect x={p.x - 8} y={p.y - ROW / 2 + 1} width={c.kind === "signal" ? 213 : c.kind === "subsystem" ? 118 : 158} height={ROW - 2} rx={3} fill="transparent" stroke={focus === c.key ? "var(--route)" : "none"} strokeWidth={2} />
                <circle cx={p.x} cy={p.y} r={4.5} fill={col.color} stroke="var(--panel)" strokeWidth={2} />
                <text x={p.x + 10} y={p.y + 4} fontSize={12.5} fill="var(--ink)">{c.kind === "signal" ? c.key : kindLabel(c.key)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-4 min-h-[5rem] max-w-3xl border-l-2 border-route pl-4 text-[15px]">
        {node ? (
          <>
            <div className="font-semibold">{node.label} <span className="font-normal text-ink-2">({kindLabel(node.kind)}{node.unit ? `, ${node.unit}` : ""})</span></div>
            {node.description && <p className="text-ink-2">{node.description}</p>}
            <ul className="mt-1 text-ink-2">{rel.map((e, i) => <li key={i}>{nameOf(e.src)} <span className="text-muted">{e.rel.replace("_", " ")}</span> {nameOf(e.dst)}</li>)}</ul>
          </>
        ) : <p className="text-ink-2">Select a node for its description and relations.</p>}
      </div>
      <details className="mt-6 max-w-3xl text-[15px] text-ink-2">
        <summary className="cursor-pointer">All relations as a table</summary>
        <div className="mt-2 overflow-x-auto"><table className="tabular-nums"><thead><tr className="text-left text-muted"><th className="pr-6 font-normal">From</th><th className="pr-6 font-normal">Relation</th><th className="font-normal">To</th></tr></thead>
          <tbody>{edges.map((e, i) => <tr key={i} className="border-t border-rule"><td className="py-1 pr-6">{e.src}</td><td className="pr-6">{e.rel.replace("_", " ")}</td><td>{e.dst}</td></tr>)}</tbody></table></div>
      </details>
    </div>
  );
}
