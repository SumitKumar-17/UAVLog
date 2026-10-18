# NL-to-SQL evaluation (2026-10-18)

Model `openai/gpt-4o-mini`, temperature 0, up to 2 self-repair rounds. 30 questions (27 answerable, 3 unanswerable). Execution accuracy: the result set equals the gold query's (order-insensitive, numbers within rounding). Mean over questions with 95% bootstrap CI.

| condition | strict EX | lenient EX | first-try EX | mean attempts | mean generate ms |
|---|---|---|---|---|---|
| semantic | 0.89 [0.78, 1.00] | 0.96 [0.89, 1.00] | 0.85 [0.70, 0.96] | 1.00 | 1033 |
| raw_docs | 0.59 [0.41, 0.78] | 0.67 [0.48, 0.85] | 0.59 [0.41, 0.78] | 1.22 | 1445 |
| raw | 0.22 [0.07, 0.37] | 0.26 [0.11, 0.44] | 0.22 [0.07, 0.37] | 1.22 | 1396 |

## Paired comparisons (strict EX)

| first | second | first right, second wrong | second right, first wrong | exact sign test p |
|---|---|---|---|---|
| semantic | raw | 18 | 0 | 0.0000 |
| semantic | raw_docs | 8 | 0 | 0.0078 |
| raw_docs | raw | 10 | 0 | 0.0020 |

## By category (strict EX)

| category | questions | semantic | raw + docs | raw |
|---|---|---|---|---|
| counting | 5 | 5/5 | 5/5 | 2/5 |
| aggregates | 4 | 3/4 | 3/4 | 3/4 |
| events | 5 | 5/5 | 4/5 | 1/5 |
| joins | 3 | 2/3 | 1/3 | 0/3 |
| labels | 3 | 2/3 | 0/3 | 0/3 |
| signals | 4 | 4/4 | 2/4 | 0/4 |
| ontology | 3 | 3/3 | 1/3 | 0/3 |

## What happened to each answerable question

| outcome | semantic | raw + docs | raw |
|---|---|---|---|
| returned rows | 26 | 21 | 23 |
| said it cannot answer | 1 | 2 | 2 |
| stopped by the cost check | 0 | 0 | 0 |
| stopped by the guard | 0 | 4 | 2 |
| database error | 0 | 0 | 0 |
| returned rows, but the wrong ones | 2 | 5 | 17 |

## Unanswerable questions (success = refusing)

| condition | refused | fabricated an answer |
|---|---|---|
| semantic | 3 | 0 |
| raw_docs | 3 | 0 |
| raw | 2 | 1 |

## Questions answered wrongly or not at all

### semantic
- **t08** Which firmware version has the most flights? (answered)
  `SELECT firmware, COUNT(DISTINCT flight_id) AS flight_count FROM semantic.flights GROUP BY firmware ORDER BY flight_count DESC LIMIT 1`
- **t15** Which board had the most takeoff events? (answered)
  `SELECT f.board, COUNT(e.event_id) AS takeoff_count FROM semantic.events AS e JOIN semantic.flights AS f ON e.flight_id = f.flight_id WHERE e.kind = 'takeoff' GROUP BY f.board ORDER BY takeoff_count DESC LIMIT 1`
- **t18** How many flights did the pilot label with external conditions as a cause? (refused)

### raw_docs
- **t08** Which firmware version has the most flights? (answered)
  `SELECT firmware, COUNT(DISTINCT id) AS flight_count FROM public.flight GROUP BY firmware ORDER BY flight_count DESC LIMIT 1`
- **t11** What is the second most common event kind? (answered)
  `SELECT c.key, COUNT(e.id) AS event_count FROM public.event AS e JOIN public.concept AS c ON e.kind_id = c.id GROUP BY c.key ORDER BY event_count DESC LIMIT 1 OFFSET 1`
- **t15** Which board had the most takeoff events? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT f.metadata->>'sys_hw' AS board, count(e.id) AS takeoff_count FROM public.event e JOIN public.flight f ON e.flight_id = f.id WHERE e.kind_id = (SELECT id FROM public.concept WHERE key = 'takeoff' AND kind = 'event') GROUP BY`
- **t17** How many flights of the PX4_FMU_V6C board had at least one critical event? (guard_refused, Function 'json_extract_scalar' is not allowed.)
  `SELECT count(DISTINCT f.id) FROM public.flight f JOIN public.event e ON f.id = e.flight_id WHERE f.metadata ->> 'sys_hw' = 'PX4_FMU_V6C' AND e.severity = 2`
- **t18** How many flights did the pilot label with external conditions as a cause? (guard_refused, Function 'json_extract' is not allowed.)
  `SELECT count(DISTINCT flight_id) FROM public.flight WHERE metadata->'error_labels' IS NOT NULL AND '8' = ANY (SELECT jsonb_array_elements_text(metadata->'error_labels'))`
- **t19** How many flights did the pilot rate as crash_pilot? (refused)
- **t20** How many flights have at least one pilot-selected cause label? (guard_refused, Function 'json_extract' is not allowed.)
  `SELECT count(DISTINCT flight_id) FROM public.flight WHERE metadata->'error_labels' IS NOT NULL AND metadata->'error_labels' <> '[]'`
- **t21** How many flights had the barometric altitude exceed 500 meters at some point? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM public.telemetry JOIN public.vendor_field ON telemetry.vendor_field_id = vendor_field.id JOIN public.field_mapping ON vendor_field.id = field_mapping.vendor_field_id JOIN public.concept ON fie`
- **t22** What is the lowest GPS satellite count recorded in any flight? (refused)
- **t25** How many signals are in the navigation subsystem? (answered)
  `SELECT COUNT(DISTINCT concept.id) FROM public.concept JOIN public.concept_relation ON concept.id = concept_relation.dst_id WHERE concept_relation.rel = 'part_of' AND concept.key = 'navigation' AND concept.kind = 'signal' LIMIT 201`
- **t26** Which failure modes can the vibration.accel signal indicate? (answered)
  `SELECT DISTINCT cm.label FROM public.concept AS cs JOIN public.concept_relation AS cr ON cs.id = cr.dst_id JOIN public.concept AS cm ON cr.src_id = cm.id WHERE cs.key = 'vibration.accel' AND cr.rel = 'indicates' LIMIT 201`

### raw
- **t01** How many flights have at least one warning-level event? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM public.event WHERE severity = 2 LIMIT 201`
- **t03** How many flights had a vibration_high event? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM public.event WHERE description ILIKE '%vibration_high%' LIMIT 201`
- **t04** How many flights have no critical events? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f LEFT JOIN public.event AS e ON f.id = e.flight_id AND e.severity = 1 WHERE e.id IS NULL LIMIT 201`
- **t08** Which firmware version has the most flights? (answered)
  `SELECT firmware, COUNT(DISTINCT id) AS flight_count FROM public.flight GROUP BY firmware ORDER BY flight_count DESC LIMIT 1`
- **t10** How many critical events are there in total? (answered)
  `SELECT COUNT(*) FROM public.event WHERE severity = 1 LIMIT 201`
- **t11** What is the second most common event kind? (answered)
  `SELECT kind_id, COUNT(*) AS event_count FROM public.event GROUP BY kind_id ORDER BY event_count DESC LIMIT 1 OFFSET 1`
- **t12** How many landing events happened more than 60 seconds into the log? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.flight AS f ON e.flight_id = f.id WHERE e.description ILIKE '%landing%' AND e.ts_start > (f.started_at + INTERVAL '60 SECONDS') LIMIT 201`
- **t13** How many gps_poor events are critical? (guard_refused, Send exactly one statement.)
  `SELECT COUNT(*) FROM event WHERE kind_id = (SELECT id FROM concept WHERE key = 'gps_poor') AND severity = 1; -- Assuming severity 1 indicates critical`
- **t15** Which board had the most takeoff events? (answered)
  `SELECT flight.source, COUNT(*) AS takeoff_event_count FROM public.event JOIN public.flight ON event.flight_id = flight.id WHERE event.description ILIKE '%takeoff%' GROUP BY flight.source ORDER BY takeoff_event_count DESC LIMIT 1`
- **t16** How many failsafe_activated events happened on flights longer than 10 minutes? (answered)
  `SELECT COUNT(*) FROM public.event AS e JOIN public.flight AS f ON e.flight_id = f.id WHERE e.description = 'failsafe_activated' AND f.duration_s > 600 LIMIT 201`
- **t17** How many flights of the PX4_FMU_V6C board had at least one critical event? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.event AS e ON f.id = e.flight_id WHERE f.autopilot = 'PX4_FMU_V6C' AND e.severity = 1 LIMIT 201`
- **t18** How many flights did the pilot label with external conditions as a cause? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.event AS e ON f.id = e.flight_id WHERE e.description ILIKE '%external conditions%' LIMIT 201`
- **t19** How many flights did the pilot rate as crash_pilot? (answered)
  `SELECT COUNT(DISTINCT flight_id) FROM public.event WHERE description = 'crash_pilot' LIMIT 201`
- **t20** How many flights have at least one pilot-selected cause label? (guard_refused, Send exactly one statement.)
  `-- CANNOT_ANSWER: No table contains pilot-selected cause labels.`
- **t21** How many flights had the barometric altitude exceed 500 meters at some point? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN pu`
- **t22** What is the lowest GPS satellite count recorded in any flight? (answered)
  `SELECT MIN(value) AS lowest_gps_satellite_count FROM public.telemetry JOIN public.vendor_field ON telemetry.vendor_field_id = vendor_field.id JOIN public.field_mapping ON vendor_field.id = field_mapping.vendor_field_id JOIN public`
- **t23** How many flights had the roll angle go beyond 90 degrees in either direction at some point? (answered)
  `SELECT COUNT(DISTINCT f.id) FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id JOIN public.vendor_field AS vf ON t.vendor_field_id = vf.id JOIN public.field_mapping AS fm ON vf.id = fm.vendor_field_id JOIN pu`
- **t24** What is the average, across flights, of each flight's mean battery voltage? Round to one decimal. (answered)
  `SELECT ROUND(CAST(AVG(battery_voltage.mean_voltage) AS DECIMAL), 1) AS average_battery_voltage FROM (SELECT f.id AS flight_id, AVG(t.value) AS mean_voltage FROM public.flight AS f JOIN public.telemetry AS t ON f.id = t.flight_id J`
- **t25** How many signals are in the navigation subsystem? (refused)
- **t26** Which failure modes can the vibration.accel signal indicate? (refused)
- **t27** How many event kinds indicate the motor_failure failure mode? (answered)
  `SELECT COUNT(DISTINCT e.kind_id) FROM public.event AS e JOIN public.concept AS c ON e.kind_id = c.id WHERE c.description ILIKE '%motor_failure%' LIMIT 201`


Prompt component hashes (audit): rules_semantic 94c6d07c4c1b, rules_raw 32eb02ffd122, examples_semantic d7d5ffeeb658, examples_raw 01071a566d5c, raw_schema 5fe1b52159bf, raw_docs_schema 9d8b2a7ac9e8
