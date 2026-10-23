export interface BuildInfo {
  mode: "development" | "release";
  branch: string;
  commit: string;
  dirty: boolean;
  credentialBackend: string;
}

export interface BuildInfoGateway {
  getBuildInfo(): Promise<BuildInfo>;
}
