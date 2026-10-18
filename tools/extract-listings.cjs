// Write each excerpt in docs/figures/code-spec.json as plain text to docs/listings/<id>.txt (typeset by LaTeX with the listings package).
const fs = require("fs");
const spec = JSON.parse(fs.readFileSync("docs/figures/code-spec.json", "utf8"));
fs.mkdirSync("docs/listings", { recursive: true });
const ascii = (t) => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2192/g, "->").replace(/\u2264/g, "<=").replace(/\u2265/g, ">=").replace(/\u00d7/g, "x").replace(/[^\x09\x0a\x20-\x7e]/g, "?");
for (const it of spec) {
  if (!it.file) continue;
  const all = fs.readFileSync(it.file, "utf8").split("\n");
  const i = all.findIndex((l) => l.includes(it.start));
  if (i < 0) { console.log("!! " + it.id + ": start not found"); continue; }
  const chunk = all.slice(i, i + it.lines);
  while (chunk.length && !chunk[chunk.length - 1].trim()) chunk.pop();
  fs.writeFileSync(`docs/listings/${it.id}.txt`, ascii(chunk.join("\n")) + "\n");
  console.log(it.id, i + 1, chunk.length, it.file);
}

// terminal captures: ASCII, lines trimmed to 112 characters
for (const f of fs.readdirSync("docs/figures/text").filter((x) => x.startsWith("term-"))) {
  const lines = ascii(fs.readFileSync("docs/figures/text/" + f, "utf8")).split("\n").map((l) => (l.length > 112 ? l.slice(0, 109) + "..." : l.replace(/\s+$/, "")));
  fs.writeFileSync("docs/listings/" + f, lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n");
}
