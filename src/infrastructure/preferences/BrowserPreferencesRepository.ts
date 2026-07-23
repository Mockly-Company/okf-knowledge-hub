import {
  parseDisplayDensity,
  type DisplayDensity,
} from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

const DISPLAY_DENSITY_KEY = "okhub.display-density";

export class BrowserPreferencesRepository implements PreferencesRepository {
  constructor(private readonly storage: Storage) {}

  async getDisplayDensity(): Promise<DisplayDensity> {
    return parseDisplayDensity(this.storage.getItem(DISPLAY_DENSITY_KEY));
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    this.storage.setItem(DISPLAY_DENSITY_KEY, value);
  }
}
