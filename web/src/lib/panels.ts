// Chart panels. Signals on one chart share a unit and scale; anything else gets its own chart (never a dual axis).
export type Panel = { id: string; title: string; unit: string; series: { signal: string; label: string }[] };

export const PANELS: Panel[] = [
  { id: "altitude", title: "Altitude", unit: "m", series: [{ signal: "baro.altitude", label: "Barometric" }] },
  { id: "attitude", title: "Attitude", unit: "°", series: [{ signal: "attitude.roll", label: "Roll" }, { signal: "attitude.pitch", label: "Pitch" }] },
  { id: "battery-v", title: "Battery voltage", unit: "V", series: [{ signal: "battery.voltage", label: "Voltage" }] },
  { id: "battery-r", title: "Battery remaining", unit: "%", series: [{ signal: "battery.remaining", label: "Remaining" }] },
  { id: "vibration", title: "Vibration", unit: "m/s²", series: [{ signal: "vibration.accel", label: "Accelerometer" }] },
  {
    id: "motors", title: "Motor outputs", unit: "",
    series: [1, 2, 3, 4].map((n) => ({ signal: `motor.output_${n}`, label: `Motor ${n}` })),
  },
  {
    id: "estimator", title: "Estimator innovation test ratios", unit: "",
    series: [{ signal: "ekf.pos_test_ratio", label: "Position" }, { signal: "ekf.vel_test_ratio", label: "Velocity" }, { signal: "ekf.hgt_test_ratio", label: "Height" }],
  },
  { id: "gps", title: "GPS horizontal accuracy", unit: "m", series: [{ signal: "gps.eph", label: "Accuracy" }] },
];
