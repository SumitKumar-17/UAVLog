"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { api, type UploadJob } from "@/lib/api";

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Drop a PX4 .ulg file: it is validated, queued and run through the same pipeline stages as the batch logs, and the stages are shown as they finish. */
export function UploadView() {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [sent, setSent] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useQuery({ queryKey: ["upload", jobId], enabled: !!jobId, queryFn: () => api<UploadJob>(`/uploads/${jobId}`), refetchInterval: (q) => (q.state.data?.status === "running" ? 1200 : false) });

  const send = (file: File) => {
    setError(null); setJobId(null); setSent({ name: file.name, pct: 0 });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && setSent({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
    xhr.onload = () => {
      let body: { id?: string; detail?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.id) setJobId(body.id);
      else setError(typeof body.detail === "string" ? body.detail : `The upload failed (HTTP ${xhr.status}).`);
    };
    xhr.onerror = () => setError("The upload could not reach the server.");
    xhr.send(file);
  };
  const pick = (f?: File | null) => { if (f) send(f); };
  const active = jobId && job;

  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Upload a log</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Add a PX4 flight log (.ulg, up to 60 MB). It is checked, parsed into the telemetry table, its events are extracted and embedded, and its 10-second windows are embedded, using the same stages as the batch pipeline. Then it appears everywhere: flights, map, incidents and search.</p>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
        className={`mt-6 flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-route bg-rule-soft" : "border-rule bg-panel"}`}>
        <p className="font-dense text-xl font-semibold">Drop a .ulg file here</p>
        <p className="mt-1 text-sm text-ink-2">or</p>
        <button onClick={() => input.current?.click()} className="mt-2 h-10 rounded bg-route px-5 font-semibold text-on-route hover:opacity-90">Choose a file</button>
        <input ref={input} type="file" accept=".ulg" hidden onChange={(e) => pick(e.target.files?.[0])} aria-label="PX4 log file" />
        <p className="mt-3 text-xs text-muted">Logs are public data in this project's database; do not upload logs you are not allowed to share.</p>
      </div>
      {error && <p className="mt-4 rounded border border-critical bg-panel px-4 py-3 text-critical" role="alert">{error}</p>}
      {sent && !error && (
        <section className="mt-8 max-w-2xl" aria-labelledby="progress">
          <h2 id="progress" className="font-dense text-xl font-semibold">{sent.name}{job ? <span className="ml-2 text-sm font-normal text-ink-2">{mb(job.bytes)}</span> : null}</h2>
          <ol className="mt-3 divide-y divide-rule border-y border-rule">
            {(active ? job.stages : [{ name: "Upload", status: sent.pct >= 100 ? "done" : "running", seconds: null }]).map((s, i) => (
              <li key={s.name} className="flex items-center gap-3 py-2.5 text-[15px]">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.status === "done" ? "bg-good text-on-route" : s.status === "failed" ? "bg-critical text-on-route" : s.status === "running" ? "border-2 border-route text-route" : "border border-rule text-muted"}`} aria-hidden>
                  {s.status === "done" ? "✓" : s.status === "failed" ? "!" : i + 1}</span>
                <span className={s.status === "pending" ? "text-muted" : ""}>{s.name}</span>
                <span className="ml-auto text-sm tabular-nums text-ink-2">{s.status === "running" ? (i === 0 ? `${sent.pct}%` : "working") : s.seconds != null ? `${s.seconds} s` : ""}</span>
              </li>))}
          </ol>
          {job?.status === "failed" && <p className="mt-3 text-sm text-critical">{job.error}</p>}
          {job?.status === "done" && job.flight_id && (
            <div className="mt-4 flex items-center gap-3"><Link href={`/flights/${job.flight_id}`} className="rounded bg-route px-4 py-2 font-semibold text-on-route hover:opacity-90">Open the flight</Link><span className="text-sm text-ink-2">Added to the database.</span></div>)}
        </section>)}
    </div>
  );
}
