import Link from "next/link";
import { Icon } from "./icons";
import type { IconName } from "@/lib/nav";

const TILES: { href: string; title: string; text: string; icon: IconName }[] = [
  { href: "/map", title: "Map", text: "Where every flight happened, coloured by how many critical events it had.", icon: "map" },
  { href: "/fleet", title: "Fleet and galaxy", text: "Boards, firmware and a map of how flights behave; spot the odd ones out.", icon: "fleet" },
  { href: "/incidents", title: "Incidents", text: "Every warning and failure in one feed. Open one at the exact moment.", icon: "incidents" },
  { href: "/ask", title: "Ask in English", text: "Questions become guarded, read-only SQL with the evidence shown.", icon: "ask" },
  { href: "/workbench", title: "SQL workbench", text: "Write your own query under the same four safety checks.", icon: "workbench" },
  { href: "/data", title: "Data explorer", text: "The schema as a diagram, every table, every column, every row.", icon: "data" },
];

/** A row of entry points to the rest of the platform, shown under the search box on the overview. */
export function FeatureTiles() {
  return (
    <section aria-labelledby="tiles" className="mt-10">
      <h2 id="tiles" className="sr-only">Explore the platform</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TILES.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="group flex h-full gap-3.5 rounded-lg border border-rule bg-panel px-4 py-3.5 transition-colors hover:border-route">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-rule-soft text-ink-2 group-hover:text-route"><Icon name={t.icon} size={20} /></span>
              <span><span className="block font-dense text-lg font-semibold leading-tight">{t.title}</span><span className="mt-0.5 block text-sm text-ink-2">{t.text}</span></span>
            </Link>
          </li>))}
      </ul>
    </section>
  );
}
