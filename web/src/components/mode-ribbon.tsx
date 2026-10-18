"use client";
import { useRef, useState } from "react";
import type { Mark, Segment } from "@/lib/api";
import { clock, kindLabel } from "@/lib/format";
import { modeColor } from "@/lib/modes";

type Props = { modes: Segment[]; marks?: Mark[]; duration: number; height?: number; label: string };
type Tip = { x: number; lines: string[] } | null;

const BUCKETS = 120;

// Cluster dense marks into buckets (worst severity wins) so a noisy flight stays readable.
function cluster(marks: Mark[], duration: number) {
  const out = new Map<number, { t: number; severity: number; n: number; first: Mark }>();
  for (const m of marks) {
    const b = Math.min(BUCKETS - 1, Math.floor((m.t / Math.max(duration, 1)) * BUCKETS));
    const cur = out.get(b);
    if (!cur) out.set(b, { t: m.t, severity: m.severity, n: 1, first: m });
    else {
      cur.n += 1;
      if (m.severity > cur.severity) { cur.severity = m.severity; cur.first = m; }
    }
  }
  return [...out.values()];
}

export function ModeRibbon({ modes, marks = [], duration, height = 16, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const dur = Math.max(duration, 1);
  const clusters = cluster(marks, dur);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = (x / r.width) * dur;
    const lines: string[] = [];
    const near = clusters.find((c) => Math.abs((c.t / dur) * r.width - x) < 6);
    if (near) lines.push(near.n > 1 ? `${near.n} events, worst: ${kindLabel(near.first.kind)}` : near.first.description);
    const seg = modes.find((s) => t >= s.t0 && t <= s.t1);
    lines.push(seg ? `${seg.mode} mode, ${clock(seg.t0)} to ${clock(seg.t1)}` : `${clock(t)}`);
    setTip({ x, lines });
  };

  return (
    <div ref={ref} className="relative w-full" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setTip(null)}>
      <div className="relative h-2.5">
        {clusters.map((c, i) =>
          c.severity >= 2 ? (
            <span key={i} className="absolute top-0 block h-2.5 w-2.5 -translate-x-1/2 bg-critical"
              style={{ left: `${(c.t / dur) * 100}%`, clipPath: "polygon(50% 100%, 0 0, 100% 0)" }} />
          ) : (
            <span key={i} className="absolute top-0.5 block h-2 w-0.5 -translate-x-1/2" style={{ left: `${(c.t / dur) * 100}%`, background: "var(--warning)" }} />
          ),
        )}
      </div>
      <div className="relative mt-0.5 overflow-hidden rounded-[2px]" style={{ height }}>
        {modes.length === 0 && <div className="absolute inset-0" style={{ background: "var(--m-other)", opacity: 0.4 }} />}
        {modes.map((s, i) => (
          <div key={i} className="absolute top-0 h-full" style={{
            left: `${(s.t0 / dur) * 100}%`, width: `${((s.t1 - s.t0) / dur) * 100}%`, background: modeColor(s.mode),
            borderRight: "2px solid var(--panel)",
          }} />
        ))}
      </div>
      {tip && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 rounded border border-rule bg-panel px-2 py-1 text-xs text-ink shadow-sm"
          style={{ left: Math.min(Math.max(tip.x, 90), (ref.current?.clientWidth ?? 400) - 90), top: -8, transform: "translate(-50%, -100%)" }}>
          {tip.lines.map((l, i) => <div key={i} className={i === 0 ? "font-semibold" : "text-ink-2"}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
