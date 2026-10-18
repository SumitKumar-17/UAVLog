#!/usr/bin/env bash
# Capture real database and project output as text (docs/figures/text/*.txt); tools/code2png.cjs renders them as terminal-style screenshots.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
out=docs/figures/text; mkdir -p "$out"
psqlq() { docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

{ echo "uavlog=# \\d+ telemetry"; psqlq -c '\d+ telemetry'; } > $out/term-telemetry.txt 2>&1
{ echo "uavlog=# \\d+ event"; psqlq -c '\d+ event' | head -34; } > $out/term-event.txt 2>&1
{ echo "uavlog=# SELECT hypertable_name, num_dimensions, num_chunks, compression_enabled FROM timescaledb_information.hypertables;"; psqlq -c "SELECT hypertable_name, num_dimensions, num_chunks, compression_enabled FROM timescaledb_information.hypertables"
  echo; echo "uavlog=# SELECT column_name, time_interval FROM timescaledb_information.dimensions;"; psqlq -c "SELECT hypertable_name, column_name, time_interval FROM timescaledb_information.dimensions WHERE hypertable_name='telemetry'"
  echo; echo "uavlog=# SELECT * FROM timescaledb_information.hypertable_columnstore_settings;"; psqlq -c "SELECT hypertable, segmentby, orderby FROM timescaledb_information.hypertable_columnstore_settings WHERE hypertable::text LIKE '%telemetry'" 2>&1; } > $out/term-hypertable.txt 2>&1
{ echo "uavlog=# SELECT * FROM hypertable_columnstore_stats('telemetry');"; psqlq -x -c "SELECT total_chunks, number_compressed_chunks, pg_size_pretty(before_compression_table_bytes) AS before_table, pg_size_pretty(before_compression_index_bytes) AS before_index, pg_size_pretty(before_compression_total_bytes) AS before_total, pg_size_pretty(after_compression_total_bytes) AS after_total FROM hypertable_columnstore_stats('telemetry')"; } > $out/term-columnstore.txt 2>&1
{ echo "uavlog=# SELECT chunk_name, range_start::date, range_end::date, is_compressed FROM timescaledb_information.chunks WHERE hypertable_name='telemetry' ORDER BY range_start LIMIT 8;"; psqlq -c "SELECT chunk_name, range_start::date, range_end::date, is_compressed FROM timescaledb_information.chunks WHERE hypertable_name='telemetry' ORDER BY range_start LIMIT 8"; } > $out/term-chunks.txt 2>&1
{ echo "uavlog=# -- indexes of the semantic search tables"; psqlq -c "SELECT relname AS index, am.amname AS method, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE indrelid::regclass::text IN ('event','flight','flight_signature','note') ORDER BY pg_relation_size(i.indexrelid) DESC LIMIT 12"; } > $out/term-indexes.txt 2>&1
{ echo "uavlog=# -- the documented semantic layer (view comments are the model's schema description)"; psqlq -c "SELECT c.relname AS view, left(obj_description(c.oid,'pg_class'),70) AS comment FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='semantic' AND c.relkind IN ('v','m') ORDER BY 1"; } > $out/term-semantic.txt 2>&1
{ echo "uavlog=# -- what the restricted role can and cannot do"; psqlq -c "BEGIN READ ONLY; SET LOCAL ROLE uav_reader; SELECT count(*) AS flights_visible FROM semantic.flights; SELECT count(*) FROM flight; ROLLBACK;" 2>&1; psqlq -c "BEGIN READ ONLY; SET LOCAL ROLE uav_reader; SELECT length(pg_read_file('/etc/passwd')); ROLLBACK;" 2>&1; } > $out/term-role.txt 2>&1
{ echo "uavlog=# SHOW ... -- configuration the benchmarks ran under"; psqlq -c "SELECT name, setting || coalesce(unit,'') AS value FROM pg_settings WHERE name IN ('shared_buffers','maintenance_work_mem','effective_cache_size','work_mem','max_parallel_workers','max_parallel_maintenance_workers','random_page_cost') ORDER BY 1"; psqlq -c "SELECT version()" | head -3; psqlq -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('timescaledb','vector','vectorscale','timescaledb_toolkit') ORDER BY 1"; } > $out/term-config.txt 2>&1
for n in envelope vector fulltext modes; do
  curl -s localhost:8000/api/internals/explain/$n | python3 -I -c "
import sys, json
d = json.load(sys.stdin)
print('-- ' + d['title']); print(d['sql']); print(); print('\n'.join(d['plan'][:26]))
if len(d['plan']) > 26: print('   ...'); print(d['plan'][-1])" > $out/term-plan-$n.txt 2>&1
done
{ echo "docker compose ps"; docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'; } > $out/term-compose.txt 2>&1
{ echo "git shortlog -sn; git ls-files | wc -l"; git log --oneline | wc -l | xargs echo "commits:"; git ls-files | wc -l | xargs echo "tracked files:";
  for ext in py ts tsx sql sh cjs md; do printf "%-4s %6s lines\n" ".$ext" "$(git ls-files "*.$ext" | xargs cat 2>/dev/null | wc -l)"; done; } > $out/term-codebase.txt 2>&1
echo "captured:"; ls -1 $out
