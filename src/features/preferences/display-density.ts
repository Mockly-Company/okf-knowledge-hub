export const DISPLAY_DENSITIES = ["default", "compact"] as const;
export type DisplayDensity = (typeof DISPLAY_DENSITIES)[number];
export const DEFAULT_DISPLAY_DENSITY: DisplayDensity = "default";

export function parseDisplayDensity(value: unknown): DisplayDensity {
  return value === "compact" || value === "default"
    ? value
    : DEFAULT_DISPLAY_DENSITY;
}
