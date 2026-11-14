import type { PersonalDashboardResult } from "./model";

export interface GetPersonalDashboardOptions {
  forceSync?: boolean;
  assigneeFilter?: string | null;
  retryWorkspaceId?: string | null;
}

export interface PersonalDashboardGateway {
  getPersonalDashboard(
    options?: GetPersonalDashboardOptions,
  ): Promise<PersonalDashboardResult>;
  getDashboardLastSeenAt(): Promise<string | null>;
  markDashboardSeen(timestamp?: string | null): Promise<string>;
}
