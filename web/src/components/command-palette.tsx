"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ALL_PAGES } from "@/lib/nav";

/** Ctrl+K (or Cmd+K): jump to any page, or turn what you typed into a search or a question. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Palette onClose={onClose} /> : null; // mounted only while open, so it always starts empty
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pages = ALL_PAGES.filter((p) => !s || p.label.toLowerCase().includes(s) || p.hint.includes(s)).map((p) => ({ label: p.label, hint: p.hint, go: p.href }));
    const text = q.trim();
    const actions = text.length >= 3 ? [
      { label: `Search events for "${text}"`, hint: "semantic search", go: `/search?q=${encodeURIComponent(text)}` },
      { label: `Ask: ${text}`, hint: "natural language to SQL", go: `/ask?q=${encodeURIComponent(text)}` },
    ] : [];
    return [...actions, ...pages];
  }, [q]);
  const choose = (n: number) => { const it = items[n]; if (it) { onClose(); router.push(it.go); } };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label="Jump to">
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-rule bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="Jump to a page, or type a question" aria-label="Jump to"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            else if (e.key === "Enter") choose(i);
          }}
          className="h-14 w-full border-b border-rule bg-transparent px-5 text-lg text-ink placeholder:text-muted focus:outline-none" />
        <ul className="max-h-[50vh] overflow-auto py-1" role="listbox">
          {items.map((it, n) => (
            <li key={it.go + it.label} role="option" aria-selected={n === i}>
              <button onClick={() => choose(n)} onMouseEnter={() => setI(n)} className={`flex w-full items-baseline justify-between gap-4 px-5 py-2.5 text-left ${n === i ? "bg-rule-soft" : ""}`}>
                <span className="truncate text-[16px] font-semibold text-ink">{it.label}</span><span className="shrink-0 text-sm text-muted">{it.hint}</span>
              </button>
            </li>))}
          {items.length === 0 && <li className="px-5 py-3 text-ink-2">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
