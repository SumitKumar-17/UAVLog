export type Action =
  | { kind: "click"; target: string }
  | { kind: "fill"; target: string; value: string; submit?: boolean }
  | { kind: "key"; key: string; target?: string };

export type Step = {
  quick?: boolean;          // part of the 7-minute path (the full tour has every step)
  section: string;
  path?: string;            // route (with query) to be on; the tour navigates there when needed
  target?: string;          // CSS selector, `text:substring` (a visible element whose text contains it) or `selector@N` (the Nth match)
  title: string;
  text: string;             // what to look at
  say?: string;             // what to say out loud (presenter notes)
  hint?: string;            // short instruction shown as a badge: "Click here", "Type this", "Hover a cell"
  action?: Action;          // performed by the "Do it" button (or the D key); also pulses the target
  auto?: boolean;           // run the action by itself shortly after the step opens
  wait?: number;            // milliseconds to wait after the step opens before looking for the target
};

type Ctx = { flight: string; flight2: string };

/** The whole video as steps: every page, several things on each, what to click and what to say. */
export function tourSteps({ flight: F, flight2: G }: Ctx): Step[] {
  const flight = `/flights/${F}`;
  return [
    // ------------------------------------------------------------------------------------------------ overview
    { quick: true, section: "Overview", path: "/", title: "A database problem", text: "UAV flight logs: 300 real PX4 flights, 70.7 million telemetry samples and over three thousand text events, all in one PostgreSQL.",
      say: "A drone writes a log on every flight. I treated the whole collection as a database problem: seventy million samples, three thousand events and two autopilots' vocabularies, in one PostgreSQL." },
    { section: "Overview", path: "/", target: 'nav[aria-label="Main"]', title: "Every page is here", text: "The vertical bar lists every page in three groups: Explore, Analyze and Platform. It collapses with the button in the top bar.",
      say: "Navigation is a vertical bar: Explore the flights, Analyze them, and Platform for the database itself." },
    { section: "Overview", path: "/", target: 'input[aria-label="Describe what you are looking for"]', title: "Search by meaning", text: "Type what happened in your own words. This searches the text of the events by meaning, not by exact words.", hint: "Type this",
      action: { kind: "fill", target: 'input[aria-label="Describe what you are looking for"]', value: "one rotor stopped working" },
      say: "I type what happened in plain words. Search works on the meaning of the event text, using vector embeddings." },
    { section: "Overview", path: "/", target: 'section[aria-labelledby="tiles"]', title: "Entry points", text: "Six shortcuts to the main features, each with a one-line description.", say: "These tiles lead to the map, the fleet views, incidents, Ask, the SQL workbench and the data explorer." },
    { section: "Overview", path: "/", target: "#pulse", title: "Fleet pulse", text: "Four live charts from SQL: flights per year, critical events per flight by board, the commonest events and flight length.", hint: "Click a chart for the full view",
      say: "The fleet pulse is four small queries over the whole corpus, so you see its shape in one glance." },
    { section: "Overview", path: "/", target: 'section[aria-labelledby="board"]', title: "Flights ranked by critical events", text: "Each strip is a flight: colour is the flight mode over time, red triangles are critical events, yellow ticks are warnings.",
      say: "Each strip is one flight. Colour is the flight mode through time and the red marks are critical events." },
    { quick: true, section: "Overview", path: "/", target: 'button[aria-label="Jump to a page or ask a question"]', title: "Ctrl+K", text: "The command palette jumps to any page, and turns what you type into a search or a question.", hint: "Click here", action: { kind: "click", target: 'button[aria-label="Jump to a page or ask a question"]' },
      say: "Control K opens a palette. It jumps to any page, and it also searches the events as you type." },
    { quick: true, section: "Overview", path: "/", target: 'input[aria-label="Jump to"]', title: "Type into the palette", text: "Type a few words, for example battery low.", hint: "Type this",
      action: { kind: "fill", target: 'input[aria-label="Jump to"]', value: "battery low" }, wait: 500,
      say: "I type battery low." },
    { quick: true, section: "Overview", path: "/", target: '[role="dialog"]:has(input[aria-label="Jump to"]) > div', title: "Result: matching events", text: "The palette ran the hybrid search while you typed. Each row is a real event with its flight and time; Enter opens the flight at that moment. The first two rows turn the words into a full search or a question.",
      say: "As I type, the matching events appear, each linking to the exact moment in a flight." },
    { quick: true, section: "Overview", path: "/", target: 'input[aria-label="Jump to"]', title: "Close the palette", text: "Press Escape to close it.", hint: "Press Esc", action: { kind: "key", key: "Escape", target: 'input[aria-label="Jump to"]' }, say: "Escape closes it." },
    { section: "Overview", path: "/", target: 'button[aria-label="Switch colour theme"]', title: "Light by default", text: "Light is the default on every system. Dark is a toggle in the top bar and is remembered; the charts, map and diagrams switch with it.", say: "Light is the default whatever the system setting; dark is one click, and everything redraws." },

    // ------------------------------------------------------------------------------------------------ flights list
    { section: "Flights", path: "/flights", target: 'main h1', title: "All flights", text: "Every flight in the corpus as a strip of flight modes with its events.", say: "The flights page lists every flight as a strip." },
    { section: "Flights", path: "/flights", target: '[aria-label="Order flights by"]', title: "Order and filter", text: "Order by critical events, most recent or longest; the filters narrow by board and firmware.", hint: "Try an order",
      say: "I can order by critical events, recency or length." },

    // ------------------------------------------------------------------------------------------------ one flight
    { quick: true, section: "One flight", path: flight, target: "main h1", title: "One flight", text: "Board, firmware, duration and the pilot's notes from the original log, then everything the database knows about this flight.", say: "This is one flight: a CZI board, twelve minutes fifty-four, and the parachute was used." },
    { section: "One flight", path: flight, target: 'nav[aria-label="Sections of this flight"]', title: "Jump within the page", text: "Chips jump to the signals, the incident report, similar moments, relationships, notes and similar flights.", say: "The chips jump to each section of the page." },
    { quick: true, section: "One flight", path: flight, target: '[aria-label^="Flight modes over"]', title: "Flight modes and events", text: "The ribbon is the flight mode through time. Red triangles are critical events and yellow ticks are warnings. Drag across any chart to zoom this window.", hint: "Hover the marks",
      say: "The ribbon is the mode through time and the marks are events; the outlined window shows what the charts are zoomed to." },
    { quick: true, section: "One flight", path: flight, target: "text:Behaviour", title: "Behaviour strip", text: "Each 10 seconds of this flight compared with the same moments in every other flight: blue is typical, red is unusual. One vector search per window.",
      say: "Every ten seconds are compared with their five nearest windows in all other flights, one vector search each, and shown as a percentile. Red means unlike anything else." },
    { quick: true, section: "One flight", path: flight, target: "text:(top", title: "Click the most unusual moment", text: "The most unusual windows are listed under the strip. Clicking one jumps every chart to it and explains it.", hint: "Click here", action: { kind: "click", target: "text:(top" },
      say: "I click the most unusual moment and the charts jump to it." },
    { quick: true, section: "One flight", path: flight, target: "text:is unusual", title: "Why it is unusual", text: "The signal statistics furthest from the typical flight, in units of the typical spread: here the pitch and the position are changing in a way no normal flight does.", wait: 700,
      say: "The panel says why: these statistics are far from the corpus' typical value, for example a pitch of minus twenty-nine degrees." },
    { quick: true, section: "One flight", path: flight, target: '[aria-label="Flight replay"]', title: "Replay the flight", text: "Press Replay: the time cursor sweeps every chart and the track, and events surface as it passes them. Space plays and pauses; the arrows step 5 seconds.", hint: "Click Replay", action: { kind: "click", target: '[aria-label="Flight replay"] button' },
      say: "Replay plays the flight back at sixteen times speed; every chart and the track follow the cursor." },
    { section: "One flight", path: flight, target: '#signals', title: "Synchronized charts", text: "Charts share one time axis. Server-side downsampling keeps minimum and maximum envelopes, so a short spike can never be averaged away. Drag across a chart to zoom all of them; double-click to reset.", hint: "Drag across a chart",
      say: "Charts are synchronized and use min and max envelopes, so spikes survive zooming out." },
    { quick: true, section: "One flight", path: flight, target: '[aria-label="Flight replay"]', title: "Pause the replay", text: "Pause where the failure begins.", hint: "Click Pause", action: { kind: "click", target: '[aria-label="Flight replay"] button' }, say: "I pause at the failure." },
    { section: "One flight", path: flight, target: 'section[aria-labelledby="track"]', title: "Ground track", text: "The path coloured by flight mode, with critical events as triangles. Click the track to jump the charts to that point.", hint: "Click the track", say: "The ground track is coloured by mode; clicking it jumps the charts to that spot." },
    { section: "One flight", path: flight, target: 'section[aria-labelledby="events"]', title: "Events", text: "Every warning and failure in the flight, with its time. Click one to focus the charts on it.", hint: "Click an event", say: "The event list; clicking one focuses all the charts there." },
    { quick: true, section: "One flight", path: flight, target: '#investigate', title: "Incident report", text: "A report written from numbered evidence. The database computes the evidence with SQL; the model only writes prose and must cite it; citations that do not exist are removed.",
      say: "The numbers never come from the model: SQL gathers numbered evidence, the model writes prose and must cite it, and every citation is checked." },
    { quick: true, section: "One flight", path: flight, target: "text:Write an incident report || text:Rewrite", title: "Write the report", text: "One click gathers the evidence with SQL and asks the model to write from it. It takes a few seconds the first time and is saved afterwards.", hint: "Click here", action: { kind: "click", target: "text:Write an incident report" },
      say: "I ask for the incident report. The database gathers the evidence first." },
    { quick: true, section: "One flight", path: flight, target: 'section[aria-labelledby="investigate"] ol button', title: "Click a citation", text: "A citation chip jumps the charts to the cited moment.", hint: "Click here", action: { kind: "click", target: 'section[aria-labelledby="investigate"] ol button' },
      say: "Clicking E-six takes the charts to the failsafe moment." },
    { section: "One flight", path: flight, target: "text:Evidence (", title: "The evidence behind it", text: "Open the evidence: every fact the report may cite, with its time.", hint: "Click here", action: { kind: "click", target: "text:Evidence (" }, say: "These are the facts, computed by SQL, that the report can cite." },
    { section: "One flight", path: flight, target: 'input[aria-label="Question about this flight"]', title: "Ask this flight a question", text: "Questions are answered only from the numbered evidence, with citations.", hint: "Type this", action: { kind: "fill", target: 'input[aria-label="Question about this flight"]', value: "Did the low battery cause the parachute to open?", submit: true },
      say: "I can ask this flight a question, and the answer cites the evidence it used." },
    { section: "One flight", path: flight, target: '[data-tour="flight-answer"]', title: "Result: the answer", text: "The answer is written only from the numbered evidence, and every claim carries a citation chip. Click a chip to jump the charts to the fact it relies on.", hint: "Click a chip", wait: 4000,
      say: "The answer cites its evidence, so I can check it by clicking." },
    { quick: true, section: "One flight", path: flight, target: '#moments', title: "Similar moments", text: "Each flight is cut into overlapping 10-second windows, each embedded by how every signal behaved. Pick a moment, find where other flights behaved the same way.",
      say: "A second use of vectors: ten-second windows, embedded by signal behaviour, searched with an HNSW index." },
    { quick: true, section: "One flight", path: flight, target: "text:Find similar moments", title: "Find them", text: "Use the slider or press the button to search all flights.", hint: "Click here", action: { kind: "click", target: "text:Find similar moments" }, say: "I search for moments like this one." },
    { quick: true, section: "One flight", path: flight, target: '[data-tour="moment-results"]', title: "Result: the matching moments", text: "One best window per other flight, closest first. Lower distance means more alike; the events inside each window are listed so you can see whether the match is meaningful.", wait: 2500,
      say: "The nearest windows from other flights, with the events that happened in them." },
    { section: "One flight", path: flight, target: "text:Overlay", title: "Overlay the match", text: "Overlay draws the same signal over the two matching windows so the similarity can be seen, not just a distance.", hint: "Click here", action: { kind: "click", target: "text:Overlay" }, wait: 1200,
      say: "Overlay draws the two matching windows on top of each other." },
    { section: "One flight", path: flight, target: '#relations', title: "Signal relationships", text: "A correlation matrix of this flight's signals on a one-second grid: orange moved together, blue moved oppositely. Hover a cell for the value.", hint: "Hover a cell",
      say: "Which signals moved together in this flight; orange together, blue opposite." },
    { section: "One flight", path: flight, target: '#notes', title: "Notes", text: "Investigation notes pinned to a moment of the flight; they are stored in the database and shared.", say: "Notes can be pinned to a moment and are shared." },
    { section: "One flight", path: flight, target: '#similar', title: "Similar flights", text: "Flights that behaved like this one, by a 32-dimension behavioural signature (signal statistics, event rates, mode shares), not by text.", say: "Similar flights come from a thirty-two dimension behavioural signature." },

    // ------------------------------------------------------------------------------------------------ search
    { quick: true, section: "Search", path: "/search?q=motor%20failure%20during%20takeoff", target: "main h1", title: "Semantic search", text: "Search over the text of every event by meaning. This query uses none of the words in many of the matching events.", say: "Semantic search: I asked for motor failure during takeoff." },
    { section: "Search", path: "/search?q=motor%20failure%20during%20takeoff", target: "main li@0", title: "A result", text: "Each result shows the event, its flight and time, severity and score. Click to open the flight at that moment.", hint: "Click a result", say: "Each result links to the flight at the exact time." },
    { section: "Search", path: "/search?q=motor%20failure%20during%20takeoff", target: "main summary@0", title: "How it was ranked", text: "Vector similarity and full text fused by reciprocal rank fusion; the filter strategy the router chose (exact sort or HNSW with iterative scan) is shown too.", hint: "Click here", action: { kind: "click", target: "main summary@0" },
      say: "The ranking details show the vector and full-text ranks and which strategy the router chose for the filter." },

    // ------------------------------------------------------------------------------------------------ compare
    { section: "Compare", path: `/compare?a=${F}&b=${G}`, target: "main h1", title: "Compare two flights", text: "The same canonical signal from two flights, even on different boards, aligned at takeoff.", say: "Compare overlays the same signal from two flights." },
    { section: "Compare", path: `/compare?a=${F}&b=${G}`, target: "main select@2", title: "Pick a signal", text: "Any canonical signal both flights have. This works because the ontology gives both boards' fields the same name.", hint: "Choose a signal", say: "It works across boards because the ontology maps their fields to one name." },

    // ------------------------------------------------------------------------------------------------ ask
    { quick: true, section: "Ask", path: "/ask", target: 'input[aria-label="Your question"]', title: "Ask in English", text: "A question becomes a database query, checked, run read-only; you see the answer and the query.", hint: "Type this",
      action: { kind: "fill", target: 'input[aria-label="Your question"]', value: "which board had the most failsafes?", submit: true }, say: "I ask which board had the most failsafes." },
    { quick: true, section: "Ask", path: "/ask", target: 'main div[aria-live]', title: "Result: the answer", text: "A short answer and a table. The numbers come from the database; the model only wrote the query.", wait: 6000,
      say: "The table is the real query result." },
    { quick: true, section: "Ask", path: "/ask", target: "text:How this was answered", title: "How it was answered", text: "The SQL that ran (rebuilt from the parse tree), the planner's cost estimate and every action the guard took: one SELECT, allow-listed views, a restricted role, a timeout.", hint: "Click here",
      action: { kind: "click", target: "text:How this was answered" }, wait: 5000,
      say: "The evidence panel shows the SQL, the cost and the guard's actions, so a wrong answer can be caught by reading it." },

    // ------------------------------------------------------------------------------------------------ map and fleet
    { quick: true, section: "Map", path: "/map", target: '[aria-label="Map of flights"]', title: "Where the flights happened", text: "Every flight with a GPS fix at its mean position. Blue none, yellow one or two, red three or more critical events; larger dots are longer flights. Click a dot for its card.", hint: "Click a dot", wait: 2500,
      say: "Every flight with a GPS fix, coloured by critical events." },
    { section: "Map", path: "/map", target: "text:Only flights with critical events", title: "Filter", text: "Show only flights with critical events, or pick a board.", hint: "Click here", action: { kind: "click", target: "text:Only flights with critical events" }, say: "I can filter to flights with critical events." },
    { quick: true, section: "Fleet", path: "/fleet", target: "#galaxy", title: "Flight galaxy", text: "Every flight is a point placed by its 32-dimension behavioural signature, projected to two dimensions. Nearby flights behaved alike. Click a point to open the flight.", hint: "Hover a point", say: "Every flight placed by how it behaved; close points behaved alike." },
    { section: "Fleet", path: "/fleet", target: '[aria-label="Colour the flights by"]', title: "Colour by", text: "Board, firmware, critical events or how unusual: the mean distance to the five nearest flights.", hint: "Click here", action: { kind: "click", target: "text:How unusual" }, say: "I colour by how unusual each flight is." },
    { section: "Fleet", path: "/fleet", target: "#cal", title: "A year of flying", text: "One square per day for the last 12 months: flights or critical events.", hint: "Hover a square", say: "A calendar of the last twelve months." },
    { section: "Fleet", path: "/fleet", target: "#boards", title: "Boards and firmware", text: "Critical events per flight by board and by firmware family, from SQL aggregates over the event table.", say: "Critical events per flight by board and firmware." },
    { section: "Incidents", path: "/incidents", target: '[aria-label="Severity"]', title: "Incidents", text: "Every warning and failure across all flights. Filter by severity, kind, board and wording.", hint: "Click Warnings", action: { kind: "click", target: "text:Warnings and critical" }, say: "Every warning and failure across flights." },
    { section: "Incidents", path: "/incidents", target: "main ul li@0", title: "Open at the moment", text: "Each incident links to its flight at that exact second.", hint: "Click Open at", say: "Each row opens the flight at that second." },

    // ------------------------------------------------------------------------------------------------ analysis
    { quick: true, section: "Patterns", path: "/patterns", target: 'select', title: "What happens around an event", text: "Pick an event kind and a window: for every other kind, the share of flights in which it occurred shortly before or after, against how common it is overall (the lift).", hint: "Choose an event",
      say: "Patterns shows what usually happens before and after an event." },
    { section: "Patterns", path: "/patterns", target: '[aria-label="Time window"]', title: "The window", text: "From 15 seconds to 5 minutes. A windowed self-join of the event table, computed live.", hint: "Click 2 min", action: { kind: "click", target: "text:2 min" }, say: "I widen the window to two minutes." },
    { quick: true, section: "Patterns", path: "/patterns", target: 'main section[aria-label]@0', title: "Result: what happens before", text: "Each bar is the share of flights where that kind occurred within the window before the chosen event; the tick is how common it is overall. A bar far past its tick is a real pattern.", wait: 800,
      say: "Bars far beyond the tick are not chance." },
    { section: "Patterns", path: "/patterns", target: 'main section[aria-label]@1', title: "Result: what happens after", text: "The same for the window after the event, the likely consequences.", say: "And what follows it." },
    { section: "Signals", path: "/signals", target: "ul button@3", title: "Signals", text: "Every canonical signal with the distribution of its per-flight mean, computed in SQL with width_bucket. Click one.", hint: "Click here", action: { kind: "click", target: "ul button@3" }, say: "Every canonical signal and its distribution across flights." },
    { section: "Signals", path: "/signals", target: "text:Per-flight mean across all flights", title: "One signal", text: "The distribution with the median marked, and the flights with the highest and lowest values.", wait: 600, say: "The distribution, and the flights at either extreme." },
    { quick: true, section: "Rule lab", path: "/rules", target: '[aria-label="Rule"]', title: "Rule lab", text: "The detectors are plain threshold rules. Pick one, move its threshold, and it is re-run over every flight and scored against the autopilot's own warnings.", hint: "Click a rule",
      action: { kind: "click", target: "text:GPS accuracy degraded" }, say: "The event detectors are threshold rules; this lab tunes them live." },
    { section: "Rule lab", path: "/rules", target: 'input[aria-label="Threshold"]', title: "Move the threshold", text: "Drag the slider: events, precision and recall update immediately.", hint: "Drag the slider", say: "As I drag, the rule re-runs over every flight and the scores change." },
    { quick: true, section: "Rule lab", path: "/rules", target: "#curve", title: "The trade-off", text: "Precision, recall and F1 across the whole range; the pink line is your setting and the dashed line the shipped threshold. Warnings are a proxy, not ground truth.", say: "The curve shows the trade-off, with the shipped threshold marked; the warnings are a proxy, not ground truth." },

    // ------------------------------------------------------------------------------------------------ SQL workbench
    { section: "Workbench", path: "/workbench", target: '[aria-label="Views and columns"]', title: "SQL workbench", text: "The documented views and their columns; click a column to insert it.", say: "The workbench lets me write my own SQL over the documented views." },
    { section: "Workbench", path: "/workbench", target: 'textarea[aria-label="SQL query"]', title: "Write a query", text: "Ctrl+Enter runs it. Same four checks as Ask: one SELECT on allow-listed views, a restricted role, a read-only transaction with a timeout, and planner cost admission.", hint: "Type or pick an example", say: "It goes through the same four checks as Ask." },
    { quick: true, section: "Workbench", path: "/workbench", target: "text:Explain", title: "Explain", text: "Explain draws the planner's plan as a tree with each node's share of the cost and the limit used for admission. Nothing is executed.", hint: "Click here", action: { kind: "click", target: "text:Explain" }, say: "Explain draws the planner's plan and the cost against the limit." },
    { quick: true, section: "Workbench", path: "/workbench", target: '[data-tour="plan"]', title: "Result: the plan", text: "Each node is a planner step with its share of the cost; the total is compared with the admission limit. Look for Seq Scan against Index Scan to see how the table is read.", wait: 1500,
      say: "The plan as a tree with each step's share of the cost." },
    { section: "Workbench", path: "/workbench", target: "text:Run", title: "Run it", text: "Rows, run time, planner cost and the SQL as rebuilt from the parse tree.", hint: "Click Run", action: { kind: "click", target: "text:Run" }, say: "Run shows the rows, the time and the SQL as the guard rebuilt it." },
    { section: "Workbench", path: "/workbench", target: '[data-tour="result"]', title: "Result: rows and cost", text: "Row count, run time, planner cost against the limit, which views were read, and the guard's notes. The table scrolls and its header stays.", wait: 1500,
      say: "The rows, the time, and what the guard did." },
    { quick: true, section: "Workbench", path: "/workbench", target: 'textarea[aria-label="SQL query"]', title: "A hostile query", text: "Reading a server file is refused by name, whatever the role could do.", hint: "Type this", action: { kind: "fill", target: 'textarea[aria-label="SQL query"]', value: "SELECT pg_read_file('/etc/passwd')" }, say: "Now a hostile query: reading a server file." },
    { quick: true, section: "Workbench", path: "/workbench", target: "text:Run", title: "Refused", text: "The guard refuses it before the database sees it. 46 hostile queries are tested, each refused for the intended reason.", hint: "Click Run", action: { kind: "click", target: "text:Run" }, say: "It is refused by the guard, by name." },

    // ------------------------------------------------------------------------------------------------ database
    { quick: true, section: "Workbench", path: "/workbench", target: '[data-tour="refused"]', title: "Result: the refusal", text: "The reason is shown in plain words and nothing reached the database. Try a second one: a query on a table that is not in the allow-list.", wait: 1500,
      say: "It names the reason it refused." },
    { quick: true, section: "Data explorer", path: "/data", target: '[aria-label="Entity relationship diagram"]', title: "Schema map", text: "The relations diagram is read live from the catalog: tables, keys and foreign keys. Hover a table to follow its links; click it to browse.", hint: "Hover a table", say: "The schema as a diagram, drawn from the catalog. Flight is the hub." },
    { section: "Data explorer", path: "/data", target: "text:Browse tables", title: "Browse tables", text: "Every table and view with row counts and sizes, and its rows.", hint: "Click here", action: { kind: "click", target: "text:Browse tables" }, say: "Browsing shows sizes and rows for every table." },
    { section: "Data explorer", path: "/data", target: "text:Structure", title: "Structure", text: "Columns, keys and descriptions, the indexes with method and size, and for the hypertable the chunk and columnstore settings.", hint: "Click here", action: { kind: "click", target: "text:Structure" }, say: "Structure shows columns, indexes and the columnstore settings." },
    { quick: true, section: "Database", path: "/database", target: "#space", title: "Where the space goes", text: "70.7 million samples: 12.5 GB as row storage, about 385 MB in the columnstore, 32 times smaller, all chunks compressed.", say: "The telemetry is thirty-two times smaller in the columnstore." },
    { section: "Database", path: "/database", target: "text:How a query runs", title: "A query and its plan", text: "Pick a query to see its real EXPLAIN ANALYZE with buffer counts, run live.", hint: "Pick a query", say: "These are real EXPLAIN ANALYZE plans, run live." },
    { section: "Database", path: "/database", target: "#idx", title: "Indexes and tables", text: "Index methods and sizes, row counts and table sizes, read live.", say: "Index methods, sizes and row counts." },
    { section: "Performance", path: "/performance", target: "#stmts", title: "Costliest statements", text: "From pg_stat_statements: total time, calls, mean and maximum time, cache hit. It refreshes every few seconds.", say: "The costliest statements from pg_stat_statements, live." },
    { section: "Performance", path: "/performance", target: "#scans", title: "How tables are read", text: "The share of scans that used an index; small lookup tables are read sequentially on purpose.", say: "The share of scans that used an index, per table." },
    { quick: true, section: "Ontology", path: "/ontology", target: '[aria-label^="Diagram of subsystems"]', title: "The ontology", text: "Signals, subsystems, failure modes and event kinds and how they relate; stored in ordinary tables and walked with recursive queries. Both autopilots' fields map to these names.", say: "The semantic layer: sixty-three concepts, fifty-five relations, and a mapping from both autopilots' fields." },

    // ------------------------------------------------------------------------------------------------ benchmarks
    { section: "Benchmarks", path: "/benchmarks", target: "#columnstore", title: "Columnstore design", text: "Size and four query shapes for each physical design; segmenting by flight and signal ordered by time is smallest and fastest for cross-flight queries.", say: "Experiment one: the columnstore design." },
    { quick: true, section: "Benchmarks", path: "/benchmarks", target: "#engines", title: "TimescaleDB against DuckDB", text: "Storage, the six queries and load throughput for the same data in both engines.", say: "Experiment four: against DuckDB, with an honest mixed result." },
    { quick: true, section: "Benchmarks", path: "/benchmarks", target: "#ann", title: "Vector indexes", text: "Recall against latency for HNSW, IVFFlat and DiskANN with build time and size; HNSW m=32 reaches 0.95 recall in 2.4 ms against 362 ms exact.", say: "HNSW reaches ninety-five percent recall in two point four milliseconds." },
    { quick: true, section: "Benchmarks", path: "/benchmarks", target: "#filter", title: "Filtered search", text: "Post-filtering returns 0 of 10 rows when a filter keeps 0.1 percent; the router uses the planner's estimate to choose exact search or HNSW.", say: "Filtered search under-returns, which is why the search routes itself." },
    { section: "Benchmarks", path: "/benchmarks", target: "#search", title: "Search quality", text: "Plain rank fusion is worse than vector alone; a light full-text weight ties it.", say: "Plain fusion hurt; I report it as found." },
    { quick: true, section: "Benchmarks", path: "/benchmarks", target: "#nlsql", title: "Natural-language SQL", text: "Accuracy on 27 held-out questions: 0.89 with the semantic views, 0.70 with documentation alone, 0.26 without.", say: "Documentation is the big effect; the views' extra gain is not significant." },
    { section: "Benchmarks", path: "/benchmarks", target: "#injection", title: "Fault injection", text: "Detection rate by fault duration: faults shorter than a rule's minimum are missed by design; from 5 s, 90 to 100 percent are found.", say: "Injected faults are found from five seconds; battery low has the most false alarms." },
    { section: "Benchmarks", path: "/benchmarks", target: "#moments", title: "Similar moments", text: "Precision at 10 per event kind against the random base rate: up to 43 times higher.", say: "Similar moments beat random by up to forty-three times." },

    // ------------------------------------------------------------------------------------------------ upload
    { section: "Upload", path: "/upload", target: "text:Drop a .ulg file here", title: "Upload a log", text: "A PX4 log is validated, queued like any other log and run through ingest, events, embeddings and summaries with live stage progress.", hint: "Drop a file",
      say: "Dropping a log runs the real pipeline, and each stage is shown as it finishes." },
    { quick: true, section: "Upload", path: "/", title: "That is the whole system", text: "One PostgreSQL with TimescaleDB and pgvector holds the time series, the ontology, the events and the embeddings; the application, the search and the guarded SQL sit on top. Press Finish to end the tour.",
      say: "One database, measured at every step. Thank you." },
  ];
}
