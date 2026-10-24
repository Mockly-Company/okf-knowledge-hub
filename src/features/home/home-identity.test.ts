import { expect, it } from "vitest";
import { homeIdentity } from "./home-identity";
import { workspaceFixtures } from "@/stories/fixtures/workspace";
it("changes ownership even when a new workspace or repository reuses the same local path",()=>{
 const workspace=workspaceFixtures.connectedWorkspace();
 const original=homeIdentity(1,workspace);
 expect(homeIdentity(2,workspace)).not.toBe(original);
 expect(homeIdentity(1,{...workspace,summary:{...workspace.summary,id:"other-workspace"}})).not.toBe(original);
 expect(homeIdentity(1,{...workspace,repository:{id:"other-repository",fullName:"other/docs"}})).not.toBe(original);
});
