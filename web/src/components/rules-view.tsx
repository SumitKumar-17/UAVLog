"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type LabResult, type LabRule, type LabScore } from "@/lib/api";

const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);

function Stat({ n, label, note }: { n: string; label: string; note?: string }) {
  return <div className="rounded border border-rule bg-panel px-4 py-3"><div className="font-dense text-3xl font-semibold tabular-nums">{n}</div><div className="text-sm text-ink-2">{label}</div>{note && <div className="mt-0.5 text-xs text-muted">{note}</div>}</div>;
}

/** Precision, recall and F1 against the threshold, with the chosen and the shipped threshold marked. */
function Curve({ rule, sweep, current, shipped }: { rule: LabRule; sweep: LabScore[]; current: number; shipped: number }) {
  const W = 760, H = 260, P = { l: 46, r: 14, t: 14, b: 40 };
  const X = (v: number) => P.l + ((v - rule.lo) / (rule.hi - rule.lo)) * (W - P.l - P.r), Y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const line = (k: "precision" | "recall" | "f1") => sweep.filter((s) => s[k] != null).map((s, i) => `${i ? "L" : "M"}${X(s.threshold).toFixed(1)},${Y(s[k] as number).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Precision and recall against the threshold">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" /><text x={P.l - 8} y={Y(v) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Math.round(v * 100)}%</text></g>)}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const v = rule.lo + f * (rule.hi - rule.lo); return <text key={f} x={X(v)} y={H - 20} fontSize={11} textAnchor="middle" fill="var(--muted)">{Number(v.toPrecision(3))}</text>; })}
      <text x={(P.l + W - P.r) / 2} y={H - 4} fontSize={12} textAnchor="middle" fill="var(--ink-2)">threshold ({rule.unit})</text>
      <line x1={X(shipped)} x2={X(shipped)} y1={P.t} y2={H - P.b} stroke="var(--ink-2)" strokeDasharray="4 4" /><text x={X(shipped) + 5} y={P.t + 11} fontSize={11} fill="var(--ink-2)">shipped</text>
      <line x1={X(current)} x2={X(current)} y1={P.t} y2={H - P.b} stroke="var(--route)" strokeWidth={2.5} />
      <path d={line("f1")} fill="none" stroke="var(--ink-2)" strokeWidth={1.8} strokeDasharray="2 4" />
      <path d={line("recall")} fill="none" stroke="var(--s2)" strokeWidth={2.6} />
      <path d={line("precision")} fill="none" stroke="var(--data)" strokeWidth={2.6} />
      {sweep.map((s) => s.precision != null && <circle key={`p${s.threshold}`} cx={X(s.threshold)} cy={Y(s.precision)} r={3.2} fill="var(--data)"><title>{s.threshold}: precision {pct(s.precision)}, {s.events} events</title></circle>)}
      {sweep.map((s) => s.recall != null && <circle key={`r${s.threshold}`} cx={X(s.threshold)} cy={Y(s.recall)} r={3.2} fill="var(--s2)"><title>{s.threshold}: recall {pct(s.recall)}</title></circle>)}
    </svg>
  );
}

/** Tune a detector's threshold and minimum duration and see, over every flight, how many events it raises and how well they agree with the autopilot's own warnings. */
export function RulesView() {
  const cfg = useQuery({ queryKey: ["rules-config"], queryFn: () => api<LabRule[]>("/rules/config") });
  const [id, setId] = useState("battery_low");
  const rule = cfg.data?.find((r) => r.id === id);
  const [thr, setThr] = useState<number | null>(null);
  const [minS, setMinS] = useState<number | null>(null);
  useEffect(() => { if (rule) { setThr(rule.threshold); setMinS(rule.min_s); } }, [rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = thr ?? rule?.threshold, m = minS ?? rule?.min_s;
  const { data, error, isFetching } = useQuery({
    queryKey: ["rules-eval", id, t, m], enabled: !!rule && t != null && m != null, placeholderData: (p) => p,
    queryFn: () => api<LabResult>("/rules/evaluate", { rule: id, threshold: t!, min_s: m! }),
  });
  const cur = data?.current, def = data?.default;
  const Row = ({ k, a, b }: { k: string; a: string; b: string }) => <tr className="border-t border-rule"><td className="py-1.5 pr-6 text-ink-2">{k}</td><td className="pr-6 tabular-nums">{a}</td><td className="tabular-nums">{b}</td></tr>;
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Rule lab</h1>
      <p className="mt-1 max-w-3xl text-ink-2">The event detectors are plain threshold rules. Move a threshold and the rule is re-run over every flight, then scored against the autopilot's own warnings: <b>precision</b> is the share of detected events that a warning backs up within a minute, <b>recall</b> the share of warnings the rule also caught.</p>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Rule">
        {cfg.data?.map((r) => <button key={r.id} onClick={() => setId(r.id)} aria-pressed={id === r.id} className={`rounded border px-3.5 py-1.5 text-[15px] ${id === r.id ? "border-route bg-route font-semibold text-on-route" : "border-rule text-ink-2 hover:border-route"}`}>{r.label}</button>)}
      </div>
      {rule && t != null && m != null && (
        <>
          <p className="mt-3 max-w-3xl text-sm text-ink-2">{rule.about} Signal <code>{rule.signal}</code> {rule.op} threshold.</p>
          <div className="mt-4 grid gap-x-10 gap-y-4 rounded border border-rule bg-panel p-4 sm:grid-cols-2">
            <label className="text-sm"><span className="flex justify-between"><span className="text-ink-2">Threshold</span><b className="tabular-nums">{t} {rule.unit}</b></span>
              <input type="range" min={rule.lo} max={rule.hi} step={rule.step} value={t} onChange={(e) => setThr(Number(e.target.value))} className="mt-1 w-full accent-[var(--route)]" aria-label="Threshold" /></label>
            <label className="text-sm"><span className="flex justify-between"><span className="text-ink-2">Minimum duration</span><b className="tabular-nums">{m} s</b></span>
              <input type="range" min={0} max={30} step={1} value={m} onChange={(e) => setMinS(Number(e.target.value))} className="mt-1 w-full accent-[var(--route)]" aria-label="Minimum duration" /></label>
          </div>
        </>)}
      {error && <p className="mt-4 text-critical">{(error as Error).message}</p>}
      {data && cur && def && rule && (
        <div className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat n={String(cur.events)} label="events detected" note={`in ${cur.flights} flights`} />
            <Stat n={pct(cur.precision)} label="precision" note={`${cur.matched_events} backed by a warning`} />
            <Stat n={pct(cur.recall)} label="recall" note={`${cur.matched_ref} of ${cur.ref_messages} warnings`} />
            <Stat n={pct(cur.f1)} label="F1" note="balance of the two" />
          </div>
          <section className="mt-8" aria-labelledby="curve"><h2 id="curve" className="font-dense text-xl font-semibold">Precision and recall across the range</h2>
            <p className="mb-2 mt-1 text-sm text-ink-2"><span className="inline-block h-0.5 w-5 align-middle" style={{ background: "var(--data)", height: 3 }} /> <b className="text-ink">precision</b>, <span className="inline-block h-0.5 w-5 align-middle" style={{ background: "var(--s2)", height: 3 }} /> <b className="text-ink">recall</b> and F1 (dotted) at this minimum duration; the pink line is your setting, the dashed line the shipped threshold.</p>
            <div className="rounded border border-rule bg-panel p-2"><Curve rule={rule} sweep={data.sweep} current={t!} shipped={rule.threshold} /></div></section>
          <table className="mt-6 text-sm"><thead><tr className="text-left text-muted"><th className="pb-1 pr-6 font-normal" /><th className="pr-6 font-normal">Your setting</th><th className="font-normal">Shipped ({rule.threshold} {rule.unit}, {rule.min_s} s)</th></tr></thead>
            <tbody><Row k="events" a={String(cur.events)} b={String(def.events)} /><Row k="flights with an event" a={String(cur.flights)} b={String(def.flights)} /><Row k="precision" a={pct(cur.precision)} b={pct(def.precision)} /><Row k="recall" a={pct(cur.recall)} b={pct(def.recall)} /></tbody></table>
          <p className="mt-6 max-w-3xl text-xs text-muted">Scored on one-second minimum and maximum values (the rule's own run uses every sample, so durations differ slightly). The warnings are the autopilot's log messages that mention {rule.ref.map((x) => x.replaceAll("%", "")).join(", ")}; they are a proxy for what truly happened, not a ground truth, so a high precision means agreement with the autopilot rather than correctness. Nothing is saved: the shipped thresholds are in <code>app/events/rules.py</code>.</p>
        </div>)}
    </div>
  );
}
