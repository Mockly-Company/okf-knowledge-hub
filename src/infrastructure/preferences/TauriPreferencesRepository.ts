import { invoke } from "@tauri-apps/api/core";
import {
  parseDisplayDensity,
  type DisplayDensity,
} from "@/features/preferences/display-density";
import type { PreferencesRepository } from "@/features/preferences/PreferencesRepository";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriPreferencesRepository implements PreferencesRepository {
  constructor(private readonly invokeDesktop: InvokeCommand = invokeCommand) {}

  async getDisplayDensity(): Promise<DisplayDensity> {
    return parseDisplayDensity(await this.invokeDesktop("get_display_density"));
  }

  async setDisplayDensity(value: DisplayDensity): Promise<void> {
    await this.invokeDesktop("set_display_density", { density: value });
  }
}
