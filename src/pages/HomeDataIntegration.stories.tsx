import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import { Route, Routes } from "react-router-dom";
import { withAppProviders } from "@/stories/decorators/AppProviders";
import { AppShell } from "@/components/patterns/AppShell";
import { HomeProvider } from "@/features/home/HomeProvider";
import { ConnectedHomePage } from "@/features/home/ConnectedHomePage";
import { FakeHomeGateway } from "@/stories/fixtures/FakeHomeGateway";
function Preview({failRefresh=false}:{failRefresh?:boolean}){
  const gateway=useMemo(()=>new FakeHomeGateway(failRefresh),[failRefresh]);
  return <HomeProvider identity="storybook" gateway={gateway}><Routes><Route element={<AppShell/>}><Route index element={<ConnectedHomePage/>}/></Route></Routes></HomeProvider>;
}
const meta={id:"pages-home-data-integration",title:"화면/홈 실제 연결 구성",component:Preview,decorators:[withAppProviders()],parameters:{layout:"fullscreen",docs:{description:{component:"실제 HomeProvider·ConnectedHomePage·AppShell을 동일 계약의 fake gateway와 사용합니다. 예시는 실제 GitHub 조회 결과가 아니며 제품 앱은 TauriHomeGateway를 사용합니다."}}}} satisfies Meta<typeof Preview>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Default:Story={};
export const RefreshRecoveryTest:Story={args:{failRefresh:true},tags:["!dev","!autodocs"],play:async({canvas})=>{
  await expect(await canvas.findByRole("link",{name:/지도 검색 API 계약/})).toBeVisible();
  await userEvent.click(canvas.getByRole("button",{name:"새로고침"}));
  await waitFor(()=>expect(canvas.getAllByText(/저장된/).length).toBeGreaterThan(0));
  await expect(canvas.getByRole("heading",{name:"내 작업"})).toBeVisible();
}};
