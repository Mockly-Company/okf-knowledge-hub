import type { HomeGateway, HomePreferences, HomeSnapshot } from "@/features/home/HomeGateway";
import { homeTaskExample } from "./home-tasks";
/** Simulation is confined to Storybook. Production never imports this gateway. */
export class FakeHomeGateway implements HomeGateway {
  calls=0; opened:string[]=[];
  constructor(private readonly failRefresh=false){}
  async load():Promise<HomeSnapshot>{
    if(this.calls++>0&&this.failRefresh)throw new Error("simulated offline");
    const tasks=homeTaskExample("ready","many");
    const reference={id:"project-pr",title:"지도 검색 API 계약",repository:"Mockly-Company/okf-knowledge-hub",number:42,url:"https://github.com/Mockly-Company/okf-knowledge-hub/pull/42"};
    return {scopeKey:"storybook-home",asOfUnixMs:Date.parse("2026-10-24T12:00:00Z"),reviews:tasks.reviews.map(r=>({...r,url:`https://github.com/${r.repository}/pull/${r.number}`})),issues:tasks.issues,tasksError:false,analysisError:false,
      analysis:{projectName:"Mockly 제품 개발",complete:true,pendingReviews:[{...reference,requestedAt:"2026-10-20T12:00:00Z"}],inProgressIssues:[{...reference,id:"project-issue",number:12,url:"https://github.com/Mockly-Company/okf-knowledge-hub/issues/12",updatedAt:"2026-10-16T12:00:00Z"}],completed:[{...reference,id:"merged-pr",kind:"pr",completedAt:"2026-10-23T12:00:00Z"}]},
      configuration:{project:{id:"P",title:"Mockly 제품 개발",url:"https://github.com/orgs/Mockly-Company/projects/1",fields:[{id:"S",name:"상태",kind:"SINGLE_SELECT",options:[{id:"W",name:"진행 중"}]},{id:"D",name:"마감일",kind:"DATE",options:[]}]},preferences:{projectId:"P",statusFieldId:"S",inProgressOptionIds:["W"],dueDateFieldId:"D"}}};
  }
  async configure(_scope:string,_preferences:HomePreferences):Promise<void>{}
  async openExternal(url:string):Promise<void>{this.opened.push(url)}
}
