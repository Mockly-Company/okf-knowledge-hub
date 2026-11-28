import { expect, it } from "vitest";
import { FakeDocumentsGateway } from "./FakeDocumentsGateway";

it("reads distinct fixture bodies for the same relative path in different repositories", async () => {
  const gateway = new FakeDocumentsGateway();
  gateway.markdownByPath = {
    "docs/api/guide.md": "# Primary\n\nPrimary repository body.",
    "repo:team/handbook/docs/api/guide.md": "# Handbook\n\nSecondary repository body.",
  };
  const primary = await gateway.readDocument("session", "primary", "docs/api/guide.md");
  const secondary = await gateway.readDocument("session", "secondary", "repo:team/handbook/docs/api/guide.md");
  expect(primary.markdown).toBe("# Primary\n\nPrimary repository body.");
  expect(secondary.markdown).toBe("# Handbook\n\nSecondary repository body.");
});

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
