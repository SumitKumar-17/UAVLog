"""Ontology (Signal -> Subsystem -> Failure mode) and PX4 vendor-field mappings.

PX4 field names were verified against real logs with pyulog.
"""

SUBSYSTEMS = {
    "power": "Battery and power distribution",
    "navigation": "GNSS and position estimation inputs",
    "attitude": "Attitude and orientation",
    "propulsion": "Motors, ESCs and propellers",
    "imu": "Inertial sensors and vibration environment",
    "estimation": "State estimator (EKF) health",
    "flight_state": "Flight modes and arming state",
}

FAILURE_MODES = {
    "low_battery": "Battery depleted or voltage sag under load",
    "gps_degraded": "GNSS fix lost or poor accuracy",
    "high_vibration": "Excessive airframe vibration",
    "ekf_rejection": "Estimator rejecting sensor measurements",
    "motor_imbalance": "Uneven motor outputs indicating a propulsion fault",
    "motor_failure": "Motor or ESC failure detected by the autopilot",
    "attitude_loss": "Attitude exceeded safe limits (loss of control)",
}

# signal key -> (label, unit, subsystem)
SIGNALS = {
    "attitude.roll": ("Roll angle", "deg", "attitude"),
    "attitude.pitch": ("Pitch angle", "deg", "attitude"),
    "attitude.yaw": ("Yaw angle", "deg", "attitude"),
    "battery.voltage": ("Battery voltage", "V", "power"),
    "battery.current": ("Battery current", "A", "power"),
    "battery.remaining": ("Battery remaining", "%", "power"),
    "battery.discharged": ("Battery discharged", "mAh", "power"),
    "gps.lat": ("Latitude", "deg", "navigation"),
    "gps.lon": ("Longitude", "deg", "navigation"),
    "gps.alt_msl": ("GPS altitude (MSL)", "m", "navigation"),
    "gps.eph": ("GPS horizontal accuracy", "m", "navigation"),
    "gps.epv": ("GPS vertical accuracy", "m", "navigation"),
    "gps.satellites": ("Satellites used", "count", "navigation"),
    "gps.fix_type": ("GPS fix type", "enum", "navigation"),
    "gps.speed": ("GPS ground speed", "m/s", "navigation"),
    "position.x": ("Local position north", "m", "estimation"),
    "position.y": ("Local position east", "m", "estimation"),
    "position.z": ("Local position down", "m", "estimation"),
    "velocity.x": ("Velocity north", "m/s", "estimation"),
    "velocity.y": ("Velocity east", "m/s", "estimation"),
    "velocity.z": ("Velocity down", "m/s", "estimation"),
    "baro.altitude": ("Barometric altitude", "m", "navigation"),
    "motor.output_1": ("Motor 1 output", "norm", "propulsion"),
    "motor.output_2": ("Motor 2 output", "norm", "propulsion"),
    "motor.output_3": ("Motor 3 output", "norm", "propulsion"),
    "motor.output_4": ("Motor 4 output", "norm", "propulsion"),
    "vibration.accel": ("Accelerometer vibration metric", "m/s^2", "imu"),
    "vibration.gyro": ("Gyro vibration metric", "rad/s", "imu"),
    "ekf.pos_test_ratio": ("EKF position innovation test ratio", "ratio", "estimation"),
    "ekf.vel_test_ratio": ("EKF velocity innovation test ratio", "ratio", "estimation"),
    "ekf.hgt_test_ratio": ("EKF height innovation test ratio", "ratio", "estimation"),
    "mode.nav_state": ("Navigation state (flight mode)", "enum", "flight_state"),
    "mode.arming_state": ("Arming state", "enum", "flight_state"),
    "state.landed": ("Landed flag", "bool", "flight_state"),
}

# signal -> failure modes it is evidence for
INDICATES = {
    "battery.voltage": ["low_battery"],
    "battery.remaining": ["low_battery"],
    "gps.eph": ["gps_degraded"],
    "gps.satellites": ["gps_degraded"],
    "gps.fix_type": ["gps_degraded"],
    "vibration.accel": ["high_vibration"],
    "vibration.gyro": ["high_vibration"],
    "ekf.pos_test_ratio": ["ekf_rejection"],
    "ekf.vel_test_ratio": ["ekf_rejection"],
    "ekf.hgt_test_ratio": ["ekf_rejection"],
    "motor.output_1": ["motor_imbalance"],
    "motor.output_2": ["motor_imbalance"],
    "motor.output_3": ["motor_imbalance"],
    "motor.output_4": ["motor_imbalance"],
}

# (topic, field, vendor unit, signal key, scale, offset). roll/pitch/yaw are derived from q[] at ingest.
PX4_HOT_FIELDS = [
    ("vehicle_attitude", "roll_deg", "deg", "attitude.roll", 1, 0),
    ("vehicle_attitude", "pitch_deg", "deg", "attitude.pitch", 1, 0),
    ("vehicle_attitude", "yaw_deg", "deg", "attitude.yaw", 1, 0),
    ("battery_status", "voltage_v", "V", "battery.voltage", 1, 0),
    ("battery_status", "current_a", "A", "battery.current", 1, 0),
    ("battery_status", "remaining", "fraction", "battery.remaining", 100, 0),
    ("battery_status", "discharged_mah", "mAh", "battery.discharged", 1, 0),
    ("vehicle_gps_position", "latitude_deg", "deg", "gps.lat", 1, 0),
    ("vehicle_gps_position", "longitude_deg", "deg", "gps.lon", 1, 0),
    ("vehicle_gps_position", "altitude_msl_m", "m", "gps.alt_msl", 1, 0),
    ("vehicle_gps_position", "eph", "m", "gps.eph", 1, 0),
    ("vehicle_gps_position", "epv", "m", "gps.epv", 1, 0),
    ("vehicle_gps_position", "satellites_used", "count", "gps.satellites", 1, 0),
    ("vehicle_gps_position", "fix_type", "enum", "gps.fix_type", 1, 0),
    ("vehicle_gps_position", "vel_m_s", "m/s", "gps.speed", 1, 0),
    ("vehicle_local_position", "x", "m", "position.x", 1, 0),
    ("vehicle_local_position", "y", "m", "position.y", 1, 0),
    ("vehicle_local_position", "z", "m", "position.z", 1, 0),
    ("vehicle_local_position", "vx", "m/s", "velocity.x", 1, 0),
    ("vehicle_local_position", "vy", "m/s", "velocity.y", 1, 0),
    ("vehicle_local_position", "vz", "m/s", "velocity.z", 1, 0),
    ("vehicle_air_data", "baro_alt_meter", "m", "baro.altitude", 1, 0),
    ("actuator_motors", "control[0]", "norm", "motor.output_1", 1, 0),
    ("actuator_motors", "control[1]", "norm", "motor.output_2", 1, 0),
    ("actuator_motors", "control[2]", "norm", "motor.output_3", 1, 0),
    ("actuator_motors", "control[3]", "norm", "motor.output_4", 1, 0),
    ("vehicle_imu_status", "accel_vibration_metric", "m/s^2", "vibration.accel", 1, 0),
    ("vehicle_imu_status", "gyro_vibration_metric", "rad/s", "vibration.gyro", 1, 0),
    ("estimator_status", "pos_test_ratio", "ratio", "ekf.pos_test_ratio", 1, 0),
    ("estimator_status", "vel_test_ratio", "ratio", "ekf.vel_test_ratio", 1, 0),
    ("estimator_status", "hgt_test_ratio", "ratio", "ekf.hgt_test_ratio", 1, 0),
    ("vehicle_status", "nav_state", "enum", "mode.nav_state", 1, 0),
    ("vehicle_status", "arming_state", "enum", "mode.arming_state", 1, 0),
    ("vehicle_land_detected", "landed", "bool", "state.landed", 1, 0),
]

# event kind -> (description, failure mode it is evidence for or None)
EVENTS = {
    "takeoff": ("Vehicle left the ground", None),
    "landing": ("Vehicle touched down", None),
    "arm": ("Motors armed", None),
    "disarm": ("Motors disarmed", None),
    "mode_change": ("Flight mode changed", None),
    "failsafe_activated": ("A failsafe was triggered", None),
    "log_error": ("Autopilot logged an error message", None),
    "log_warning": ("Autopilot logged a warning message", None),
    "battery_low": ("Battery remaining below threshold", "low_battery"),
    "gps_poor": ("GPS fix or accuracy degraded", "gps_degraded"),
    "vibration_high": ("Sustained high vibration", "high_vibration"),
    "ekf_innovation_reject": ("Estimator rejecting measurements", "ekf_rejection"),
    "motor_failure_detected": ("Failure detector reported a motor or ESC failure", "motor_failure"),
    "imbalanced_prop_detected": ("Failure detector reported an imbalanced propeller", "motor_imbalance"),
    "attitude_limit_exceeded": ("Roll or pitch exceeded the failure-detector limit", "attitude_loss"),
}

# ArduPilot (MAVLink telemetry) -> canonical signals: (message, field, vendor unit, signal, scale, offset, note).
# The note records every semantic caveat. Quantities whose meaning differs between autopilots are NOT mapped (see ARDUPILOT_UNMAPPED).
RAD2DEG = 57.29577951308232
ARDUPILOT_FIELDS = [
    ("ATTITUDE", "roll", "rad", "attitude.roll", RAD2DEG, 0, "radians to degrees"),
    ("ATTITUDE", "pitch", "rad", "attitude.pitch", RAD2DEG, 0, "radians to degrees"),
    ("ATTITUDE", "yaw", "rad", "attitude.yaw", RAD2DEG, 0, "radians to degrees, range -180 to 180"),
    ("GPS_RAW_INT", "lat", "degE7", "gps.lat", 1e-7, 0, "degrees times 1e7; 0 means no fix and is dropped"),
    ("GPS_RAW_INT", "lon", "degE7", "gps.lon", 1e-7, 0, "degrees times 1e7; 0 means no fix and is dropped"),
    ("GPS_RAW_INT", "alt", "mm", "gps.alt_msl", 0.001, 0, "millimetres to metres, above mean sea level"),
    ("GPS_RAW_INT", "fix_type", "enum", "gps.fix_type", 1, 0, "the same MAVLink enum PX4 uses (3 is a 3D fix)"),
    ("GPS_RAW_INT", "satellites_visible", "count", "gps.satellites", 1, 0, "satellites VISIBLE; PX4 reports satellites USED, so counts run slightly higher; 255 means unknown and is dropped"),
    ("VFR_HUD", "groundspeed", "m/s", "gps.speed", 1, 0, "ground speed from the navigation filter; PX4 reports GNSS speed"),
    ("LOCAL_POSITION_NED", "x", "m", "position.x", 1, 0, "local north, relative to home"),
    ("LOCAL_POSITION_NED", "y", "m", "position.y", 1, 0, "local east, relative to home"),
    ("LOCAL_POSITION_NED", "z", "m", "position.z", 1, 0, "local down, relative to home"),
    ("LOCAL_POSITION_NED", "vx", "m/s", "velocity.x", 1, 0, "north"),
    ("LOCAL_POSITION_NED", "vy", "m/s", "velocity.y", 1, 0, "east"),
    ("LOCAL_POSITION_NED", "vz", "m/s", "velocity.z", 1, 0, "down"),
    ("SYS_STATUS", "voltage_battery", "mV", "battery.voltage", 0.001, 0, "millivolts to volts; 0 and 65535 mean unknown and are dropped"),
    ("SYS_STATUS", "current_battery", "cA", "battery.current", 0.01, 0, "centiamps to amps; -1 means unknown and is dropped"),
    ("SYS_STATUS", "battery_remaining", "%", "battery.remaining", 1, 0, "percent; -1 means unknown and is dropped"),
]
# Deliberately not mapped, with the reason (shown in docs/ontology-coverage.md):
ARDUPILOT_UNMAPPED = {
    "vibration.accel": "PX4 logs a high-pass filtered acceleration metric; ArduPilot's VIBRATION message gives a per-axis standard deviation. Different quantities.",
    "motor.output_1..4": "ArduPilot outputs are servo PWM whose function depends on SERVO_FUNCTION parameters; on a VTOL servos 1 and 2 are control surfaces, not motors.",
    "ekf.*_test_ratio": "ArduPilot's EKF_STATUS_REPORT variances are not documented as the innovation test ratios PX4 logs.",
    "baro.altitude": "VFR_HUD altitude is the fused MSL altitude, not a barometric reading.",
    "mode.nav_state": "ArduPilot custom_mode is a vehicle-specific enum (Plane, Copter and Rover differ); it needs a value map, not a scale and offset.",
}
