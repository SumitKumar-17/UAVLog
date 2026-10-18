"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const EXAMPLES = ["one rotor stopped working", "GPS signal dropped out", "the frame is shaking", "pilot lost radio contact", "running out of power"];

export function SearchBox({ initial = "", autoFocus = false }: { initial?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const go = (text: string) => text.trim() && router.push(`/search?q=${encodeURIComponent(text.trim())}`);
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); go(q); }} role="search" className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} aria-label="Describe what you are looking for"
          placeholder="Describe what happened, in your own words"
          className="h-12 min-w-0 flex-1 rounded border border-rule bg-panel px-4 text-lg text-ink placeholder:text-muted focus:border-route" />
        <button className="h-12 rounded bg-route px-6 text-base font-semibold text-on-route hover:opacity-90">Search</button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {EXAMPLES.map((x) => (
          <button key={x} onClick={() => { setQ(x); go(x); }} className="rounded border border-rule px-3 py-1 text-ink-2 hover:border-route hover:text-ink">{x}</button>
        ))}
      </div>
    </div>
  );
}
