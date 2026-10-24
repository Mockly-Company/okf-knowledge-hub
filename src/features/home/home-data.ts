import { analyzeHomeProject, type HomeInsightData } from "@/pages/home/HomeInsights";
import type { HomeTaskData } from "@/pages/home/HomeTasks";
import type { HomeSnapshot } from "./HomeGateway";
export function safeGithubUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port; } catch { return false; }
}
export function toHomeData(snapshot: HomeSnapshot): {tasks: HomeTaskData; insights: HomeInsightData} {
  const updatedAt = new Date(snapshot.asOfUnixMs).toISOString();
  const tasks: HomeTaskData = { status: snapshot.tasksError ? "error" : snapshot.reviews.length + snapshot.issues.length ? "ready" : "empty", updatedAt, reviews: snapshot.tasksError ? [] : snapshot.reviews, issues: snapshot.tasksError ? [] : snapshot.issues };
  const insights: HomeInsightData = snapshot.analysisError ? {status: "error", groups: []} : snapshot.analysis ? analyzeHomeProject({...snapshot.analysis, asOf: updatedAt}) : {status: "unavailable", groups: []};
  return { tasks, insights };
}
