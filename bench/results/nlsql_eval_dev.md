# NL-to-SQL evaluation (2026-10-18)

Model `openai/gpt-4o-mini`, temperature 0, up to 2 self-repair rounds. 37 questions (34 answerable, 3 unanswerable). Execution accuracy: the result set equals the gold query's (order-insensitive, numbers within rounding). Mean over questions with 95% bootstrap CI.

| condition | strict EX | lenient EX | first-try EX | mean attempts | mean generate ms |
|---|---|---|---|---|---|
| semantic | 0.74 [0.59, 0.88] | 0.85 [0.74, 0.97] | 0.71 [0.56, 0.85] | 0.97 | 993 |
| raw_docs | 0.53 [0.35, 0.71] | 0.59 [0.41, 0.76] | 0.53 [0.35, 0.71] | 1.47 | 1682 |
| raw | 0.21 [0.09, 0.35] | 0.21 [0.09, 0.35] | 0.21 [0.09, 0.35] | 0.94 | 1257 |

## Paired comparisons (strict EX)

| first | second | first right, second wrong | second right, first wrong | exact sign test p |
|---|---|---|---|---|
| semantic | raw | 19 | 1 | 0.0000 |
| semantic | raw_docs | 10 | 3 | 0.0923 |
| raw_docs | raw | 11 | 0 | 0.0010 |

## By category (strict EX)

| category | questions | semantic | raw + docs | raw |
|---|---|---|---|---|
| counting | 7 | 6/7 | 6/7 | 4/7 |
| aggregates | 6 | 4/6 | 4/6 | 2/6 |
| events | 6 | 4/6 | 3/6 | 1/6 |
| joins | 3 | 1/3 | 0/3 | 0/3 |
| labels | 3 | 3/3 | 0/3 | 0/3 |
| signals | 5 | 4/5 | 3/5 | 0/5 |
| ontology | 4 | 3/4 | 2/4 | 0/4 |

## What happened to each answerable question

| outcome | semantic | raw + docs | raw |
|---|---|---|---|
| returned rows | 32 | 27 | 26 |
| said it cannot answer | 2 | 0 | 7 |
| stopped by the cost check | 0 | 0 | 0 |
| stopped by the guard | 0 | 7 | 1 |
| database error | 0 | 0 | 0 |
| returned rows, but the wrong ones | 7 | 9 | 19 |

## Unanswerable questions (success = refusing)

| condition | refused | fabricated an answer |
|---|---|---|
| semantic | 3 | 0 |
| raw_docs | 3 | 0 |
| raw | 2 | 1 |

## Questions answered wrongly or not at all

### semantic
- **c06** How many flights had both a takeoff and a landing event? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM semantic.events WHERE kind IN ('takeoff', 'landing') GROUP BY flight_id HAVING COUNT(DISTINCT kind) = 2 LIMIT 201`
- **a02** What is the median flight duration in seconds? (refused)
- **a05** Which board has the most flights? (answered)
  `SELECT board, COUNT(DISTINCT flight_id) AS flight_count FROM semantic.flights GROUP BY board ORDER BY flight_count DESC LIMIT 1`
- **e01** What is the most common event kind? (answered)
  `SELECT kind, COUNT(*) AS event_count FROM semantic.events GROUP BY kind ORDER BY event_count DESC LIMIT 1`
- **e02** How many critical events are there for each failure mode? (answered)
  `SELECT failure_mode, COUNT(*) FROM semantic.events WHERE severity = 2 GROUP BY failure_mode LIMIT 201`
- **j01** Which board had the most vibration_high events? (answered)
  `SELECT f.board, COUNT(e.event_id) AS vibration_high_count FROM semantic.events AS e JOIN semantic.flights AS f ON e.flight_id = f.flight_id WHERE e.kind = 'vibration_high' GROUP BY f.board ORDER BY vibration_high_count DESC LIMIT `
- **j03** Counting all flights, what is the average number of critical events per flight, to two decimals? (answered)
  `SELECT ROUND(CAST(COALESCE(AVG(critical_event_count), 0) AS DECIMAL), 2) AS avg_critical_events_per_flight FROM (SELECT flight_id, COUNT(*) AS critical_event_count FROM semantic.events WHERE severity = 2 GROUP BY flight_id) AS cri`
- **s05** Which board had the highest average of its flights' peak vibration? (answered)
  `SELECT f.board, ROUND(CAST(AVG(ss.max_value) AS DECIMAL), 2) AS avg_peak_vibration FROM semantic.flights AS f JOIN semantic.signal_summary AS ss ON f.flight_id = ss.flight_id WHERE ss.signal = 'vibration.accel' GROUP BY f.board OR`
- **o01** What unit is the vibration.accel signal measured in? (refused)

### raw_docs
- **c05** How many distinct boards are in the data? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT count(DISTINCT metadata::jsonb ->> 'sys_hw') FROM public.flight`
- **a05** Which board has the most flights? (guard_refused, Function 'json_extract' is not allowed.)
  `SELECT metadata -> 'sys_hw' AS board, count(DISTINCT id) AS flight_count FROM public.flight GROUP BY metadata -> 'sys_hw' ORDER BY flight_count DESC LIMIT 1`
- **a06** What is the log id of the longest flight? (answered)
  `SELECT id FROM public.flight ORDER BY duration_s DESC LIMIT 1`
- **e01** What is the most common event kind? (answered)
  `SELECT c.key AS event_kind, COUNT(*) AS event_count FROM public.event AS e JOIN public.concept AS c ON e.kind_id = c.id GROUP BY c.key ORDER BY event_count DESC LIMIT 1`
- **e02** How many critical events are there for each failure mode? (answered)
  `SELECT fm.key AS failure_mode, COUNT(e.id) AS critical_event_count FROM public.event AS e JOIN public.concept AS fm ON e.kind_id = fm.id WHERE e.severity = 2 AND fm.kind = 'failure_mode' GROUP BY fm.key LIMIT 201`
- **e04** How many error messages from the autopilot mention the EKF? (answered)
  `SELECT COUNT(*) FROM public.event WHERE source = 'autopilot' AND description ILIKE '%EKF%' LIMIT 201`
- **j01** Which board had the most vibration_high events? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT f.metadata->>'sys_hw' AS board, count(e.id) AS vibration_high_count FROM public.event e JOIN public.flight f ON e.flight_id = f.id WHERE e.kind_id = (SELECT id FROM public.concept WHERE key = 'vibration_high' AND kind = 'ev`
- **j02** How many battery_low events happened on flights of the PX4_FMU_V6X board? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.flight AS f ON e.flight_id = f.id JOIN public.concept AS c ON e.kind_id = c.id WHERE c.key = 'battery_low' AND CAST(f.metadata AS TEXT) LIKE '%"sys_hw":"PX4_FMU_V6X"%' LIMIT 201`
- **j03** Counting all flights, what is the average number of critical events per flight, to two decimals? (answered)
  `SELECT ROUND(CAST(COALESCE(AVG(event_count), 0) AS DECIMAL), 2) AS avg_critical_events_per_flight FROM (SELECT flight_id, COUNT(*) AS event_count FROM public.event WHERE severity = 2 GROUP BY flight_id) AS critical_events_per_flig`
- **l01** How many flights did the pilot label with vibration as a cause? (guard_refused, Function 'array_contains_all' is not allowed.)
  `SELECT count(DISTINCT flight_id) FROM public.flight WHERE metadata->'error_labels'::jsonb @> '[]'::jsonb || '2'::jsonb`
- **l02** How many flights did the pilot rate as good? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT count(DISTINCT id) FROM public.flight WHERE metadata ->> 'rating' = 'good'`
- **l03** How many flights have written pilot feedback? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT count(DISTINCT id) FROM public.flight WHERE (metadata->>'feedback') IS NOT NULL AND (metadata->>'feedback') <> 'none'`
- **s04** Which flight had the highest battery voltage ever recorded? Give its log id. (answered)
  `SELECT f.id FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN public.concept AS `
- **s05** Which board had the highest average of its flights' peak vibration? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT f.metadata ->> 'sys_hw' AS board, round(max(t.value * fm.scale + fm."offset")::numeric, 1) AS peak_vibration FROM public.flight f JOIN public.telemetry t ON f.id = t.flight_id JOIN public.vendor_field vf ON t.vendor_field_i`
- **o03** Which failure modes can the battery.voltage signal indicate? (answered)
  `SELECT DISTINCT fm.id, fm.key FROM public.concept AS fm JOIN public.concept_relation AS cr ON fm.id = cr.dst_id JOIN public.concept AS sig ON cr.src_id = sig.id WHERE sig.key = 'battery.voltage' AND sig.kind = 'signal' AND fm.kind`
- **o04** List every subsystem that has at least one signal. (answered)
  `SELECT DISTINCT c.key AS subsystem FROM public.concept AS c JOIN public.concept_relation AS cr ON c.id = cr.dst_id WHERE cr.rel = 'part_of' AND c.kind = 'signal' LIMIT 201`

### raw
- **c03** How many flights had a motor failure detected? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.event AS e ON f.id = e.flight_id JOIN public.concept AS c ON e.kind_id = c.id WHERE c.key = 'motor_failure' LIMIT 201`
- **c04** How many failsafe events were there? (answered)
  `SELECT COUNT(*) FROM public.event WHERE description ILIKE '%failsafe%' LIMIT 201`
- **c05** How many distinct boards are in the data? (refused)
- **a02** What is the median flight duration in seconds? (refused)
- **a04** What percentage of flights had at least one critical event? One decimal. (answered)
  `SELECT ROUND(CAST(COUNT(DISTINCT CASE WHEN e.severity = 1 THEN f.id END) * 100.0 / COUNT(DISTINCT f.id) AS DECIMAL), 1) AS percentage_critical_events FROM public.flight AS f LEFT JOIN public.event AS e ON f.id = e.flight_id LIMIT `
- **a05** Which board has the most flights? (refused)
- **a06** What is the log id of the longest flight? (answered)
  `SELECT log_sha256 FROM public.flight ORDER BY duration_s DESC LIMIT 1`
- **e01** What is the most common event kind? (answered)
  `SELECT kind_id, COUNT(*) AS event_count FROM public.event GROUP BY kind_id ORDER BY event_count DESC LIMIT 1`
- **e02** How many critical events are there for each failure mode? (guard_refused, Function 'json_extract' is not allowed.)
  `SELECT attrs -> 'failure_mode' AS failure_mode, COUNT(*) AS critical_event_count FROM event WHERE severity = 1 -- Assuming severity 1 indicates critical events GROUP BY attrs -> 'failure_mode'`
- **e03** How many events happened in the first 10 seconds of a flight? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.flight AS f ON e.flight_id = f.id WHERE f.started_at IS NOT NULL AND e.ts_start >= f.started_at AND e.ts_start < f.started_at + INTERVAL '10 SECONDS' LIMIT 201`
- **e04** How many error messages from the autopilot mention the EKF? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.concept AS c ON e.kind_id = c.id WHERE e.source = 'autopilot' AND e.description ILIKE '%EKF%' LIMIT 201`
- **e06** How many warning-level events are there? (answered)
  `SELECT COUNT(*) FROM public.event WHERE severity = 2 LIMIT 201`
- **j01** Which board had the most vibration_high events? (answered)
  `SELECT flight.source, COUNT(*) AS event_count FROM public.event JOIN public.flight ON event.flight_id = flight.id WHERE event.description = 'vibration_high' GROUP BY flight.source ORDER BY event_count DESC LIMIT 1`
- **j02** How many battery_low events happened on flights of the PX4_FMU_V6X board? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.flight AS f ON e.flight_id = f.id WHERE e.description = 'battery_low' AND f.autopilot = 'PX4_FMU_V6X' LIMIT 201`
- **j03** Counting all flights, what is the average number of critical events per flight, to two decimals? (answered)
  `SELECT ROUND(CAST(COALESCE(AVG(event_count), 0) AS DECIMAL), 2) AS average_critical_events FROM (SELECT flight_id, COUNT(*) AS event_count FROM public.event WHERE severity = 1 GROUP BY flight_id) AS flight_events LIMIT 201`
- **l01** How many flights did the pilot label with vibration as a cause? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.event AS e ON f.id = e.flight_id WHERE e.description ILIKE '%vibration%' LIMIT 201`
- **l02** How many flights did the pilot rate as good? (refused)
- **l03** How many flights have written pilot feedback? (refused)
- **s01** How many flights recorded a battery voltage below 15 volts at some point? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN pu`
- **s02** What is the highest accelerometer vibration value recorded in any flight? (answered)
  `SELECT MAX(t.value) AS max_accelerometer_vibration FROM public.telemetry AS t JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN public.concept AS c ON fm`
- **s03** How many flights had GPS horizontal accuracy worse than 5 meters at some point? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN pu`
- **s04** Which flight had the highest battery voltage ever recorded? Give its log id. (answered)
  `SELECT f.id FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN public.concept AS `
- **s05** Which board had the highest average of its flights' peak vibration? (answered)
  `SELECT vf.autopilot, AVG(t.value) AS avg_peak_vibration FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id `
- **o01** What unit is the vibration.accel signal measured in? (refused)
- **o02** How many canonical signals belong to the power subsystem? (answered)
  `SELECT COUNT(*) FROM public.concept WHERE key ILIKE '%power%' AND kind = 'signal' LIMIT 201`
- **o03** Which failure modes can the battery.voltage signal indicate? (refused)
- **o04** List every subsystem that has at least one signal. (answered)
  `SELECT DISTINCT v.field FROM public.vendor_field AS v JOIN public.field_mapping AS fm ON v.id = fm.vendor_field_id JOIN public.concept AS c ON fm.concept_id = c.id WHERE c.kind = 'signal' LIMIT 201`

