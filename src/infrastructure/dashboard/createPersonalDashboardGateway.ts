import { isTauri } from "@tauri-apps/api/core";
import type { PersonalDashboardGateway } from "@/features/dashboard/PersonalDashboardGateway";
import { TauriPersonalDashboardGateway } from "./TauriPersonalDashboardGateway";

class UnavailablePersonalDashboardGateway implements PersonalDashboardGateway {
  async getPersonalDashboard() {
    return {
      viewerLogin: null,
      fetchedAt: new Date().toISOString(),
      lastSeenAt: null,
      unreadNewCount: 0,
      readyTaskCount: 0,
      unreadNotificationCount: 0,
      totalUnreadCount: 0,
      assigneeOptions: [],
      tasks: [],
      notifications: [],
      failures: [],
    };
  }

  async getDashboardLastSeenAt() {
    return null;
  }

  async markDashboardSeen(timestamp?: string | null) {
    return timestamp ?? new Date().toISOString();
  }
}

export function createPersonalDashboardGateway(
  detectDesktop: () => boolean = isTauri,
): PersonalDashboardGateway {
  return detectDesktop()
    ? new TauriPersonalDashboardGateway()
    : new UnavailablePersonalDashboardGateway();
}
