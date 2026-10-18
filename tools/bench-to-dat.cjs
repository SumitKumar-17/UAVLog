// Turn benchmark result JSON into plain data files for pgfplots: node tools/bench-to-dat.cjs  ->  docs/plots/*.dat
const fs = require("fs");
const R = "bench/results/", O = "docs/plots/";
fs.mkdirSync(O, { recursive: true });
const J = (f) => JSON.parse(fs.readFileSync(R + f, "utf8"));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const write = (name, header, rows) => fs.writeFileSync(O + name + ".dat", header.join(" ") + "\n" + rows.map((r) => r.join(" ")).join("\n") + "\n");

for (const f of ["ann_100000_sigma0.35.json", "ann_50000_sigma0.35.json", "ann_50000_sigma0.8.json"]) {
  const d = J(f), tag = f.replace(/^ann_|\.json$/g, "").replace(/[._]/g, "");
  for (const idx of Object.keys(d.builds)) {
    const pts = d.points.filter((p) => p.index === idx).sort((a, b) => a.recall - b.recall);
    write(`ann_${tag}_${slug(idx).slice(0, 24)}`, ["recall", "p50"], pts.map((p) => [p.recall.toFixed(4), p.p50_ms.toFixed(3)]));
  }
}
const f = J("filter_100000_sigma0.35.json");
const levels = ["0.01%", "0.1%", "1%", "10%", "50%"], pos = { "0.01%": 0, "0.1%": 1, "1%": 2, "10%": 3, "50%": 4 };
const series = { post40: "hnsw post-filter, ef_search=40", post400: "hnsw post-filter, ef_search=400", iter: "hnsw iterative relaxed, ef=40", btree: "b-tree filter + exact sort" };
for (const [k, s] of Object.entries(series)) {
  const rows = levels.map((l) => f.points.find((p) => p.strategy === s && p.family === "uncorrelated" && p.filter === l)).map((p, i) => p ? [i, p.rows_returned.toFixed(2), p.p50_ms.toFixed(2)] : null).filter(Boolean);
  write(`filter_${k}`, ["x", "rows", "p50"], rows);
}
const inj = J("injection_eval.json");
for (const fl of inj.faults) write(`inj_${slug(fl.fault).slice(0, 12)}`, ["dur", "rate"], inj.durations_s.map((d) => [d, (fl.by_duration[String(d)].detection_rate * 100).toFixed(1)]));
console.log(fs.readdirSync(O).join(" "));
