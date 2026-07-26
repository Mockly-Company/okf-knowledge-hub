import { isTauri } from "@tauri-apps/api/core";
import type { WorkspaceConnectionGateway } from "@/features/workspace-connection/WorkspaceConnectionGateway";
import { TauriWorkspaceConnectionGateway } from "./TauriWorkspaceConnectionGateway";
import { UnavailableWorkspaceConnectionGateway } from "./UnavailableWorkspaceConnectionGateway";

export function createWorkspaceConnectionGateway(
  detectDesktop: () => boolean = isTauri,
): WorkspaceConnectionGateway {
  return detectDesktop()
    ? new TauriWorkspaceConnectionGateway()
    : new UnavailableWorkspaceConnectionGateway();
}
