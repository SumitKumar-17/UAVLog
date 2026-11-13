"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlightDetail } from "@/lib/api";
import { clock, kindLabel } from "@/lib/format";
import { modeColor } from "@/lib/modes";
import { useView } from "@/lib/store";

const SPEEDS = [1, 4, 16, 64];

/** Plays the flight back: the time cursor moves across every chart and the track, the current flight mode is shown, and events surface as the cursor passes them. */
export function ReplayBar({ f }: { f: FlightDetail }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const marks = useMemo(() => f.events.filter((e) => e.severity >= 1).sort((a, b) => a.t_start - b.t_start), [f.events]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      tRef.current = Math.min(f.duration_s, tRef.current + 0.1 * speed);
      setT(tRef.current);
      useView.getState().setFocus({ t0: tRef.current, t1: tRef.current });
      if (tRef.current >= f.duration_s) setPlaying(false);
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, f.duration_s]);

  useEffect(() => { // space plays or pauses, the arrow keys step 5 seconds; ignored while typing in a field
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || e.ctrlKey || e.metaKey) return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const v = Math.min(f.duration_s, Math.max(0, tRef.current + (e.key === "ArrowRight" ? 5 : -5))); tRef.current = v; setT(v); useView.getState().setFocus({ t0: v, t1: v }); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [f.duration_s]);

  const seek = (v: number) => { tRef.current = v; setT(v); useView.getState().setFocus({ t0: v, t1: v }); };
  const mode = f.modes.find((m) => t >= m.t0 && t < m.t1)?.mode ?? f.modes[f.modes.length - 1]?.mode ?? "Other";
  const recent = marks.filter((e) => e.t_start <= t && t - e.t_start < 12 * Math.max(1, speed / 4)).slice(-3);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-rule bg-panel px-4 py-2.5" role="group" aria-label="Flight replay">
      <button onClick={() => { if (t >= f.duration_s) seek(0); setPlaying((p) => !p); }} className="h-9 w-24 rounded bg-route font-semibold text-on-route hover:opacity-90" aria-pressed={playing}>
        {playing ? "Pause" : t > 0 && t < f.duration_s ? "Resume" : "Replay"}
      </button>
      <input type="range" min={0} max={Math.floor(f.duration_s)} step={1} value={Math.floor(t)} onChange={(e) => seek(Number(e.target.value))} aria-label="Replay position" className="min-w-[10rem] flex-1 accent-[var(--route)]" />
      <span className="w-24 text-right text-[15px] font-semibold tabular-nums">{clock(t)} / {clock(f.duration_s)}</span>
      <label className="flex items-center gap-2 text-sm text-ink-2">Speed
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded border border-rule bg-panel px-1.5 py-1">{SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}</select>
      </label>
      <span className="flex items-center gap-2 text-sm"><span className="h-3 w-3 rounded-sm" style={{ background: modeColor(mode) }} />{mode}</span>
      <div className="basis-full text-sm" aria-live="polite">
        {recent.length === 0 ? <span className="text-muted">Events appear here as the replay passes them.</span> :
          recent.map((e) => <span key={e.id} className={`mr-4 ${e.severity >= 2 ? "text-critical" : "text-ink-2"}`}>{clock(e.t_start)} {kindLabel(e.kind)}: {e.description.slice(0, 80)}</span>)}
      </div>
    </div>
  );
}
