import { describe, expect, it } from "vitest";
import type {
  DocumentEventEnvelope,
  DocumentSessionSnapshot,
} from "@/features/documents/model";
import { createDocumentsGateway } from "./createDocumentsGateway";
import { TauriDocumentsGateway } from "./TauriDocumentsGateway";
import { UnavailableDocumentsGateway } from "./UnavailableDocumentsGateway";

const SESSION_ID = "4b20eda7-09a0-46f9-bd3b-4de83d4b0157";
const REQUEST_ID = "34e1764e-4278-41f8-bcf8-9f74ff6f66e0";

describe("TauriDocumentsGateway", () => {
  it("maps all eight commands to their exact camelCase argument shapes", async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const invoke = async (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      return undefined as never;
    };
    const gateway = new TauriDocumentsGateway(
      invoke,
      async () => () => undefined,
      async () => undefined,
      async () => undefined,
    );
    const cursor = {
      beforeCommitOid: "0123456789abcdef",
      trackedPath: "docs/guide.md",
    };

    await gateway.startSession(REQUEST_ID);
    await gateway.stopSession(SESSION_ID);
    await gateway.refreshSession(SESSION_ID);
    await gateway.searchDocuments(SESSION_ID, REQUEST_ID, "api", 20);
    await gateway.readDocument(SESSION_ID, "docs/guide.md");
    await gateway.readDocumentAsset(
      SESSION_ID,
      "docs/guide.md",
      "assets/diagram.png",
    );
    await gateway.listDocumentHistory(
      SESSION_ID,
      "docs/guide.md",
      cursor,
    );
    await gateway.readDocumentVersion(
      SESSION_ID,
      "0123456789abcdef",
      "legacy/guide.md",
    );

    expect(calls).toEqual([
      {
        command: "start_document_session",
        args: { requestId: REQUEST_ID },
      },
      {
        command: "stop_document_session",
        args: { sessionId: SESSION_ID },
      },
      {
        command: "refresh_document_session",
        args: { sessionId: SESSION_ID },
      },
      {
        command: "search_documents",
        args: {
          sessionId: SESSION_ID,
          requestId: REQUEST_ID,
          query: "api",
          limit: 20,
        },
      },
      {
        command: "read_document",
        args: { sessionId: SESSION_ID, path: "docs/guide.md" },
      },
      {
        command: "read_document_asset",
        args: {
          sessionId: SESSION_ID,
          documentPath: "docs/guide.md",
          assetPath: "assets/diagram.png",
        },
      },
      {
        command: "list_document_history",
        args: {
          sessionId: SESSION_ID,
          path: "docs/guide.md",
          cursor,
        },
      },
      {
        command: "read_document_version",
        args: {
          sessionId: SESSION_ID,
          commitOid: "0123456789abcdef",
          pathAtCommit: "legacy/guide.md",
        },
      },
    ]);
  });

  it("listens on the exact event name and forwards the flattened payload", async () => {
    let eventName = "";
    let desktopListener:
      | ((event: { payload: DocumentEventEnvelope }) => void)
      | undefined;
    const gateway = new TauriDocumentsGateway(
      async () => undefined as never,
      async (name, listener) => {
        eventName = name;
        desktopListener = listener;
        return () => undefined;
      },
      async () => undefined,
      async () => undefined,
    );
    const received: DocumentEventEnvelope[] = [];
    await gateway.onDocumentEvent((event) => received.push(event));
    const payload: DocumentEventEnvelope = {
      revision: 7,
      type: "index_status_changed",
      sessionId: SESSION_ID,
      status: { status: "preparing", indexed: 2, total: 5 },
    };

    desktopListener?.({ payload });

    expect(eventName).toBe("okhub://documents/event");
    expect(received).toEqual([payload]);
  });

  it("uses the clipboard plugin and existing URL opener", async () => {
    const copied: string[] = [];
    const opened: string[] = [];
    const gateway = new TauriDocumentsGateway(
      async () => undefined as never,
      async () => () => undefined,
      async (value) => {
        copied.push(value);
      },
      async (url) => {
        opened.push(url);
      },
    );

    await gateway.copyText("docs/guide.md");
    await gateway.openExternal(
      "https://github.com/okf/example-knowledge/blob/main/docs/guide.md",
    );

    expect(copied).toEqual(["docs/guide.md"]);
    expect(opened).toEqual([
      "https://github.com/okf/example-knowledge/blob/main/docs/guide.md",
    ]);
  });
});

describe("createDocumentsGateway", () => {
  it("chooses desktop and browser implementations", () => {
    expect(createDocumentsGateway(() => true)).toBeInstanceOf(
      TauriDocumentsGateway,
    );
    expect(createDocumentsGateway(() => false)).toBeInstanceOf(
      UnavailableDocumentsGateway,
    );
  });

  it("returns a path- and token-free recoverable browser error", async () => {
    const gateway = new UnavailableDocumentsGateway();
    const secretPath = "/Users/person/private/ghu_secret/docs/guide.md";

    let rejected: unknown;
    try {
      await gateway.readDocument(SESSION_ID, secretPath);
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toEqual({
      code: "desktop_only",
      message: "문서 탐색은 OkHub 데스크톱 앱에서 사용할 수 있습니다.",
      recovery: null,
      details: {},
    });
    expect(JSON.stringify(rejected)).not.toContain(secretPath);
    expect(JSON.stringify(rejected)).not.toContain("ghu_secret");
  });
});
