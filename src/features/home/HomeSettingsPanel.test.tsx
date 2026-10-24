import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { HomeSettingsPanel } from "./HomeSettingsPanel";
import { HomeProvider } from "./HomeProvider";
import type { HomeGateway, HomeProject, HomeSnapshot } from "./HomeGateway";
afterEach(cleanup);
it("uses the existing Project read-only and saves only explicitly selected field IDs",async()=>{
  const project:HomeProject={id:"P",title:"Hub",url:"https://github.com/orgs/team/projects/1",fields:[{id:"S",name:"상태",kind:"SINGLE_SELECT",options:[{id:"W",name:"진행"}]},{id:"D",name:"날짜",kind:"DATE",options:[]}]};
  const data:HomeSnapshot={scopeKey:"scope",asOfUnixMs:0,reviews:[],issues:[],tasksError:false,analysis:null,analysisError:false,configuration:{project,preferences:null}};
  const g:HomeGateway={load:vi.fn().mockResolvedValue(data),configure:vi.fn().mockResolvedValue(undefined),openExternal:vi.fn()};
  render(<HomeProvider identity="a" gateway={g}><HomeSettingsPanel/></HomeProvider>);
  const user=userEvent.setup();const input=await screen.findByRole("textbox",{name:"연결된 GitHub Project"});expect(input).toHaveValue(project.url);expect(input).toHaveAttribute("readonly");
  const status=screen.getByRole("combobox",{name:"상태 필드"});await user.click(status);await user.click(await screen.findByRole("option",{name:"상태"}));
  expect(screen.getByRole("button",{name:"홈 설정 저장"})).toBeDisabled();
  await user.click(screen.getByRole("checkbox",{name:"진행"}));await user.click(screen.getByRole("button",{name:"홈 설정 저장"}));
  await waitFor(()=>expect(g.configure).toHaveBeenCalledWith("scope",{projectId:"P",statusFieldId:"S",inProgressOptionIds:["W"],dueDateFieldId:null}));
});
it("recovers when a saved Project option or date field was removed",async()=>{
  const project:HomeProject={id:"P",title:"Hub",url:"https://github.com/orgs/team/projects/1",fields:[{id:"S",name:"상태",kind:"SINGLE_SELECT",options:[{id:"new",name:"새 진행 상태"}]}]};
  const data:HomeSnapshot={scopeKey:"scope",asOfUnixMs:0,reviews:[],issues:[],tasksError:false,analysis:null,analysisError:true,configuration:{project,preferences:{projectId:"P",statusFieldId:"S",inProgressOptionIds:["removed"],dueDateFieldId:"removed-date"}}};
  const g:HomeGateway={load:vi.fn().mockResolvedValue(data),configure:vi.fn().mockResolvedValue(undefined),openExternal:vi.fn()};
  render(<HomeProvider identity="a" gateway={g}><HomeSettingsPanel/></HomeProvider>);
  const choice=await screen.findByRole("checkbox",{name:"새 진행 상태"});await userEvent.click(choice);
  const save=screen.getByRole("button",{name:"홈 설정 저장"});expect(save).toBeEnabled();await userEvent.click(save);
  await waitFor(()=>expect(g.configure).toHaveBeenCalledWith("scope",{projectId:"P",statusFieldId:"S",inProgressOptionIds:["new"],dueDateFieldId:null}));
});
