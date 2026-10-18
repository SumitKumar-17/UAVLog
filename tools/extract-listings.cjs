// Write each excerpt in docs/figures/code-spec.json as plain text to docs/listings/<id>.txt (typeset by LaTeX with the listings package).
const fs = require("fs");
const spec = JSON.parse(fs.readFileSync("docs/figures/code-spec.json", "utf8"));
fs.mkdirSync("docs/listings", { recursive: true });
for (const it of spec) {
  if (!it.file) continue;
  const all = fs.readFileSync(it.file, "utf8").split("\n");
  const i = all.findIndex((l) => l.includes(it.start));
  if (i < 0) { console.log("!! " + it.id + ": start not found"); continue; }
  const chunk = all.slice(i, i + it.lines);
  while (chunk.length && !chunk[chunk.length - 1].trim()) chunk.pop();
  fs.writeFileSync(`docs/listings/${it.id}.txt`, chunk.join("\n") + "\n");
  console.log(it.id, i + 1, chunk.length, it.file);
}
