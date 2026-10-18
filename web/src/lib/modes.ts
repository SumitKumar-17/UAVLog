// A flight mode always gets the same colour (colour follows the entity, never its rank). Unknown modes are neutral.
const MODE_VAR: Record<string, string> = {
  Position: "--m-position",
  Manual: "--m-manual",
  Altitude: "--m-altitude",
  Hold: "--m-hold",
  Stabilized: "--m-stabilized",
  Land: "--m-land",
  Mission: "--m-mission",
  Return: "--m-return",
};
export const LEGEND_MODES = Object.keys(MODE_VAR);
export const modeColor = (mode: string) => `var(${MODE_VAR[mode] ?? "--m-other"})`;
