import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeProvider, useHome } from "./HomeProvider";
import type { HomeGateway, HomeSnapshot } from "./HomeGateway";
afterEach(cleanup);
const snapshot = (scopeKey="scope-a"): HomeSnapshot => ({scopeKey,asOfUnixMs:Date.parse("2026-10-24T12:00:00Z"),reviews:[],issues:[],tasksError:false,analysis:null,analysisError:false,configuration:{project:null,preferences:null}});
function Probe(){ const h=useHome()!;return <><p>{h.tasks.status}</p><p>{h.tasks.reviews.map(r=>r.title).join(",")}</p><button onClick={()=>void h.refresh()}>refresh</button></> }
const gateway = (load:HomeGateway["load"]):HomeGateway => ({load,configure:vi.fn(),openExternal:vi.fn()});
describe("Home account and workspace ownership",()=>{
  it("does not show a previous account response after identity changes",async()=>{
    let finish!:(v:HomeSnapshot)=>void;
    const load=vi.fn().mockImplementationOnce(()=>new Promise<HomeSnapshot>(r=>{finish=r})).mockResolvedValue(snapshot("scope-b"));
    const g=gateway(load);const {rerender}=render(<HomeProvider identity="account-a" gateway={g}><Probe/></HomeProvider>);
    await waitFor(()=>expect(load).toHaveBeenCalledTimes(1));
    rerender(<HomeProvider identity="account-b" gateway={g}><Probe/></HomeProvider>);
    await screen.findByText("empty");
    await act(async()=>finish({...snapshot(),reviews:[{id:"old",title:"다른 계정의 비공개 PR",repository:"org/private",number:1,url:"https://github.com/org/private/pull/1",requester:"x",updatedAt:"2026-10-24"}]}));
    expect(screen.queryByText(/다른 계정/)).not.toBeInTheDocument();
  });
  it("preserves a same-scope successful result as stale when refresh fails",async()=>{
    const load=vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error("offline"));
    render(<HomeProvider identity="a" gateway={gateway(load)}><Probe/></HomeProvider>);await screen.findByText("empty");
    await act(async()=>screen.getByRole("button").click());await screen.findByText("stale");
  });
  it("does not retain data when backend scope changed on a partial failure",async()=>{
    const old={...snapshot(),reviews:[{id:"old",title:"old",repository:"org/private",number:1,url:"https://github.com/org/private/pull/1",requester:"x",updatedAt:"2026-10-24"}]};
    const load=vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce({...snapshot("new-workspace-config"),tasksError:true});
    render(<HomeProvider identity="a" gateway={gateway(load)}><Probe/></HomeProvider>);await screen.findByText("old");
    await act(async()=>screen.getByRole("button").click());await screen.findByText("error");expect(screen.queryByText("old")).not.toBeInTheDocument();
  });
});
