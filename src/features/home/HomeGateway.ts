import type { ProjectAnalysisSource } from "@/pages/home/HomeInsights";
import type { ReviewTask, IssueTask } from "@/pages/home/HomeTasks";
export interface ProjectField { id: string; name: string; kind: string; options: {id: string; name: string}[] }
export interface HomeProject { id: string; title: string; url: string; fields: ProjectField[] }
export interface HomePreferences { projectId: string; statusFieldId: string; inProgressOptionIds: string[]; dueDateFieldId: string | null }
export interface HomeConfiguration { project: HomeProject | null; preferences: HomePreferences | null }
export interface HomeSnapshot {
  scopeKey: string; asOfUnixMs: number; reviews: (ReviewTask & {url: string})[]; issues: IssueTask[];
  tasksError: boolean; analysis: Omit<ProjectAnalysisSource, "asOf"> | null; analysisError: boolean;
  configuration: HomeConfiguration;
}
export interface HomeGateway {
  load(): Promise<HomeSnapshot>;
  configure(scopeKey: string, preferences: HomePreferences): Promise<void>;
  openExternal(url: string): Promise<void>;
}
