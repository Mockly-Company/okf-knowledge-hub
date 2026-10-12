import { expect, it } from "vitest";
import { FakeDocumentsGateway } from "./FakeDocumentsGateway";

it("models repeated document creation with numbered paths like the Rust gateway", async () => {
  const gateway = new FakeDocumentsGateway();
  const input = { sessionId: gateway.sessionSnapshot.sessionId, requestId: "request", title: "지도 API", fileName: "지도 API", folder: "docs/api", templateId: "builtin:blank", separateChange: false };
  const first = await gateway.createDocumentDraft(input);
  const validation = await gateway.validateDocumentCreation(input.sessionId, input.folder, input.fileName);
  expect(first.document.path).toBe("docs/api/지도-api.md");
  expect(validation.hasCollision).toBe(true);
  expect(validation.suggestedFileName).toBe("지도-api-2.md");
  const second = await gateway.createDocumentDraft(input);
  expect(second.document.path).toBe("docs/api/지도-api-2.md");
});
