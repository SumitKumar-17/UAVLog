# Ontology coverage across autopilots

The canonical signals are defined once. Each autopilot's fields map onto them with a scale and offset and a note. A quantity that means
something different in another autopilot is **not** mapped, because a wrong mapping is worse than a gap. This is the evidence that the
semantic layer is more than renaming.

| canonical signal | PX4 (ULog topic.field) | ArduPilot (MAVLink message.field) | note |
|---|---|---|---|
| attitude.roll, pitch, yaw (deg) | derived from `vehicle_attitude.q[]` | `ATTITUDE.roll, pitch, yaw` (rad, times 57.2958) | quaternion against Euler angles |
| gps.lat, gps.lon (deg) | `vehicle_gps_position.latitude_deg, longitude_deg` | `GPS_RAW_INT.lat, lon` (degE7, times 1e-7) | 0 means no fix and is dropped |
| gps.alt_msl (m) | `vehicle_gps_position.altitude_msl_m` | `GPS_RAW_INT.alt` (mm, times 0.001) | |
| gps.fix_type | `vehicle_gps_position.fix_type` | `GPS_RAW_INT.fix_type` | the same MAVLink enum |
| gps.satellites | `vehicle_gps_position.satellites_used` | `GPS_RAW_INT.satellites_visible` | **visible against used**: counts differ slightly |
| gps.speed (m/s) | `vehicle_gps_position.vel_m_s` | `VFR_HUD.groundspeed` | GNSS speed against navigation-filter speed |
| position.x, y, z (m) | `vehicle_local_position.x, y, z` | `LOCAL_POSITION_NED.x, y, z` | local NED, relative to home |
| velocity.x, y, z (m/s) | `vehicle_local_position.vx, vy, vz` | `LOCAL_POSITION_NED.vx, vy, vz` | |
| battery.voltage, current, remaining | `battery_status.voltage_v, current_a, remaining` (fraction, times 100) | `SYS_STATUS.voltage_battery` (mV), `current_battery` (cA), `battery_remaining` (%) | sentinel values (0, 65535, -1) for unknown are dropped |
| baro.altitude | `vehicle_air_data.baro_alt_meter` | not mapped | `VFR_HUD.alt` is the fused MSL altitude, not a barometric reading |
| vibration.accel, vibration.gyro | `vehicle_imu_status.*_vibration_metric` | not mapped | PX4 logs a filtered metric, ArduPilot a per-axis standard deviation: different quantities |
| motor.output_1..4 | `actuator_motors.control[0..3]` | not mapped | ArduPilot outputs are servo PWM whose function depends on `SERVO_FUNCTION`; on a VTOL servos 1 and 2 are control surfaces |
| ekf.*_test_ratio | `estimator_status.*_test_ratio` | not mapped | `EKF_STATUS_REPORT` variances are not documented as the same test ratios |
| mode.nav_state | `vehicle_status.nav_state` | not mapped | ArduPilot `custom_mode` is a vehicle-specific enum and needs a value map, not a scale and offset |

Mappings live in `backend/app/ontology/seed_data.py` (`PX4_HOT_FIELDS`, `ARDUPILOT_FIELDS`, `ARDUPILOT_UNMAPPED`) and in the `field_mapping` table, whose `note` column holds the caveats.

## The ArduPilot sample

One simulated flight is loaded as proof of mechanism: `vtol.tlog` from the UAVLogViewer repository (MIT licence), an ArduPilot SITL VTOL flown at ArduPilot's default
Canberra test field, 207 seconds, MAVLink telemetry log. It is **not** a real aircraft and the battery fields in it are the "unknown" sentinels, so no battery series is loaded.
Load it with `docker compose exec backend python scripts/ingest_tlog.py /data/raw/mavlink/vtol.tlog`. Because both autopilots land on the same canonical signal names, the
Compare page can overlay a PX4 flight and this one on `attitude.roll`, and the threshold rules run on it unchanged.
