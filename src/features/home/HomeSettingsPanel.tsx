import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/patterns/FormField";
import { SectionHeader } from "@/components/patterns/SectionHeader";
import { useHome } from "./HomeProvider";
import type { HomeConfiguration, HomePreferences } from "./HomeGateway";
function Form({configuration,save}:{configuration:HomeConfiguration;save(preferences:HomePreferences):Promise<void>}){
  const project=configuration.project;
  const [status,setStatus]=useState(configuration.preferences?.statusFieldId??"");
  const [options,setOptions]=useState(configuration.preferences?.inProgressOptionIds??[]);
  const [due,setDue]=useState(configuration.preferences?.dueDateFieldId??"");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [saved,setSaved]=useState(false);
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const submit=async()=>{if(!project)return;setBusy(true);setError("");setSaved(false);try{await save({projectId:project.id,statusFieldId:status,inProgressOptionIds:selectedOptions,dueDateFieldId:dueField?.id??null});if(mounted.current)setSaved(true);}catch{if(mounted.current)setError("홈 설정을 저장하지 못했습니다. 입력은 유지됩니다. 연결 상태를 확인하고 다시 시도해 주세요.");}finally{if(mounted.current)setBusy(false)}};
  const field=project?.fields.find(f=>f.id===status&&f.kind==="SINGLE_SELECT");
  const selectedOptions=options.filter(id=>field?.options.some(o=>o.id===id));
  const dueField=project?.fields.find(f=>f.id===due&&f.kind==="DATE");
  const canSave=!!project&&!!field&&selectedOptions.length>0;
  return <div className="grid max-w-[680px] gap-[var(--space-5)]"><SectionHeader title="홈 데이터" description="현재 워크스페이스의 저장소에서 내 리뷰 요청과 담당 Issue를 조회합니다. 프로젝트 요약은 아래 GitHub Project 전체를 기준으로 계산합니다."/>
    {project&&<FormField label="연결된 GitHub Project" description=".okf/workspace.yml에 연결된 Project를 사용합니다. 아래 필드 매핑은 이 기기의 현재 계정·워크스페이스에만 저장합니다."><Input value={project.url} readOnly/></FormField>}
    {!project&&<p>연결된 GitHub Project를 확인하지 못했습니다. 워크스페이스의 github.project 설정과 GitHub App의 Projects 조회 권한을 확인한 뒤 다시 불러와 주세요.</p>}
    {project&&<><strong>{project.title}</strong><FormField label="상태 필드" description="필드나 상태 이름으로 진행 중 여부를 추정하지 않습니다."><Select value={field?.id??""} disabled={busy} onValueChange={value=>{setStatus(value);setOptions([]);setSaved(false)}} placeholder="상태 필드 선택">{project.fields.filter(f=>f.kind==="SINGLE_SELECT").map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select></FormField>
    {field&&<fieldset disabled={busy} className="grid gap-[var(--space-2)] border-0 p-0"><legend className="mb-[var(--space-2)]">진행 중으로 계산할 상태</legend>{field.options.map(option=><label key={option.id} className="flex items-center gap-[var(--space-2)]"><Checkbox checked={options.includes(option.id)} onChange={e=>{setSaved(false);setOptions(previous=>e.target.checked?[...previous,option.id]:previous.filter(id=>id!==option.id))}}/>{option.name}</label>)}</fieldset>}
    <FormField label="마감일 필드" description="선택한 Project 날짜 필드만 사용합니다. 선택하지 않으면 마감일 없음으로 표시합니다."><Select value={dueField?.id??"none"} disabled={busy} onValueChange={value=>{setDue(value==="none"?"":value);setSaved(false)}}><option value="none">사용하지 않음</option>{project.fields.filter(f=>f.kind==="DATE").map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</Select></FormField>
    <div><Button loading={busy} disabled={!canSave} onClick={()=>void submit()}>홈 설정 저장</Button></div></>}
    {error&&<p role="alert">{error}</p>}{saved&&<p role="status">홈 설정을 저장했습니다.</p>}
  </div>;
}
export function HomeSettingsPanel(){const home=useHome();if(!home)return <p>홈 데이터 설정은 연결된 데스크톱 앱에서 사용할 수 있습니다.</p>;if(!home.snapshot)return <div><p role="status">{home.busy?"홈 설정을 불러오는 중입니다.":"홈 설정을 불러오지 못했습니다."}</p><Button variant="secondary" disabled={home.busy} onClick={()=>void home.refresh()}>다시 시도</Button></div>;return <><Form key={home.snapshot.scopeKey} configuration={home.snapshot.configuration} save={home.configure}/>{!home.snapshot.configuration.project&&<Button variant="secondary" disabled={home.busy} onClick={()=>void home.refresh()}>홈 설정 다시 불러오기</Button>}</>}
