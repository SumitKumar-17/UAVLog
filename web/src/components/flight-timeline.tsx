"use client";
import type { FlightDetail } from "@/lib/api";
import { clock } from "@/lib/format";
import { useView } from "@/lib/store";
import { ModeLegend } from "./mode-legend";
import { ModeRibbon } from "./mode-ribbon";
import { AXIS_W } from "./signal-chart";

/** Overview of the whole flight; the outlined window shows what the charts below are zoomed to. */
export function FlightTimeline({ f }: { f: FlightDetail }) {
  const range = useView((s) => s.range);
  const reset = useView((s) => s.reset);
  const marks = f.events.filter((e) => e.severity >= 1).map((e) => ({ t: e.t_start, severity: e.severity, kind: e.kind, description: e.description }));
  return (
    <div>
      <div style={{ paddingLeft: AXIS_W, paddingRight: 10 }}>
        <div className="relative">
          <ModeRibbon modes={f.modes} marks={marks} duration={f.duration_s} height={26} label={`Flight modes over ${clock(f.duration_s)}`} />
          {range && (
            <div className="pointer-events-none absolute bottom-0 h-[26px] border-2 border-route" style={{
              left: `${(range[0] / f.duration_s) * 100}%`, width: `${Math.max(((range[1] - range[0]) / f.duration_s) * 100, 0.6)}%`,
            }} />
          )}
        </div>
        <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-muted">
          <span>0:00</span>
          <span className="text-ink-2">{range ? `Showing ${clock(range[0])} to ${clock(range[1])}. ` : "Drag across any chart to zoom, double-click to reset. "}
            {range && <button onClick={reset} className="underline hover:text-ink">Show whole flight</button>}</span>
          <span>{clock(f.duration_s)}</span>
        </div>
      </div>
      <div className="mt-3" style={{ paddingLeft: AXIS_W }}><ModeLegend /></div>
    </div>
  );
}
