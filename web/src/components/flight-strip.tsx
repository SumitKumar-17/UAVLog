import Link from "next/link";
import type { FlightSummary } from "@/lib/api";
import { clock } from "@/lib/format";
import { ModeRibbon } from "./mode-ribbon";

export function FlightStrip({ f }: { f: FlightSummary }) {
  const modes = [...new Set(f.modes.map((m) => m.mode))].join(", ") || "no mode data";
  return (
    <Link href={`/flights/${f.id}`} className="group grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 border-b border-rule px-1 py-3 hover:bg-rule-soft max-sm:grid-cols-1">
      <div className="min-w-0">
        <div className="font-semibold text-ink">{f.source_ref.slice(0, 8)}</div>
        <div className="truncate font-dense text-sm text-muted">{f.hw ?? "unknown board"}</div>
      </div>
      <ModeRibbon modes={f.modes} marks={f.marks} duration={f.duration_s} label={`Flight modes for ${f.source_ref.slice(0, 8)}: ${modes}`} />
      <div className="text-right font-dense text-sm tabular-nums text-ink-2 max-sm:text-left">
        <div>{clock(f.duration_s)} flown</div>
        <div className="text-muted">{f.events} events{f.critical_events ? `, ${f.critical_events} critical` : ""}</div>
      </div>
    </Link>
  );
}
