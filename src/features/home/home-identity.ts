import type { ConnectedWorkspace } from "@/features/workspace-connection/types";
/** A path can be reused for another workspace or remote repository. */
export function homeIdentity(userId:number,workspace:ConnectedWorkspace):string {
  return JSON.stringify([userId,workspace.summary.id,workspace.path,workspace.repository?.id,workspace.repository?.fullName]);
}
