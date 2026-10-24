import { invoke, isTauri } from "@tauri-apps/api/core";
import type { HomeGateway, HomePreferences, HomeSnapshot } from "@/features/home/HomeGateway";
import { safeGithubUrl } from "@/features/home/home-data";
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export class TauriHomeGateway implements HomeGateway {
  constructor(private readonly call: Invoke = invoke, private readonly open?: (url: string) => Promise<void>) {}
  load(): Promise<HomeSnapshot> { return this.call("load_home") as Promise<HomeSnapshot>; }
  async configure(scopeKey: string, preferences: HomePreferences): Promise<void> { await this.call("configure_home", {scopeKey, preferences}); }
  async openExternal(url: string): Promise<void> { if (!safeGithubUrl(url)) throw new Error("GitHub 주소를 확인해 주세요."); if (this.open) await this.open(url); else await this.call("open_home_github_url", {url}); }
}
export function createHomeGateway(): HomeGateway {
  if (isTauri()) return new TauriHomeGateway();
  const unavailable = () => Promise.reject(new Error("실제 GitHub 데이터는 데스크톱 앱에서 확인할 수 있습니다."));
  return { load: unavailable, configure: unavailable, openExternal: unavailable };
}
