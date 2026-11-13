"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** The pathname after mount: the server-rendered shell is shared between routes, so the active item is only marked on the client. */
function useClientPath() {
  const path = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? path : "";
}
import { api, type Stats } from "@/lib/api";
import { compact } from "@/lib/format";
import { ALL_PAGES, NAV, isActive } from "@/lib/nav";
import { Header } from "./header";
import { Icon } from "./icons";

function Brand({ small }: { small?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 whitespace-nowrap font-dense text-xl font-semibold tracking-tight text-ink" aria-label="UAV Log, home">
      <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden className="shrink-0"><path d="M2 14 L16 9 L2 4 L5 9 Z" fill="var(--route)" /></svg>
      {!small && "UAV Log"}
    </Link>
  );
}

function SideNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const path = useClientPath();
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats"), staleTime: 60_000 });
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className={`flex h-14 shrink-0 items-center border-b border-rule ${collapsed ? "justify-center" : "px-5"}`}><Brand small={collapsed} /></div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((g) => (
          <div key={g.label} className="mb-5">
            {!collapsed ? <div className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</div> : <div className="mx-3 mb-2 border-t border-rule" />}
            <ul className="space-y-0.5">
              {g.items.map((n) => {
                const on = isActive(n.href, path);
                return (
                  <li key={n.href}>
                    <Link href={n.href} onClick={onNavigate} aria-current={on ? "page" : undefined} title={collapsed ? n.label : n.hint}
                      className={`relative flex items-center gap-3 rounded-md py-2 text-[15px] ${collapsed ? "justify-center px-0" : "px-3"} ${on ? "bg-rule-soft font-semibold text-ink" : "text-ink-2 hover:bg-rule-soft hover:text-ink"}`}>
                      {on && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-route" aria-hidden />}
                      <Icon name={n.icon} />
                      {!collapsed && n.label}
                    </Link>
                  </li>);
              })}
            </ul>
          </div>))}
      </div>
      {!collapsed && stats.data && (
        <div className="shrink-0 border-t border-rule px-5 py-3 text-xs leading-relaxed text-ink-2">
          <div><b className="text-ink">{stats.data.flights}</b> flights, <b className="text-ink">{compact(stats.data.telemetry_rows)}</b> samples</div>
          <div><b className="text-ink">{compact(stats.data.events)}</b> events, {stats.data.concepts} concepts</div>
        </div>)}
    </nav>
  );
}

/** Vertical navigation on the left (collapsible, a drawer on phones) and a slim horizontal bar on top. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = useClientPath();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("nav") === "collapsed"); } catch {} }, []);
  useEffect(() => { setDrawer(false); }, [path]);
  const toggle = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("nav", n ? "collapsed" : "open"); } catch {} return n; });
  const page = ALL_PAGES.find((p) => isActive(p.href, path) && (p.href !== "/" || path === "/"));
  return (
    <div className="flex min-h-screen">
      <aside className={`sticky top-0 hidden h-screen shrink-0 border-r border-rule bg-panel transition-[width] duration-150 lg:block ${collapsed ? "w-[68px]" : "w-60"}`}><SideNav collapsed={collapsed} /></aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-rule bg-panel shadow-2xl"><SideNav collapsed={false} onNavigate={() => setDrawer(false)} /></aside>
        </div>)}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={page?.label} onMenu={() => setDrawer(true)} onToggleNav={toggle} navCollapsed={collapsed} />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-5 pb-16 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
