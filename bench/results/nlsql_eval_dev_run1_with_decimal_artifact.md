# NL-to-SQL evaluation (2026-10-18)

Model `openai/gpt-4o-mini`, temperature 0, up to 2 self-repair rounds. 37 questions (34 answerable, 3 unanswerable). Execution accuracy: the result set equals the gold query's (order-insensitive, numbers within rounding). Mean over questions with 95% bootstrap CI.

| condition | strict EX | lenient EX | first-try EX | mean attempts | mean generate ms |
|---|---|---|---|---|---|
| semantic | 0.65 [0.47, 0.79] | 0.74 [0.59, 0.88] | 0.62 [0.44, 0.76] | 1.00 | 1088 |
| raw | 0.24 [0.12, 0.38] | 0.24 [0.09, 0.38] | 0.24 [0.09, 0.38] | 0.94 | 1465 |

Paired comparison (strict EX): semantic correct and raw wrong on 15 questions, raw correct and semantic wrong on 1; exact two-sided sign test p = 0.0005.

## By category (strict EX, semantic | raw)

| category | questions | semantic | raw |
|---|---|---|---|
| counting | 7 | 6/7 | 3/7 |
| aggregates | 6 | 3/6 | 2/6 |
| events | 6 | 3/6 | 2/6 |
| joins | 3 | 0/3 | 0/3 |
| labels | 3 | 3/3 | 0/3 |
| signals | 5 | 4/5 | 0/5 |
| ontology | 4 | 3/4 | 1/4 |

## What happened to each answerable question

| outcome | semantic | raw |
|---|---|---|
| returned rows | 33 | 31 |
| said it cannot answer | 1 | 3 |
| stopped by the cost check | 0 | 0 |
| stopped by the guard | 0 | 0 |
| database error | 0 | 0 |
| returned rows, but the wrong ones | 11 | 23 |

## Unanswerable questions (success = refusing)

| condition | refused | fabricated an answer |
|---|---|---|
| semantic | 3 | 0 |
| raw | 2 | 1 |

## Questions answered wrongly or not at all

### semantic
- **c06** How many flights had both a takeoff and a landing event? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM semantic.events WHERE kind IN ('takeoff', 'landing') GROUP BY flight_id HAVING COUNT(DISTINCT kind) = 2 LIMIT 201`
- **a01** What is the average flight duration in minutes, to one decimal? (answered)
  `SELECT ROUND(CAST(AVG(duration_s) / 60 AS DECIMAL), 1) AS avg_duration_minutes FROM semantic.flights LIMIT 201`
- **a04** What percentage of flights had at least one critical event? One decimal. (answered)
  `SELECT ROUND(CAST(COUNT(DISTINCT e.flight_id) * 100.0 / NULLIF(COUNT(DISTINCT f.flight_id), 0) AS DECIMAL), 1) AS percentage FROM semantic.flights AS f LEFT JOIN semantic.events AS e ON f.flight_id = e.flight_id AND e.severity = 2`
- **a05** Which board has the most flights? (answered)
  `SELECT board, COUNT(DISTINCT flight_id) AS flight_count FROM semantic.flights GROUP BY board ORDER BY flight_count DESC LIMIT 1`
- **e01** What is the most common event kind? (answered)
  `SELECT kind, COUNT(DISTINCT flight_id) AS flight_count FROM semantic.events GROUP BY kind ORDER BY flight_count DESC LIMIT 1`
- **e02** How many critical events are there for each failure mode? (answered)
  `SELECT failure_mode, COUNT(*) AS critical_event_count FROM semantic.events WHERE severity = 2 GROUP BY failure_mode LIMIT 201`
- **e04** How many error messages from the autopilot mention the EKF? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM semantic.events WHERE kind = 'log_error' AND description ILIKE '%EKF%' LIMIT 201`
- **j01** Which board had the most vibration_high events? (answered)
  `SELECT f.board, COUNT(e.event_id) AS vibration_high_count FROM semantic.events AS e JOIN semantic.flights AS f ON e.flight_id = f.flight_id WHERE e.kind = 'vibration_high' GROUP BY f.board ORDER BY vibration_high_count DESC LIMIT `
- **j02** How many battery_low events happened on flights of the PX4_FMU_V6X board? (answered)
  `SELECT COUNT(DISTINCT e.flight_id) FROM semantic.events AS e JOIN semantic.flights AS f ON e.flight_id = f.flight_id WHERE e.kind = 'battery_low' AND f.board = 'PX4_FMU_V6X' LIMIT 201`
- **j03** What is the average number of critical events per flight, to two decimals? (answered)
  `SELECT ROUND(CAST(COUNT(event_id) AS DECIMAL) / COUNT(DISTINCT flight_id), 2) AS avg_critical_events FROM semantic.events WHERE severity = 2 LIMIT 201`
- **s05** Which board had the highest average of its flights' peak vibration? (answered)
  `SELECT board, ROUND(CAST(AVG(max_value) AS DECIMAL), 2) AS avg_peak_vibration FROM semantic.signal_summary JOIN semantic.flights ON semantic.signal_summary.flight_id = semantic.flights.flight_id WHERE signal = 'vibration.accel' GR`
- **o01** What unit is the vibration.accel signal measured in? (refused)

### raw
- **c03** How many flights had a motor failure detected? (answered)
  `SELECT COUNT(DISTINCT f.id) AS motor_failure_flight_count FROM public.flight AS f JOIN public.event AS e ON f.id = e.flight_id JOIN public.concept AS c ON e.kind_id = c.id WHERE c.key = 'motor_failure' LIMIT 201`
- **c04** How many failsafe events were there? (answered)
  `SELECT COUNT(*) FROM public.event WHERE description ILIKE '%failsafe%' LIMIT 201`
- **c05** How many distinct boards are in the data? (refused)
- **c06** How many flights had both a takeoff and a landing event? (answered)
  `SELECT COUNT(DISTINCT f.id) AS flight_count FROM public.flight AS f JOIN public.event AS e_takeoff ON f.id = e_takeoff.flight_id AND e_takeoff.description ILIKE '%takeoff%' JOIN public.event AS e_landing ON f.id = e_landing.flight`
- **a01** What is the average flight duration in minutes, to one decimal? (answered)
  `SELECT ROUND(CAST(AVG(duration_s) / 60 AS DECIMAL), 1) AS average_flight_duration_minutes FROM public.flight LIMIT 201`
- **a04** What percentage of flights had at least one critical event? One decimal. (answered)
  `SELECT ROUND(CAST(COUNT(DISTINCT f.id) FILTER(WHERE e.severity = 1) * 100.0 / COUNT(DISTINCT f.id) AS DECIMAL), 1) AS critical_event_percentage FROM public.flight AS f LEFT JOIN public.event AS e ON f.id = e.flight_id LIMIT 201`
- **a05** Which board has the most flights? (answered)
  `SELECT autopilot, COUNT(*) AS flight_count FROM public.flight GROUP BY autopilot ORDER BY flight_count DESC LIMIT 1`
- **a06** What is the log id of the longest flight? (answered)
  `SELECT id FROM public.flight ORDER BY duration_s DESC LIMIT 1`
- **e01** What is the most common event kind? (answered)
  `SELECT c.label AS event_kind, COUNT(e.id) AS event_count FROM public.event AS e JOIN public.concept AS c ON e.kind_id = c.id GROUP BY c.label ORDER BY event_count DESC LIMIT 1`
- **e02** How many critical events are there for each failure mode? (answered)
  `SELECT c.label AS failure_mode, COUNT(e.id) AS critical_event_count FROM public.event AS e JOIN public.concept AS c ON e.kind_id = c.id WHERE e.severity = 1 GROUP BY c.label ORDER BY critical_event_count DESC LIMIT 201`
- **e04** How many error messages from the autopilot mention the EKF? (answered)
  `SELECT COUNT(*) FROM public.event WHERE flight_id IN (SELECT DISTINCT flight.id FROM public.flight) AND source = 'autopilot' AND description ILIKE '%EKF%' LIMIT 201`
- **e06** How many warning-level events are there? (answered)
  `SELECT COUNT(*) FROM public.event WHERE severity = 2 LIMIT 201`
- **j01** Which board had the most vibration_high events? (answered)
  `SELECT flight.source_ref AS board, COUNT(event.id) AS vibration_high_count FROM public.event JOIN public.flight ON event.flight_id = flight.id WHERE event.description = 'vibration_high' GROUP BY flight.source_ref ORDER BY vibratio`
- **j02** How many battery_low events happened on flights of the PX4_FMU_V6X board? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.flight AS f ON e.flight_id = f.id WHERE e.description = 'battery_low' AND f.autopilot = 'PX4_FMU_V6X' LIMIT 201`
- **j03** What is the average number of critical events per flight, to two decimals? (answered)
  `SELECT ROUND(CAST(AVG(event_count) AS DECIMAL), 2) AS average_critical_events FROM (SELECT flight_id, COUNT(*) AS event_count FROM public.event WHERE severity = 1 GROUP BY flight_id) AS flight_events LIMIT 201`
- **l01** How many flights did the pilot label with vibration as a cause? (answered)
  `SELECT COUNT(DISTINCT f.id) AS flight_count FROM public.flight AS f JOIN public.event AS e ON f.id = e.flight_id JOIN public.concept AS c ON e.kind_id = c.id WHERE e.description ILIKE '%vibration%' AND c.key = 'cause' LIMIT 201`
- **l02** How many flights did the pilot rate as good? (refused)
- **l03** How many flights have written pilot feedback? (refused)
- **s01** How many flights recorded a battery voltage below 15 volts at some point? (answered)
  `SELECT COUNT(DISTINCT f.id) AS flight_count FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_`
- **s02** What is the highest accelerometer vibration value recorded in any flight? (answered)
  `SELECT MAX(t.value) AS max_vibration FROM public.telemetry AS t JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN public.concept AS c ON fm.concept_id = `
- **s03** How many flights had GPS horizontal accuracy worse than 5 meters at some point? (answered)
  `SELECT COUNT(DISTINCT f.id) AS flight_count FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_`
- **s04** Which flight had the highest battery voltage ever recorded? Give its log id. (answered)
  `SELECT f.log_sha256 FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN public.con`
- **s05** Which board had the highest average of its flights' peak vibration? (answered)
  `SELECT vf.autopilot, AVG(t.value) AS avg_peak_vibration FROM public.telemetry AS t JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN public.concept AS c `
- **o02** How many canonical signals belong to the power subsystem? (answered)
  `SELECT COUNT(*) FROM public.concept WHERE kind = 'signal' AND id IN (SELECT concept_id FROM public.field_mapping WHERE vendor_field_id IN (SELECT id FROM public.vendor_field WHERE topic = 'power')) LIMIT 201`
- **o03** Which failure modes can the battery.voltage signal indicate? (answered)
  `SELECT DISTINCT c.label FROM public.concept AS c JOIN public.field_mapping AS fm ON c.id = fm.concept_id JOIN public.vendor_field AS vf ON vf.id = fm.vendor_field_id WHERE vf.field = 'battery.voltage' AND c.kind = 'signal' LIMIT 2`
- **o04** List every subsystem that has at least one signal. (answered)
  `SELECT DISTINCT c.label AS subsystem FROM public.concept AS c JOIN public.field_mapping AS fm ON c.id = fm.concept_id WHERE c.kind = 'signal' LIMIT 201`

