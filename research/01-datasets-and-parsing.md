# 01 - UAV Log Datasets, Parsers, SITL, and Canonical Field Mapping

Project: Semantic Log Analytics [UAV Log]. Research date: 2026-10-18.

Confidence tags: **[V]** verified by fetching the cited page this session. **[S]** seen only in a search-result summary, page not opened. **[K]** from my background knowledge, not verified this session (check before relying on it).

---

## 1. PX4 .ulg logs (Flight Review)

| Item | Finding |
|---|---|
| Public log browser | https://logs.px4.io/browse (also review.px4.io/browse). Columns: Uploaded, Overview, Type, Airframe, Hardware, Software, Duration, Start Time, Flight Modes. [V] |
| Bulk download | **Yes, officially supported.** PX4 docs point to `download_logs.py` in the flight_review repo (`app/download_logs.py`). [V] https://docs.px4.io/main/en/dev_log/flight_log_analysis_statistical |
| Mechanism | `GET https://review.px4.io/dbinfo` returns JSON metadata of all public logs. `GET https://review.px4.io/download?log=<id>` downloads one `.ulg`. [V] https://github.com/PX4/flight_review/blob/main/app/download_logs.py (fetched via WebFetch of the raw script summary) |
| Script options | `-n/--max-num` (default 10, `-1` = all), `-d` folder, `--print` (dump metadata JSON), filters: `--mav-type`, `--rating`, `--error-labels`, `--flight-modes`, `--airframe-name`, `--airframe-type`, `--vehicle-name`, `--source`, `--git-hash`, `--latest-per-vehicle`. Newest first, resumable (skips existing files). [V] |
| Rate limiting | Default 6 s delay between downloads (about 10 req/min), confirmation above 100 files, exponential backoff on HTTP 503, exits on 403/444 (treats as IP block). [V] **Implication:** 10 req/min means about 14,400 logs/day max; be polite and download a filtered subset (a few hundred to a few thousand). |
| License | Logs shared publicly are **CC-BY (PX4)**; upload page states "Public Share by Link" makes the log available under CC-BY. [V] https://logs.px4.io/ . Flight Review code is BSD-3-Clause. [V] https://github.com/PX4/flight_review . Attribution required. |
| ToS / privacy | No separate ToS found. The upload page warns logs may contain location data. [V] **Caveat:** GPS tracks of real flights are personal-ish data; do not republish raw logs with home coordinates in your report without thought. Cite CC-BY. |
| Metadata DB dump | Not offered. A forum thread says the DB cannot be dumped; extract metadata from logs yourself. [S, community reply] https://discuss.px4.io/t/license-for-the-dataset/42819 . Use `dbinfo` instead (see above). |
| Total corpus size / count | **Not verified.** Use `download_logs.py --print` and count entries to find out. Typical single log size is in the 1-50 MB range for typical flights [K]; ULog is already compact binary. Budget a few GB for a thousand logs. Check real sizes on a first sample. |
| Message topics | ULog is self-describing (format definitions inside the file). Topics are uORB messages. Which topics exist depends on `SDLOG_PROFILE`/PX4 version, but typical: `vehicle_attitude`, `vehicle_local_position`, `vehicle_global_position`, `sensor_combined`, `battery_status`, `vehicle_gps_position`/`sensor_gps`, `actuator_outputs`, `vehicle_status`, `failsafe_flags`, `vehicle_imu_status`, `estimator_status*`, `cpuload`, `input_rc`. [K for the logged-by-default list; V that these message names exist in docs: https://docs.px4.io/main/en/msg_docs/ ] |
| Non-topic content | Logged strings (`L`, `C` with tag), parameters (`P` initial + changes), info/multi-info messages, dropout markers, sync markers. [V] https://docs.px4.io/main/en/dev_log/ulog_file_format.html . Timestamps in microseconds. [V] |

Heterogeneity warning: public logs span PX4 versions, vehicle types (multicopter, VTOL, fixed-wing, rovers), and boards. Topic names/fields changed across versions (e.g., `vehicle_gps_position` renamed to `sensor_gps`, `actuator_controls` replaced by `actuator_motors`/`actuator_servos`; failsafe flags added) [K]. Filter on `--mav-type` and a minimum software version to limit schema drift.

## 2. ArduPilot .bin / .tlog

There is **no official equivalent of Flight Review's public bulk-download corpus** that I could find. [Search result: nothing found; absence-of-evidence only.]

Sources, in descending usefulness:
1. **Research datasets with ArduPilot .bin** (see section 3): BASiC (70 flights on Zenodo, includes .bin, CSV, .mat, tlog). [V]
2. **ArduPilot docs sample logs / forum threads** on https://discuss.ardupilot.org : users attach .bin logs to support threads (the "Log Analysis" / "Copter/Plane/Rover" categories). Licensing per post is unclear, scraping is laborious and not appropriate for bulk use. [K]
3. **Self-generated via SITL** (section 5): recommended, because licensing is clean and ground-truth fault labels are known.
4. Ask a local drone club/lab for logs (unverified idea).

Format notes: DataFlash `.bin` (self-describing FMT messages, so a generic parser works), `.tlog` (MAVLink telemetry stream with timestamp prefix, recorded by GCS, contains MAVLink messages like `ATTITUDE`, `SYS_STATUS`, `GPS_RAW_INT`, `HEARTBEAT`). Message reference: https://ardupilot.org/copter/docs/logmessages.html [V]

## 3. Labeled fault / anomaly datasets

| Dataset | Platform / format | Size | Labels | License | Link | Status |
|---|---|---|---|---|---|---|
| **ALFA** (CMU AirLab) | Fixed-wing, Pixhawk-based; **ROS bag** (MAVROS topics), plus CSV and MAT | 47 processed flights (23 engine-failure, 24 with 7 other actuator faults), about 66 min normal + 13 min post-fault; plus hours of raw flights. One abstract says 79 min total | Fault time and type per scenario (ground truth) | **Not verified.** KiltHub page returned HTTP 403 | Paper https://arxiv.org/abs/1907.06268 ; data DOI https://doi.org/10.1184/R1/12707963 | [S] via search summary; fixed-wing only; ROS bag, so no native ULog/DF field names (MAVROS-remapped) |
| **BASiC** (Biomisa ArduCopter Sensory Critique) | ArduPilot SITL; .bin, DF text CSV, processed CSV, .mat, rlog, tlog | 70 autonomous flights, about 7 h 21 m; >200 features | Binary `Status` flips 0 to 1 at failure; faults: GPS, RC, accel, gyro, compass, baro | Article CC BY; dataset license **check Zenodo record** | https://pmc.ncbi.nlm.nih.gov/articles/PMC10831493/ ; Zenodo DOI 10.5281/zenodo.8195068 (raw: zenodo.org/record/8199999) | [V] Best ArduPilot labeled option; simulated only |
| **RflyMAD** (Beihang) | PX4 (SITL, HITL, real); **ULog** plus processed CSV, TestInfo.csv | 114 GB total; 5,629 cases (2,566 SITL, 2,566 HITL, 497 real); 11 fault types, 6 flight statuses | Fault type/status per case in TestInfo | **Not found** ("open-source" only) | https://arxiv.org/abs/2311.11340 ; https://rfly-openha.github.io/documents/4_resources/dataset.html | [S] Strongest PX4 labeled set; download is large, subset advisable |
| **UAV-SEAD** | Real PX4 flights (6 custom quadrotors, mostly indoor) | 1,396 logs, about 52 h 20 m; 900 normal | 4 anomaly classes (mechanical/electrical, external position, global position, altitude), expert-labelled regions, not exact onset/offset; 141 uncategorized | Dataset license **not stated** (CC BY 4.0 on the page is likely arXiv's) | https://arxiv.org/html/2602.13900 ; https://huggingface.co/datasets/aykutkabaoglu/uav-flight-anomaly-dataset | [V] Format not explicitly stated; probably ULog (inferred from tool name `ulog_annotation_tool`). Very good fit (real-world labelled anomalies) |
| **UAV Attack Dataset** (Whelan et al.) | PX4 v1.11.3, Pixhawk 4, sim and live; **ULog + CSV** (via ulog2csv) | 683.88 MB zip | Benign vs attack flights (GPS spoofing, jamming, MAVLink ping DoS); no per-sample labels documented | Not named; IEEE DataPort login required (free) | https://ieee-dataport.org/open-access/uav-attack-dataset , DOI 10.21227/00dg-0d12 | [V]. Small; good for security-flavored queries; simulated part flagged by authors as less accurate |
| Drone Sensor Fusion Dataset (CSMA attack) | Derived from PX4 flight logs plus simulated attacks | ? | Attack vs normal | ? | https://ieee-dataport.org/ (DOI 10.21227/fdfq-s458) | [S] low priority |
| HITL UAV DoS / GPS spoofing MAVLink | HITL | ? | ? | ? | https://ieee-dataport.org/open-access/hitl-uav-dos-gps-spoofing-attacks-mavlink | [S] not examined |
| UAV-FD, PADRE | Rotor/propeller faults | small | fault class | ? | named in search summary only | [S] not examined; not log-format-centric |

Recommendation: primary corpus = Flight Review public logs (breadth, real, CC-BY) + one or two labeled sets for evaluation (RflyMAD subset for PX4; BASiC for ArduPilot; UAV-SEAD if the ULog format is confirmed). Check each license before redistributing derived Parquet.

## 4. Parsers

| Tool | Format | Maturity / facts | Notes |
|---|---|---|---|
| **pyulog** | ULog | PX4-maintained, BSD-3-Clause, 217 commits on main. [V] https://github.com/PX4/pyulog . Latest release number not verified (PyPI fetch failed). CLI: `ulog_info`, `ulog_messages`, `ulog_params`, `ulog2csv`, `ulog2kml`, `ulog2ros2bag`, `ulog_migratedb` (SQLite `DatabaseULog`). [V] | Python API: `ULog(path)`; `.data_list` of topics with `.name`, `.multi_id`, `.data` (dict of numpy arrays, `timestamp` in microseconds), plus `.logged_messages`, `.initial_parameters`, `.changed_parameters`, `.msg_info_dict`. [K, standard usage; verify against source]. No built-in pandas/Parquet support in README. [V] |
| **ulog2csv** | ULog | Part of pyulog. One CSV per topic instance, named `<log>_<topic>_<multi_id>.csv`. [K for naming] | Good for quick look; for scale go straight from pyulog API to Arrow. |
| **pyulgresample** | ULog | Resamples pyulog data into pandas DataFrames, columns named by `topic_field`. [S] https://pypi.org/project/pyulgresample | Maturity unknown. Optional. |
| **pymavlink** (`DFReader`, `mavutil`, `mavlogdump.py`) | ArduPilot .bin and .tlog | ArduPilot org, LGPL v3+, 3,429 commits. [V] https://github.com/ArduPilot/pymavlink . PyPI latest 2.4.50, 2026-09-24, Python 3.9-3.14. [V] https://pypi.org/project/pymavlink/ | `mavutil.mavlink_connection(path)` then `recv_match()` loops over messages for both `.bin` and `.tlog`; `mavlogdump.py --format csv|json --types ATT,BAT` exists. [K] Pure Python, slow on large logs (minutes for large .bin); use `DFReader_binary` and `--types` filters. |
| **MAVdataflash** | .bin | PyPI reader/visualizer. [S] | Minor. |
| **MAVExplorer / UAV Log Viewer / Mission Planner** | .bin, .tlog | GUIs for eyeballing; not pipelines. [K] | Use for sanity checks only. |
| pandas / pyarrow | n/a | `DataFrame.to_parquet` needs pyarrow or fastparquet. [V] https://pandas.pydata.org/docs/dev/reference/api/pandas.DataFrame.to_parquet.html | |

### Parquet extraction (design sketch, not tested here)

ULog to Parquet, one dataset per topic partitioned by log id:

```python
# Sketch only; verify API against installed pyulog version
from pyulog import ULog
import pyarrow as pa, pyarrow.parquet as pq
ulog = ULog(path, disable_str_exceptions=True)
for d in ulog.data_list:
    t = pa.table(d.data)                      # dict of numpy arrays
    t = t.append_column("log_id", pa.array([log_id]*t.num_rows))
    t = t.append_column("multi_id", pa.array([d.multi_id]*t.num_rows, pa.int8()))
    pq.write_to_dataset(t, f"out/ulog/{d.name}", partition_cols=["log_id"])
```

Notes: use a long/narrow "events" table for logged strings, mode changes, and parameter changes (text, not numeric). Array fields (e.g. `q[0]..q[3]`, `output[0]..`) appear as separate columns named `q[0]` etc. in pyulog [K]. Store `timestamp` as int64 microseconds and also a derived `t_s` from log start. DataFrame columns differ across PX4 versions, so use a per-topic schema-on-read and union by name (Parquet + DuckDB `union_by_name=true` handles this). ArduPilot: iterate with pymavlink, group by message type, build per-type Arrow tables, `TimeUS` is microseconds since boot.

## 5. SITL with headless Gazebo for fault injection

**PX4**
- Headless launch: `HEADLESS=1 make px4_sitl gz_x500` [V search summary of docs] https://docs.px4.io/main/en/sim_gazebo_gz/index (no GUI, no OpenGL need).
- Fault injection is built in: `failure <component> <type> [-i inst]` in the PX4 shell, or `MAV_CMD_INJECT_FAILURE` via MAVLink/MAVSDK. Disabled by default; enable `SYS_FAILURE_EN=1`. Components: gyro, accel, mag, baro, gps, airspeed, distance_sensor, battery, motor, esc, and more. Types: `ok, off, stuck, garbage, wrong, slow, delayed, intermittent`. Support varies per simulator (GPS supports only `off, stuck, wrong`); unsupported combos return `MAV_RESULT_UNSUPPORTED`. `motor off/wrong` needs `CA_FAILURE_MODE`. [V] https://docs.px4.io/main/en/debug/failure_injection.html
- Automation: MAVSDK-Python script: connect, arm, takeoff, wait N s, inject failure, wait, land; each run writes a `.ulg` under `build/px4_sitl_default/rootfs/log/` [K]. Ground truth label = the injected command timestamp (record it yourself).
- Resource needs: **not verified**. Rule of thumb [K]: 4+ cores and ~4-8 GB RAM for one headless Gazebo+PX4 instance; run one at a time on a laptop. PX4 SIH (simulation-in-hardware, no Gazebo) is far lighter and also supported for failure injection in some cases [V that SIH appears in the support matrix; details not verified]. SIH may be the pragmatic choice for a solo student generating hundreds of runs. Real-time sim means a 3-min flight costs 3 min unless sped up (`PX4_SIM_SPEED_FACTOR` [K]).
- Difficulty: moderate (day or two to get Gazebo + MAVSDK working on Arch; toolchain is Ubuntu-centric, a container/distrobox on Ubuntu 22.04/24.04 is recommended [K]).

**ArduPilot**
- Gazebo integration via `ardupilot_gazebo` plugin, Gazebo Garden/Harmonic, `sim_vehicle.py -v ArduCopter -f gazebo-iris --model JSON`. The docs page does not describe headless mode; `gz sim -s` (server only) is the usual way [K]. https://ardupilot.org/dev/docs/sitl-with-gazebo.html [V]
- **Much easier path: ArduPilot built-in SITL (no Gazebo)**, which has its own physics and `SIM_*` parameters for faults: `SIM_GPS_DISABLE`, `SIM_RC_FAIL`, `SIM_ENGINE_FAIL` (+`SIM_ENGINE_MUL`), `SIM_ACC_FAIL_MSK`/`SIM_GYR_FAIL_MSK`, `SIM_BARO_DISABLE`, `SIM_ARSPD_FAIL`, `SIM_ACC_RND`. [S, forum posts + docs] https://ardupilot.org/dev/docs/SITL_simulation_parameters.html ; exact list via `param show SIM_*`. Very light (single core, fast, can use `--speedup`). BASiC (above) was generated this way. [V]

## 6. Field mapping PX4 (uORB/ULog) vs ArduPilot (DataFlash), for a seed ontology

ArduPilot field names are **[V]** from https://ardupilot.org/copter/docs/logmessages.html (units noted there). PX4 names are **[K]** from uORB message definitions (existence of messages confirmed at https://docs.px4.io/main/en/msg_docs/); verify field-level names against the PX4 version of your logs, they changed across releases.

Global differences: PX4 timestamp = `timestamp` (us since boot, per topic); ArduPilot = `TimeUS` (us since boot). PX4 attitude is a quaternion in FRD/NED, ArduPilot ATT is Euler degrees. PX4 uses SI (rad, rad/s, V, A, m); ArduPilot mixes deg and cm in some messages. PX4 splits by topic with `multi_id` instances; ArduPilot uses an instance field (`I`, `Inst`, `IMU`) in the message.

| Canonical concept | Canonical attribute (proposed) | PX4 topic.field | ArduPilot msg.field | Unit / transform |
|---|---|---|---|---|
| Time | `t_us` | `*.timestamp` | `*.TimeUS` | us since boot (both) |
| Attitude | `roll, pitch, yaw` | `vehicle_attitude.q[0..3]` (quaternion w,x,y,z) -> Euler | `ATT.Roll, Pitch, Yaw` | PX4 rad (after conversion), ArduPilot deg. Normalize to rad. Yaw convention (heading 0..360 vs -pi..pi) differs |
| Attitude setpoint | `roll_des` etc. | `vehicle_attitude_setpoint.q_d` or `roll_body, pitch_body, yaw_body` | `ATT.DesRoll, DesPitch, DesYaw` | deg vs rad |
| Body rates | `rate_roll/pitch/yaw` | `vehicle_angular_velocity.xyz[0..2]` | `RATE.R, P, Y` (achieved), `RDes, PDes, YDes` | rad/s vs deg/s |
| Battery voltage | `batt_voltage_v` | `battery_status.voltage_v` | `BAT.Volt` (`VoltR` resting) | V |
| Battery current | `batt_current_a` | `battery_status.current_a` | `BAT.Curr` | A |
| Battery consumed | `batt_consumed_mah` | `battery_status.discharged_mah` | `BAT.CurrTot` | mAh |
| Battery remaining | `batt_remaining_pct` | `battery_status.remaining` (0..1) | `BAT.RemPct` (percent) | fraction vs percent: x100 |
| Battery instance | `batt_instance` | `battery_status` multi_id | `BAT.Inst` | |
| GPS fix | `gps_fix_type` | `sensor_gps.fix_type` (0-1 none, 2 2D, 3 3D, 4 DGPS, 5 RTK float, 6 RTK fixed) | `GPS.Status` (0 no GPS, 1 no lock, 2 2D, 3 3D, 4 DGPS, 5 RTK float, 6 RTK fixed) | Both follow MAVLink-like enum, minor offset at 0/1; map via table |
| GPS sats | `gps_num_sats` | `sensor_gps.satellites_used` | `GPS.NSats` | count |
| GPS HDOP | `gps_hdop` | `sensor_gps.hdop` | `GPS.HDop` | PX4 float, ArduPilot float |
| GPS position | `lat_deg, lon_deg, alt_m` | `sensor_gps.latitude_deg/longitude_deg/altitude_msl_m` (older: `lat/lon` in 1e-7 deg ints, `alt` mm) | `GPS.Lat, Lng, Alt` | Version-dependent scaling in PX4: check |
| GPS speed | `gps_ground_speed` | `sensor_gps.vel_m_s` | `GPS.Spd` | m/s |
| Vibration | `vibe_x/y/z`, `clip_count` | `vehicle_imu_status.accel_vibration_metric`, `gyro_vibration_metric`, `accel_clipping[0..2]` (no per-axis vibe; per-axis from `sensor_combined` or FFT) | `VIBE.VibeX, VibeY, VibeZ, Clip` | **Not 1:1**: PX4 gives a scalar metric, ArduPilot per-axis. Canonical: `vibe_metric` scalar optional, per-axis nullable |
| Motor outputs | `motor_out[i]` | `actuator_motors.control[i]` (normalized -1..1/0..1) or `actuator_outputs.output[i]` (PWM us) | `RCOU.C1..C14` (PWM us); `MOTB`/`ESC` for others | Distinguish normalized command vs PWM; canonical has both `cmd_norm` and `pwm_us` |
| ESC telemetry | `esc_rpm, esc_current` | `esc_status.esc[i].esc_rpm/esc_current` | `ESC.RPM, Curr` | where available |
| Flight mode | `flight_mode` | `vehicle_status.nav_state` (enum: MANUAL, ALTCTL, POSCTL, AUTO_MISSION, AUTO_LOITER, AUTO_RTL, ..., AUTO_LAND, OFFBOARD) | `MODE.Mode` / `ModeNum` + `Rsn` (reason) | Vehicle-specific enums. Need a mode ontology (stabilized, altitude-hold, position-hold, mission, return-to-launch, land, manual, offboard/guided). Event = change of value |
| Mode change reason | `mode_reason` | (no direct field; infer from `failsafe_flags`, `commander` logged strings, `vehicle_status.failsafe`) | `MODE.Rsn` (1 RC, 2 GCS, 3 radio FS, 4 batt FS, 5 GCS FS, 6 EKF FS, 7 GPS glitch, 8 mission end) | ArduPilot richer |
| Armed state | `armed` | `vehicle_status.arming_state` (2 = ARMED) | `EV.Id` 10 ARMED / 11 DISARMED; also `ARM` msg [K] | event vs state |
| Failsafe active | `failsafe_active`, `failsafe_cause` | `vehicle_status.failsafe`; `failsafe_flags.*` (bit flags: `battery_low_remaining_time`, `gcs_connection_lost`, `manual_control_signal_lost`, `global_position_invalid`, ...) | `ERR.Subsys` (5 FAILSAFE_RADIO, 6 FAILSAFE_BATT, 7 FAILSAFE_GPS, 8 FAILSAFE_GCS, 9 FAILSAFE_FENCE) with `ECode`; `EV` e.g. 19 LOST_GPS | PX4 = state flags per tick; ArduPilot = discrete coded events. Canonical: `failsafe_event(t, cause, severity, active)` derived |
| Text messages | `log_message(level, text)` | ULog logged string `L`/`C` (levels EMERG..DEBUG) | `MSG.Message` (chunked by `ID`/`Seq` in DF description) | Text -> embed for semantic search; `PX4`: has numeric level, ArduPilot: none in MSG |
| Params | `param(name, value, t)` | ULog `P` messages (initial, changed) | `PARM.Name, Value` | |
| EKF health | `ekf_*` | `estimator_status.*`, `estimator_status_flags` | `XKF1..XKF5`, `NKF*`, `EKF` msgs [K] | Not mapped here; Phase 2 |
| Power board | `vcc_v` | `system_power.voltage5v_v` [K] | `POWR.Vcc, VServo, Flags` [V] | |

Suggested ontology classes (seed): `Vehicle`, `FlightSession`, `Sensor{IMU,GPS,Baro,Mag}`, `PowerSystem{Battery}`, `Actuator{Motor,Servo}`, `FlightMode`, `Event{ModeChange,Arming,Failsafe,Error}`, `Parameter`, `Message`. Properties above are the leaves. Keep a `source_dialect` ({px4, ardupilot}), `source_field`, `transform` triple for every mapping row so the mapping itself is queryable.

## 7. Uncertainties / things to verify next

1. Flight Review corpus size and typical file size: run `python download_logs.py --print` and measure. Not found in docs.
2. ALFA license and exact size: KiltHub returned 403; open the DOI in a browser.
3. RflyMAD and UAV-SEAD dataset licenses: not stated in sources seen.
4. UAV-SEAD file format (inferred ULog) and whether labels are separate files.
5. pyulog latest release and exact Python API: PyPI fetch failed; confirm with `pip show pyulog`.
6. PX4 field names in section 6 column "PX4" come from memory; validate against a real log with `ulog_info -v`.
7. SITL resource numbers (cores/RAM) are rules of thumb; benchmark on your machine.
8. ArduPilot public log corpus: none found; this does not prove none exists.

## Sources

- https://logs.px4.io/ and https://review.px4.io/browse
- https://github.com/PX4/flight_review
- https://docs.px4.io/main/en/dev_log/flight_log_analysis_statistical
- https://github.com/PX4/pyulog
- https://docs.px4.io/main/en/dev_log/ulog_file_format.html
- https://docs.px4.io/main/en/msg_docs/
- https://docs.px4.io/main/en/debug/failure_injection.html
- https://docs.px4.io/main/en/sim_gazebo_gz/index
- https://discuss.px4.io/t/license-for-the-dataset/42819
- https://ardupilot.org/copter/docs/logmessages.html
- https://ardupilot.org/dev/docs/sitl-with-gazebo.html
- https://ardupilot.org/dev/docs/SITL_simulation_parameters.html
- https://github.com/ArduPilot/pymavlink and https://pypi.org/project/pymavlink/
- https://arxiv.org/abs/1907.06268 (ALFA), https://doi.org/10.1184/R1/12707963
- https://pmc.ncbi.nlm.nih.gov/articles/PMC10831493/ (BASiC)
- https://arxiv.org/abs/2311.11340 (RflyMAD)
- https://arxiv.org/html/2602.13900 (UAV-SEAD)
- https://ieee-dataport.org/open-access/uav-attack-dataset
- https://pypi.org/project/pyulgresample
