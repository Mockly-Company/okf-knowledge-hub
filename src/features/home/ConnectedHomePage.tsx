import { useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HomePage } from "@/pages/HomePage";
import { useHome } from "./HomeProvider";
import { safeGithubUrl } from "./home-data";
export function ConnectedHomePage(){
  const home=useHome();const [openError,setOpenError]=useState(false);
  if(!home)return <HomePage/>;
  const open=(event:MouseEvent<HTMLDivElement>)=>{
    const anchor=(event.target as Element).closest('a[target="_blank"]');
    if(!anchor)return;event.preventDefault();
    const url=anchor.getAttribute("href")??"";
    if(!safeGithubUrl(url)){setOpenError(true);return}
    setOpenError(false);void home.gateway.openExternal(url).catch(()=>setOpenError(true));
  };
  const actions=<><Button variant="secondary" loading={home.busy} onClick={()=>void home.refresh()}><RefreshCw aria-hidden="true"/>새로고침</Button>{(!home.snapshot?.configuration.project||!home.snapshot.configuration.preferences)&&<Button asChild variant="ghost"><Link to="/settings?category=home">홈 데이터 설정</Link></Button>}</>;
  return <div onClick={open} className="home-connected h-full min-h-0"><HomePage tasks={home.tasks} insights={home.insights} actions={actions} notice={openError?<p role="alert">GitHub 페이지를 열지 못했습니다. 다시 시도해 주세요.</p>:undefined}/></div>;
}
