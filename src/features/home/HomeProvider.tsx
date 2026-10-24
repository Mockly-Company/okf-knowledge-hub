import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HomeGateway, HomePreferences, HomeSnapshot } from "./HomeGateway";
import { toHomeData } from "./home-data";
import type { HomeTaskData } from "@/pages/home/HomeTasks";
import type { HomeInsightData } from "@/pages/home/HomeInsights";
interface Data {identity:string; snapshot:HomeSnapshot|null; tasks:HomeTaskData; insights:HomeInsightData; busy:boolean; error:boolean}
const initial = (identity:string):Data => ({identity,snapshot:null,tasks:{status:identity?"loading":"unavailable",reviews:[],issues:[]},insights:{status:identity?"loading":"unavailable",groups:[]},busy:!!identity,error:false});
const usable = (status:string) => ["ready","empty","stale"].includes(status);
function accept(previous:Data,snapshot:HomeSnapshot):Data {
  const projected=toHomeData(snapshot);
  const same=previous.snapshot?.scopeKey===snapshot.scopeKey && JSON.stringify(previous.snapshot.configuration.preferences)===JSON.stringify(snapshot.configuration.preferences);
  return {...previous,snapshot,busy:false,error:snapshot.tasksError||snapshot.analysisError,
    tasks:projected.tasks.status==="error"&&same&&usable(previous.tasks.status)?{...previous.tasks,status:"stale"}:projected.tasks,
    insights:projected.insights.status==="error"&&same&&usable(previous.insights.status)?{...previous.insights,status:"stale"}:projected.insights};
}
interface HomeContext extends Data {refresh():Promise<void>; configure(preferences:HomePreferences):Promise<void>; gateway:HomeGateway}
const Context=createContext<HomeContext|null>(null);
export function HomeProvider({identity,gateway,children}:{identity:string;gateway:HomeGateway;children:ReactNode}){
  const [state,setState]=useState(()=>initial(identity));
  const current=useRef(identity);current.current=identity;
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const token=++generation.current;const owner=identity;
    if(!owner){setState(initial(owner));return}
    setState(old=>old.identity===owner?{...old,busy:true}:initial(owner));
    try {const result=await gateway.load();if(current.current!==owner||generation.current!==token)return;setState(old=>accept(old.identity===owner?old:initial(owner),result));}
    catch {if(current.current!==owner||generation.current!==token)return;setState(old=>({...old,busy:false,error:true,tasks:usable(old.tasks.status)?{...old.tasks,status:"stale"}:{status:"error",reviews:[],issues:[]},insights:usable(old.insights.status)?{...old.insights,status:"stale"}:{status:"error",groups:[]}}));}
  },[identity,gateway]);
  useEffect(()=>{void refresh();return()=>{generation.current++}},[refresh]);
  const visible=state.identity===identity?state:initial(identity);
  const configure=async(preferences:HomePreferences)=>{
    const owner=identity;const scope=visible.snapshot?.scopeKey;if(!owner||!scope)throw new Error("홈을 다시 불러와 주세요.");
    await gateway.configure(scope,preferences);
    if(current.current!==owner)return;
    setState(initial(owner));await refresh();
  };
  return <Context.Provider value={{...visible,refresh,configure,gateway}}>{children}</Context.Provider>;
}
export const useHome=()=>useContext(Context);
