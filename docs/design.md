# Interface design

## Idea: chart paper and the flight strip
Air-traffic controllers read flight strips; flight-data analysts shade charts by flight mode. Every flight in the app
is a **strip**: a ribbon of flight modes with event marks. The same ribbon is the shaded background behind every chart on
the flight page, so the whole product reads as one instrument. That is the one loud element; everything else is quiet.

## Tokens
| Role | Light | Dark |
|---|---|---|
| paper / panel | `#e9eef2` / `#f7f9fa` | `#0f1a24` / `#162331` |
| ink / secondary / muted | `#12202c` / `#45586a` / `#596b7c` | `#e6edf3` / `#aebdcb` / `#8a9cae` |
| route (selection, time cursor) | `#b0136f` | `#ec6fb7` |
| data blue | `#2a78d6` | `#3987e5` |
| severity | critical `#d03b3b`, warning `#fab219`, always with a shape and a word | same |

Dark mode is a separately selected set, not an inversion. Route-magenta is reserved for selection and the time cursor, the way a
route is drawn on an aeronautical chart. Type is Barlow (a DIN-descended grotesk, the lineage of aviation signage) with Barlow
Semi Condensed for dense text; sentence case, proportional figures, tabular figures only in columns.

## Flight modes use a validated categorical palette
Eight fixed mode-to-colour assignments (Position, Manual, Altitude, Hold, Stabilized, Land, Mission, Return; everything else neutral).
Checked with the dataviz validator on our own surfaces: light `#f7f9fa` and dark `#162331` both pass lightness band, chroma floor,
adjacent-pair CVD separation (worst 9.1 light, 8.4 dark) and the normal-vision floor (19.6 and 19.3). Three light colours are
below 3:1 against the surface, which obliges visible labels: every strip has a legend, a hover readout and a text equivalent.

## Chart rules we hold to
- One axis per chart. Signals share a chart only if they share a unit and scale (attitude roll and pitch, motor outputs, estimator ratios).
- Min/max **envelopes** per bucket, computed in the database, with the mean as the line. Decimation would hide the spikes that
  matter in safety signals.
- Shared crosshair across charts; drag to zoom, double-click to reset; a table view per chart (lowest, mean, highest over the window).
- The overview ribbon shows where the zoom window sits. Refetching keeps the previous frame at reduced opacity, with no skeleton flash.
- Colour is never alone: severity has a shape (triangle for critical, tick for warning) and a word.

## Honesty in the interface
- Search shows no relevance percentage, because cosine distances do not separate relevant from irrelevant (decision D13). It collapses
  identical events and offers "Show how results were ranked" instead.
- The Database page reads everything live (compression ratio, index sizes, queue state, `EXPLAIN ANALYZE` of named queries).

## Verified how
`./bin/shot <path> <name> [light|dark] [width]` screenshots any page in Docker (Playwright), prints console errors and
reports horizontal overflow with the elements causing it. Found and fixed: header overflow and a table overflow at 390 px,
a blocking-prerender error from `usePathname()` in the root layout, and misleading idle legend text ("no data").

## Later additions
- **Ground track** (flight page): local metres, north up, coloured by flight mode with the same fixed mode colours; start is an open circle, end a square,
  critical events are triangles; clicking jumps every chart to that moment. Shape carries meaning so colour is never alone.
- **Compare**: two flights on one axis with two categorical hues (slots 1 and 2), a legend and per-point tooltips; alignment at takeoff is a switch because
  most differences in timing are the pilot's, not the aircraft's.
- **Ontology**: one column per concept kind, so kind is encoded by position and a column title, with a hue per column as a secondary cue; hover or focus a node
  to fade everything it is not connected to; a plain relations table is the alternative for keyboard and screen-reader use.
- **Notes** are plain text, at most 500 characters, pinned to a moment, and selecting one jumps the charts there.
