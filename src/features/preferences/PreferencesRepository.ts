import type { DisplayDensity } from "./display-density";

export interface PreferencesRepository {
  getDisplayDensity(): Promise<DisplayDensity>;
  setDisplayDensity(value: DisplayDensity): Promise<void>;
}
