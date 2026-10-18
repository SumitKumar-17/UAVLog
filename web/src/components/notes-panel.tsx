"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Note } from "@/lib/api";
import { clock } from "@/lib/format";
import { useView } from "@/lib/store";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, init);
  if (!res.ok) throw new Error(await res.json().then((j) => j.detail).catch(() => res.statusText));
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Notes pinned to a moment of a flight. Selecting a note jumps the charts to it. */
export function NotesPanel({ flightId, duration }: { flightId: string; duration: number }) {
  const qc = useQueryClient();
  const key = ["notes", flightId];
  const { data } = useQuery({ queryKey: key, queryFn: () => call<Note[]>(`/flights/${flightId}/notes`) });
  const focus = useView((s) => s.focus);
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: (t: number) => call<Note>(`/flights/${flightId}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t_s: t, body: text.trim() }) }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: key }); },
  });
  const del = useMutation({ mutationFn: (id: number) => call<void>(`/notes/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const at = Math.min(focus?.t0 ?? 0, duration);
  const jump = (t: number) => { const { setFocus, setRange } = useView.getState(); setFocus({ t0: t, t1: t }); setRange([Math.max(0, t - 20), Math.min(duration, t + 20)]); };
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(at); }} className="flex max-w-2xl gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Note text" placeholder={`Note at ${clock(at)} (select an event or click the track to choose the moment)`}
          className="h-10 min-w-0 flex-1 rounded border border-rule bg-panel px-3 text-[15px] placeholder:text-muted focus:border-route" />
        <button disabled={add.isPending || !text.trim()} className="h-10 rounded bg-route px-4 font-semibold text-on-route hover:opacity-90 disabled:opacity-50">Add note</button>
      </form>
      {add.error && <p className="mt-2 text-critical">{(add.error as Error).message}</p>}
      {data && data.length === 0 && <p className="mt-3 text-ink-2">No notes yet. Notes stay with this flight and are shared with everyone who uses this database.</p>}
      <ul className="mt-3 max-w-2xl border-t border-rule">
        {data?.map((n) => (
          <li key={n.id} className="flex items-baseline gap-3 border-b border-rule py-2">
            <button onClick={() => jump(n.t_s)} className="font-dense text-sm tabular-nums text-route underline-offset-2 hover:underline">{clock(n.t_s)}</button>
            <span className="min-w-0 flex-1 break-words">{n.body}</span>
            <button onClick={() => del.mutate(n.id)} className="text-sm text-muted hover:text-critical" aria-label={`Delete the note at ${clock(n.t_s)}`}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
