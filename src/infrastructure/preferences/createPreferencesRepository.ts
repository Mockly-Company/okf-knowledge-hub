import { isTauri } from "@tauri-apps/api/core";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";
import { BrowserPreferencesRepository } from "./BrowserPreferencesRepository";
import { TauriPreferencesRepository } from "./TauriPreferencesRepository";

export function createPreferencesRepository(): PreferencesRepository {
  return isTauri()
    ? new TauriPreferencesRepository()
    : new BrowserPreferencesRepository(window.localStorage);
}
