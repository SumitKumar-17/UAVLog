import { LEGEND_MODES, modeColor } from "@/lib/modes";

export function ModeLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-2" aria-label="Legend">
      {LEGEND_MODES.map((m) => (
        <li key={m} className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[2px]" style={{ background: modeColor(m) }} />{m}
        </li>
      ))}
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px]" style={{ background: "var(--m-other)" }} />Other</li>
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-critical" style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }} />Critical event</li>
      <li className="flex items-center gap-1.5"><span className="h-2 w-0.5" style={{ background: "var(--warning)" }} />Warning</li>
    </ul>
  );
}
