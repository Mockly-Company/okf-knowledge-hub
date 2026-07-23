import { load, type Store } from "@tauri-apps/plugin-store";
import {
  parseDisplayDensity,
  type DisplayDensity,
} from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

const DISPLAY_DENSITY_KEY = "display-density";

export class TauriPreferencesRepository implements PreferencesRepository {
  private readonly store: Promise<Store> = load("settings.json", {
    autoSave: false,
  });

  async getDisplayDensity(): Promise<DisplayDensity> {
    const store = await this.store;
    return parseDisplayDensity(await store.get(DISPLAY_DENSITY_KEY));
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    const store = await this.store;
    await store.set(DISPLAY_DENSITY_KEY, value);
    await store.save();
  }
}
