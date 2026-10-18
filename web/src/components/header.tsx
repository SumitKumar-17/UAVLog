"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/flights", label: "Flights" },
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/database", label: "Database" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const saved = document.documentElement.dataset.theme as "light" | "dark" | undefined;
    setTheme(saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  };
  return (
    <button onClick={flip} className="rounded px-2.5 py-1 text-sm text-ink-2 hover:bg-rule-soft" aria-label="Switch colour theme">
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

export function Header() {
  const path = usePathname();
  return (
    <header className="border-b border-rule bg-panel">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2 sm:h-14 sm:flex-nowrap sm:gap-x-8 sm:px-8 sm:py-0">
        <Link href="/" className="order-1 flex items-center gap-2 whitespace-nowrap font-dense text-lg font-semibold tracking-tight text-ink">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d="M2 14 L16 9 L2 4 L5 9 Z" fill="var(--route)" /></svg>
          UAV Log
        </Link>
        <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-2 sm:mx-0 sm:w-auto" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-[15px] ${active ? "bg-rule-soft font-semibold text-ink" : "text-ink-2 hover:bg-rule-soft"}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="order-2 ml-auto sm:order-3"><ThemeToggle /></div>
      </div>
    </header>
  );
}
