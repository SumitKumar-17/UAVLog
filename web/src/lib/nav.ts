export type IconName = "overview" | "flights" | "map" | "fleet" | "search" | "compare" | "ask" | "workbench" | "ontology" | "data" | "database" | "benchmarks" | "incidents";
export type NavItem = { href: string; label: string; hint: string; icon: IconName };
export const NAV: { label: string; items: NavItem[] }[] = [
  { label: "Explore", items: [
    { href: "/", label: "Overview", hint: "flights ranked by critical events", icon: "overview" },
    { href: "/flights", label: "Flights", hint: "browse and filter every flight", icon: "flights" },
    { href: "/incidents", label: "Incidents", hint: "warnings and failures across every flight", icon: "incidents" },
    { href: "/map", label: "Map", hint: "where the flights happened", icon: "map" },
    { href: "/fleet", label: "Fleet", hint: "boards, firmware, the flight galaxy", icon: "fleet" } ] },
  { label: "Analyze", items: [
    { href: "/search", label: "Search", hint: "find events by meaning", icon: "search" },
    { href: "/compare", label: "Compare", hint: "two flights on one axis", icon: "compare" },
    { href: "/ask", label: "Ask", hint: "questions in plain English", icon: "ask" },
    { href: "/workbench", label: "SQL workbench", hint: "guarded read-only SQL", icon: "workbench" } ] },
  { label: "Platform", items: [
    { href: "/ontology", label: "Ontology", hint: "concepts and vendor mappings", icon: "ontology" },
    { href: "/data", label: "Data explorer", hint: "tables, structure, relations", icon: "data" },
    { href: "/database", label: "Database", hint: "storage, plans, pipeline", icon: "database" },
    { href: "/benchmarks", label: "Benchmarks", hint: "every experiment", icon: "benchmarks" } ] },
];
export const ALL_PAGES = NAV.flatMap((g) => g.items);
export const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));
