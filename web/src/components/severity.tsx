// Severity is never colour alone: shape + word accompany the colour.
export function Severity({ level }: { level: number }) {
  if (level >= 2)
    return <span className="inline-flex items-center gap-1.5 text-sm text-ink-2"><span className="h-2.5 w-2.5 bg-critical" style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }} />Critical</span>;
  if (level === 1)
    return <span className="inline-flex items-center gap-1.5 text-sm text-ink-2"><span className="h-2.5 w-0.5" style={{ background: "var(--warning)" }} /><span className="-ml-0.5" />Warning</span>;
  return <span className="inline-flex items-center gap-1.5 text-sm text-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--m-other)" }} />Info</span>;
}
