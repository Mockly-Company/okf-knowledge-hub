import { expect, it, vi } from "vitest";
import { TauriHomeGateway } from "./TauriHomeGateway";
it("uses the production Tauri commands without accepting a frontend identity or token",async()=>{
  const invoke=vi.fn().mockResolvedValue({});const open=vi.fn();const gateway=new TauriHomeGateway(invoke,open);
  await gateway.load();
  const prefs={projectId:"P",statusFieldId:"S",inProgressOptionIds:["W"],dueDateFieldId:null};await gateway.configure("scope",prefs);
  expect(invoke.mock.calls).toEqual([["load_home"],["configure_home",{scopeKey:"scope",preferences:prefs}]]);
  await expect(gateway.openExternal("https://github.com.evil.test/x")).rejects.toThrow();expect(open).not.toHaveBeenCalled();
  await gateway.openExternal("https://github.com/acme/docs/pull/1");expect(open).toHaveBeenCalledWith("https://github.com/acme/docs/pull/1");
});
