import type { IconName } from "@/lib/nav";

const P: Record<IconName, string> = {
  overview: "M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z",
  flights: "M3 12l18-8-6 16-3-7z",
  map: "M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  fleet: "M5 19V9M10 19V5M15 19v-7M20 19V8",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5",
  compare: "M4 6h9M4 12h16M4 18h12",
  ask: "M4 5h16v11H9l-5 4z",
  workbench: "M4 5h16v14H4zM8 10l3 2-3 2M13 15h3",
  ontology: "M12 5a2 2 0 100-4 2 2 0 000 4zM5 20a2 2 0 100-4 2 2 0 000 4zM19 20a2 2 0 100-4 2 2 0 000 4zM12 5v6M12 11l-6 5M12 11l6 5",
  data: "M3 4h18v16H3zM3 10h18M9 4v16",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  benchmarks: "M4 20h16M7 20V10M12 20V4M17 20v-7",
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name]} />
    </svg>
  );
}
