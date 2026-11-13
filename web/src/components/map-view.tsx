"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MlMap, GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import { api, type MapFlight } from "@/lib/api";
import { clock } from "@/lib/format";
import { useThemeVersion } from "@/lib/theme";

// Esri's light and dark grey canvas basemaps need no key and match the chart-paper look of the app.
const STYLE = (dark: boolean) => ({
  version: 8 as const,
  sources: { base: { type: "raster" as const, tileSize: 256, maxzoom: 16, attribution: "Tiles © Esri, HERE, Garmin, OpenStreetMap contributors",
    tiles: [`https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`] } },
  layers: [{ id: "background", type: "background" as const, paint: { "background-color": dark ? "#0f1a24" : "#e9eef2" } }, { id: "base", type: "raster" as const, source: "base" }],
});

/** Every flight with a GPS fix on a map; colour shows how many critical events it had, size shows how long it was. */
export function MapView() {
  const { data, error, isPending } = useQuery({ queryKey: ["map"], queryFn: () => api<MapFlight[]>("/map") });
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const theme = useThemeVersion();
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [board, setBoard] = useState("");
  const [sel, setSel] = useState<MapFlight | null>(null);

  const boards = useMemo(() => {
    const c = new Map<string, number>();
    (data ?? []).forEach((f) => c.set(f.hw ?? "unknown", (c.get(f.hw ?? "unknown") ?? 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const shown = useMemo(() => (data ?? []).filter((f) => (!onlyCritical || f.critical_events > 0) && (!board || (f.hw ?? "unknown") === board)), [data, onlyCritical, board]);
  const geo = useMemo(() => ({ type: "FeatureCollection" as const, features: shown.map((f) => ({
    type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [f.lon, f.lat] },
    properties: { id: f.id, crit: f.critical_events, mins: Math.min(60, f.duration_s / 60) } })) }), [shown]);

  useEffect(() => {
    if (!host.current || !data) return;
    let dead = false;
    import("maplibre-gl").then((ml) => {
      if (dead || !host.current) return;
      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // the bundler cannot locate the worker itself, so it is served from public/
      const dark = document.documentElement.dataset.theme === "dark";
      const map = new ml.Map({ container: host.current, style: STYLE(dark), center: [10, 30], zoom: 1.4, attributionControl: { compact: true }, canvasContextAttributes: { preserveDrawingBuffer: true } });
      mapRef.current = map;
      const ro = new ResizeObserver(() => map.resize());  // the container gets its final height after the first paint
      ro.observe(host.current);
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("style.load", () => {  // the style is ready; the dots do not wait for the basemap tiles
        map.addSource("flights", { type: "geojson", data: geo });
        map.addLayer({ id: "flights", type: "circle", source: "flights", paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "mins"], 0, 5, 15, 8, 60, 13],
          "circle-color": ["step", ["get", "crit"], "#2a78d6", 1, "#eda100", 3, "#d03b3b"],
          "circle-opacity": 0.85, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } });
        map.on("click", "flights", (e: MapLayerMouseEvent) => { const id = e.features?.[0]?.properties?.id; const f = data.find((x) => x.id === id); if (f) setSel(f); });
        map.on("mouseenter", "flights", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "flights", () => { map.getCanvas().style.cursor = ""; });
        const b = new ml.LngLatBounds();
        data.forEach((f) => b.extend([f.lon, f.lat]));
        if (!b.isEmpty()) map.fitBounds(b, { padding: 60, maxZoom: 6, duration: 0 });
      });
    });
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null; };
  }, [data, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // filters update the layer without rebuilding the map
    const m = mapRef.current;
    const src = m?.getSource("flights") as GeoJSONSource | undefined;
    src?.setData(geo);
  }, [geo]);

  if (error) return <p className="pt-10 text-critical">Could not load the map: {(error as Error).message}</p>;
  const crit = shown.filter((f) => f.critical_events > 0).length;
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Where the flights happened</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Every flight with a GPS fix, placed at its mean position. Colour shows how many critical events the flight had; larger dots are longer flights. Click a dot to open the flight.</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="space-y-5">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[[shown.length, "flights"], [new Set(shown.map((f) => f.hw)).size, "boards"], [crit, "with critical events"]].map(([n, l]) => (
              <div key={String(l)} className="rounded border border-rule bg-panel px-2 py-2.5"><dd className="font-dense text-2xl font-semibold tabular-nums">{n}</dd><dt className="text-xs text-ink-2">{l}</dt></div>))}
          </dl>
          <label className="block text-sm"><span className="mb-1 block text-ink-2">Board</span>
            <select value={board} onChange={(e) => setBoard(e.target.value)} className="h-10 w-full rounded border border-rule bg-panel px-2 text-[15px]">
              <option value="">All boards</option>{boards.map(([b, n]) => <option key={b} value={b}>{b} ({n})</option>)}</select></label>
          <label className="flex cursor-pointer items-center gap-2 text-[15px]"><input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} className="h-4 w-4 accent-[var(--route)]" />Only flights with critical events</label>
          <ul className="space-y-1.5 text-sm text-ink-2" aria-label="Legend">
            {[["#2a78d6", "no critical events"], ["#eda100", "1 or 2 critical events"], ["#d03b3b", "3 or more critical events"]].map(([c, l]) => (
              <li key={l} className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full border border-white" style={{ background: c }} />{l}</li>))}
          </ul>
          {sel ? (
            <div className="rounded border border-route bg-panel p-3">
              <div className="font-dense text-lg font-semibold">Flight {sel.source_ref.slice(0, 8)}</div>
              <div className="mt-1 text-sm text-ink-2">{sel.hw ?? "unknown board"} · {sel.firmware ?? "unknown firmware"}</div>
              <div className="text-sm text-ink-2">{new Date(sel.started_at).toISOString().slice(0, 10)} · {clock(sel.duration_s)} · {sel.events} events, {sel.critical_events} critical</div>
              <div className="mt-1 text-xs tabular-nums text-muted">{sel.lat.toFixed(3)}, {sel.lon.toFixed(3)}</div>
              <div className="mt-3 flex gap-2"><Link href={`/flights/${sel.id}`} className="rounded bg-route px-3 py-1.5 text-sm font-semibold text-on-route hover:opacity-90">Open flight</Link>
                <button onClick={() => setSel(null)} className="rounded border border-rule px-3 py-1.5 text-sm text-ink-2 hover:border-route">Close</button></div>
            </div>
          ) : <p className="text-sm text-muted">Select a dot to see the flight.</p>}
        </aside>
        <div className="relative overflow-hidden rounded border border-rule" style={{ height: "min(72vh, 680px)", minHeight: 420 }}>
          <div ref={host} className="h-full w-full" role="application" aria-label="Map of flights" />
          {isPending && <div className="absolute inset-0 flex items-center justify-center bg-panel text-ink-2" aria-busy>Loading the map</div>}
        </div>
      </div>
    </div>
  );
}
