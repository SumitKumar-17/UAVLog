"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { tourSteps, type Action, type Step } from "@/lib/tour-steps";

const STORE = "uavlog.tour.step", HIDE = "uavlog.tour.hidden", POS = "uavlog.tour.pos", MODE = "uavlog.tour.mode";
const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };

/** Resolve `css`, `css@N` (Nth match) or `text:phrase` (smallest visible element whose text contains it). */
function resolve(sel?: string): HTMLElement | null {
  if (!sel) return null;
  if (sel.includes(" || ")) { for (const part of sel.split(" || ")) { const r = resolve(part); if (r) return r; } return null; }
  try {
    if (sel.startsWith("text:")) {
      const phrase = sel.slice(5);
      let best: HTMLElement | null = null, bestLen = Infinity;
      document.querySelectorAll<HTMLElement>("button, a, summary, label, h1, h2, h3, h4, option, li, p, span, div, section").forEach((e) => {
        if (e.closest("[data-tour-card]") || !visible(e)) return;
        const t = (e.textContent ?? "").trim();
        if (t.includes(phrase) && t.length < bestLen) { best = e; bestLen = t.length; }
      });
      return best;
    }
    const m = sel.match(/^(.*)@(\d+)$/);
    const css = m ? m[1] : sel, n = m ? Number(m[2]) : 0;
    const all = Array.from(document.querySelectorAll<HTMLElement>(css)).filter((e) => !e.closest("[data-tour-card]") && visible(e));
    return all[n] ?? null;
  } catch { return null; }
}

function perform(a: Action | undefined, fallback?: HTMLElement | null) {
  if (!a) return;
  if (a.kind === "key") {
    const t = resolve(a.target) ?? (document.activeElement as HTMLElement) ?? document.body;
    for (const el of [t, document]) el.dispatchEvent(new KeyboardEvent("keydown", { key: a.key, bubbles: true }));
    return;
  }
  const el = resolve(a.target) ?? fallback;
  if (!el) return;
  if (a.kind === "click") { reveal(el); el.click(); return; }
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  input.focus();
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, a.value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (a.submit) setTimeout(() => {
    const form = input.closest("form");
    if (form) form.requestSubmit();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, 150);
}

/** Bring an element into view by scrolling only the real scroll container (scrollIntoView also moves clipped wrappers and shifts the shell). */
function reveal(el: HTMLElement) {
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== document.body) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 2) break;
    p = p.parentElement;
  }
  const box = !p || p === document.body ? { top: 0, height: window.innerHeight } : p.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const want = r.height > box.height * 0.7 ? box.top + 90 : box.top + (box.height - r.height) / 2;   // tall: show its top; otherwise centre it
  const delta = r.top - want;
  if (Math.abs(delta) < 8) return;
  if (!p || p === document.body) window.scrollBy({ top: delta, behavior: "smooth" });
  else p.scrollBy({ top: delta, behavior: "smooth" });
}

type Box = { x: number; y: number; w: number; h: number };

/** A guided walk through the whole application: each step spotlights one element, says what it is, and can click or type for you. */
export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [ids, setIds] = useState({ flight: "", flight2: "" });
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [notes, setNotes] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const acted = useRef(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);   // set by dragging the card; null = placed beside the target
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!open || ids.flight) return;
    api<{ id: string; critical_events: number }[]>("/flights", { limit: 60 }).then((d) => {
      const s = [...d].sort((a, b) => b.critical_events - a.critical_events);
      setIds({ flight: s[0]?.id ?? "", flight2: s[1]?.id ?? s[0]?.id ?? "" });
    }).catch(() => {});
  }, [open, ids.flight]);

  const [full, setFull] = useState(false);   // false: the 7-minute path; true: every step
  const all: Step[] = useMemo(() => tourSteps({ flight: ids.flight || "unknown", flight2: ids.flight2 || "unknown" }), [ids]);
  const list: Step[] = useMemo(() => (full ? all : all.filter((x) => x.quick)), [all, full]);
  const s = list[Math.min(i, list.length - 1)];
  const last = i === list.length - 1;
  const sections = useMemo(() => list.reduce<{ name: string; first: number }[]>((acc, st, k) => (acc.at(-1)?.name === st.section ? acc : [...acc, { name: st.section, first: k }]), []), [list]);

  useEffect(() => {
    if (!open) return;
    setI(0); setMenu(false); setNotes(false);
    try { setHidden(!!localStorage.getItem(HIDE)); const p = JSON.parse(localStorage.getItem(POS) || "null"); if (p && typeof p.x === "number") setPos(p); setFull(localStorage.getItem(MODE) === "full"); } catch {}
    try { const n = Number(localStorage.getItem(STORE)); if (n > 0) setI(n); } catch {}
  }, [open]);

  const toggleFull = () => { setFull((v) => { const nv = !v; try { localStorage.setItem(MODE, nv ? "full" : "quick"); } catch {} return nv; }); setI(0); try { localStorage.setItem(STORE, "0"); } catch {} };
  const go = useCallback((n: number) => {
    const k = Math.min(Math.max(n, 0), list.length - 1);
    setI(k); setMenu(false);
    try { localStorage.setItem(STORE, String(k)); } catch {}
  }, [list.length]);

  // enter a step: navigate if needed, then wait for the target, scroll to it and follow it
  useEffect(() => {
    if (!open || !ids.flight) return;
    let dead = false, timer = 0;
    target.current = null; acted.current = false; setBox(null);
    if (s.path) {
      const here = window.location.pathname + window.location.search;
      if (here !== s.path) router.push(s.path);
    }
    const t0 = Date.now() + (s.wait ?? 0);
    const find = () => {
      if (dead) return;
      const el = resolve(s.target);
      if (el) {
        target.current = el;
        reveal(el);
        if (s.auto && s.action) setTimeout(() => !dead && perform(s.action, el), 600);
        return;
      }
      if (!s.target || Date.now() - t0 > 25000) return;
      timer = window.setTimeout(find, 200);
    };
    timer = window.setTimeout(find, 350 + (s.wait ?? 0));
    return () => { dead = true; clearTimeout(timer); };
  }, [open, i, ids.flight]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the spotlight on the element while the page moves
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      let el = target.current;
      if (el && !el.isConnected) { el = resolve(s.target); target.current = el; }
      if (!el) { setBox((b) => (b ? null : b)); return; }
      const r = el.getBoundingClientRect();
      const nb = { x: r.left, y: r.top, w: r.width, h: r.height };
      setBox((b) => (b && Math.abs(b.x - nb.x) < 1 && Math.abs(b.y - nb.y) < 1 && Math.abs(b.w - nb.w) < 1 && Math.abs(b.h - nb.h) < 1 ? b : nb));
    }, 120);
    return () => clearInterval(id);
  }, [open, s.target]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || e.ctrlKey || e.metaKey) return;
      const act = () => { if (s.action) { perform(s.action, target.current); return true; } return false; };
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); last ? onClose() : go(i + 1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
      else if (e.key === "Enter") { e.preventDefault(); if (!acted.current && act()) acted.current = true; else { last ? onClose() : go(i + 1); } }
      else if (e.key === "d" || e.key === "D") act();
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
      else if (e.key === "h" || e.key === "H") setHidden((v) => { const nv = !v; try { localStorage.setItem(HIDE, nv ? "1" : ""); } catch {} return nv; });
      else if (e.key === "m" || e.key === "M") setMenu((v) => !v);
      else if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "Escape" && !document.querySelector('[role="dialog"][aria-label="Jump to"]')) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!open) return null;
  const pad = 6;
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth, vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const cw = Math.min(380, vw - 24);
  // card position: beside the target when there is room, else bottom-right
  let cardStyle: React.CSSProperties = { right: 20, bottom: 20 };
  const onScreen = !!box && box.y >= 0 && box.y + box.h <= vh && box.x + box.w > 0 && box.x < vw;
  if (box && !hidden && onScreen) {
    const spaceBelow = vh - (box.y + box.h), spaceAbove = box.y;
    const left = Math.min(Math.max(12, box.x), vw - cw - 12);
    if (spaceBelow > 230) cardStyle = { left, top: box.y + box.h + pad + 12 };
    else if (spaceAbove > 230) cardStyle = { left, bottom: vh - box.y + pad + 12 };
    else if (box.x + box.w + cw + 24 < vw) cardStyle = { left: box.x + box.w + 18, top: Math.min(Math.max(12, box.y), vh - 300) };
    else if (box.x > cw + 24) cardStyle = { left: box.x - cw - 18, top: Math.min(Math.max(12, box.y), vh - 300) };
  }

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos({ x: Math.min(Math.max(0, e.clientX - drag.current.dx), vw - 120), y: Math.min(Math.max(0, e.clientY - drag.current.dy), vh - 60) });
  };
  const onUp = () => { if (drag.current) { drag.current = null; try { localStorage.setItem(POS, JSON.stringify(pos)); } catch {} } };
  const resetPos = () => { setPos(null); try { localStorage.removeItem(POS); } catch {} };
  const placed: React.CSSProperties = pos ? { left: pos.x, top: pos.y } : cardStyle;

  return (
    <>
      {box && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-[55]">
          <div data-tour-spot className="absolute rounded-md transition-all duration-200" style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, boxShadow: "0 0 0 9999px rgba(10,14,22,0.42)", outline: "2px solid var(--color-route)", outlineOffset: 0 }} />
          {s.action && <div className="tour-pulse absolute rounded-md" style={{ left: box.x - pad - 4, top: box.y - pad - 4, width: box.w + pad * 2 + 8, height: box.h + pad * 2 + 8 }} />}
        </div>
      )}
      {!hidden ? (
        <div data-tour-card style={{ ...placed, width: cw, position: "fixed" }} className="z-[60] rounded-lg border border-route bg-panel p-4 shadow-2xl" role="dialog" aria-label="Guided tour">
          <div className="-mx-1 -mt-1 flex cursor-grab touch-none select-none items-baseline justify-between rounded px-1 pt-1 text-xs text-muted active:cursor-grabbing" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={resetPos} title="Drag to move this card; double-click to put it back">
            <button onClick={() => setMenu((v) => !v)} className="underline hover:text-ink" aria-expanded={menu}>{s.section} · step {i + 1} of {list.length}</button>
            <button onClick={onClose} className="underline hover:text-ink">End tour</button>
          </div>
          {menu ? (
            <ul className="mt-2 max-h-64 overflow-auto text-sm" aria-label="Tour sections">
              <li><button onClick={toggleFull} className="mb-1 w-full rounded border border-rule px-2 py-1 text-left hover:border-route">{full ? "Switch to the quick tour (about 7 minutes)" : `Switch to the full tour (${all.length} steps)`}</button></li>
              {sections.map((x) => (
                <li key={x.name}><button onClick={() => go(x.first)} className={`w-full rounded px-2 py-1 text-left hover:bg-rule/60 ${x.name === s.section ? "font-semibold text-route" : ""}`}>{x.name}</button></li>
              ))}
            </ul>
          ) : (
            <>
              <div className="mt-1 font-dense text-xl font-semibold">{s.title}</div>
              <p className="mt-1 text-[15px] leading-snug text-ink-2">{s.text}</p>
              {s.hint && <div className="mt-2 inline-block rounded bg-route/15 px-2 py-0.5 text-xs font-semibold text-route">{s.hint}</div>}
              {notes && s.say && <p className="mt-2 rounded border-l-2 border-route bg-rule/40 px-2 py-1.5 text-sm italic text-ink-2">Say: {s.say}</p>}
              {!box && s.target && <p className="mt-2 text-xs text-muted">Looking for the element on this page…</p>}
            </>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => go(i - 1)} disabled={i === 0} className="rounded border border-rule px-3 py-1.5 text-sm hover:border-route disabled:opacity-40">Back</button>
            <button onClick={() => (last ? onClose() : go(i + 1))} className="rounded bg-route px-4 py-1.5 text-sm font-semibold text-on-route hover:opacity-90">{last ? "Finish" : "Next"}</button>
            {s.action && <button onClick={() => { acted.current = true; perform(s.action, target.current); }} className="rounded border border-route px-3 py-1.5 text-sm font-semibold text-route hover:bg-route/10" title="Press D">Do it</button>}
            <span className="ml-auto flex gap-2 text-xs text-muted">
              {s.say && <button onClick={() => setNotes((v) => !v)} className="underline hover:text-ink" aria-pressed={notes} title="Press N">Notes</button>}
              <button onClick={() => setHidden(true)} className="underline hover:text-ink" title="Press H">Hide</button>
            </span>
          </div>
          <div className="mt-3 h-1.5 rounded bg-rule"><div className="h-1.5 rounded bg-route" style={{ width: `${((i + 1) / list.length) * 100}%` }} /></div>
          <div className="mt-2 text-[11px] text-muted">Enter: do it, then next · ← ↑ back · → ↓ next · drag the top to move · H hide · N notes · F full tour · Esc end</div>
        </div>
      ) : (
        <button data-tour-card onClick={() => setHidden(false)} className="fixed bottom-4 right-4 z-[60] rounded-full border border-route bg-panel px-3 py-1.5 text-xs font-semibold text-route opacity-0 shadow-lg hover:opacity-100 focus:opacity-100">Tour ({i + 1}/{list.length})</button>
      )}
    </>
  );
}
