import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ConnectedHomePage } from "./ConnectedHomePage";
import { HomeProvider } from "./HomeProvider";
import type { HomeGateway, HomeSnapshot } from "./HomeGateway";
vi.mock("@/features/workspace-connection/WorkspaceConnectionProvider",()=>({useWorkspaceConnection:()=>({account:{status:"authenticated",user:{id:1,login:"alice"}}})}));
afterEach(cleanup);
it("renders the approved Home with actual gateway results and opens the selected GitHub item via the desktop port",async()=>{
  const data:HomeSnapshot={scopeKey:"scope",asOfUnixMs:Date.parse("2026-10-24T12:00:00Z"),reviews:[{id:"PR",title:"검토할 실제 문서",repository:"acme/docs",number:3,url:"https://github.com/acme/docs/pull/3",requester:"bob",requestedAt:"2026-10-20T12:00:00Z",updatedAt:"2026-10-24T12:00:00Z"}],issues:[],tasksError:false,analysis:null,analysisError:false,configuration:{project:null,preferences:null}};
  const g:HomeGateway={load:vi.fn().mockResolvedValue(data),openExternal:vi.fn().mockResolvedValue(undefined),configure:vi.fn()};
  render(<MemoryRouter><HomeProvider identity="a" gateway={g}><ConnectedHomePage/></HomeProvider></MemoryRouter>);
  const link=await screen.findByRole("link",{name:/검토할 실제 문서/});expect(link).toHaveAttribute("href",data.reviews[0].url);
  await userEvent.click(link);await waitFor(()=>expect(g.openExternal).toHaveBeenCalledWith(data.reviews[0].url));
  expect(screen.getByRole("heading",{name:"내 작업"})).toBeInTheDocument();expect(screen.getByRole("link",{name:"홈 데이터 설정"})).toHaveAttribute("href","/settings?category=home");
});
