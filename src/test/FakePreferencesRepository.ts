import type { DisplayDensity } from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

export class FakePreferencesRepository implements PreferencesRepository {
  public writes: DisplayDensity[] = [];

  constructor(private value: DisplayDensity = "default") {}

  async getDisplayDensity(): Promise<DisplayDensity> {
    return this.value;
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    this.value = value;
    this.writes.push(value);
  }
}
