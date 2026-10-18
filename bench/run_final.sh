#!/bin/sh
# Engine comparison, then the controlled difficulty run, strictly one after the other.
cd /app
python scripts/bench_engines.py > /data/bench_engines2.log 2>&1
echo "ENGINES2 DONE" >> /data/bench_engines2.log
sh /bench/run_sigma.sh > /data/bench_sigma.log 2>&1
