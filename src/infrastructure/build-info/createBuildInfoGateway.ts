import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  BuildInfo,
  BuildInfoGateway,
} from "@/features/build-info/BuildInfoGateway";

class TauriBuildInfoGateway implements BuildInfoGateway {
  async getBuildInfo(): Promise<BuildInfo> {
    return invoke<BuildInfo>("get_build_info");
  }
}

class BrowserBuildInfoGateway implements BuildInfoGateway {
  async getBuildInfo(): Promise<BuildInfo> {
    return {
      mode: "development",
      branch: "browser-preview",
      commit: "unavailable",
      dirty: false,
      credentialBackend: "browser-preview",
    };
  }
}

export function createBuildInfoGateway(): BuildInfoGateway {
  return isTauri() ? new TauriBuildInfoGateway() : new BrowserBuildInfoGateway();
}
