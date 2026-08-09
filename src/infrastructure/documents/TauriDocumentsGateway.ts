import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import type {
  DocumentAsset,
  DocumentContent,
  DocumentEventEnvelope,
  DocumentSearchResponse,
  DocumentSessionSnapshot,
  HistoryCursor,
  HistoryPage,
  Unlisten,
} from "@/features/documents/model";

type InvokeDesktop = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
type ListenDocuments = (
  event: string,
  listener: (event: { payload: DocumentEventEnvelope }) => void,
) => Promise<Unlisten>;
type CopyText = (value: string) => Promise<void>;
type OpenExternal = (url: string) => Promise<void>;

const invokeDesktop: InvokeDesktop = (command, args) => invoke(command, args);
const listenDocuments: ListenDocuments = (event, listener) =>
  listen<DocumentEventEnvelope>(event, listener);
const copyText: CopyText = (value) => writeText(value);
const openExternal: OpenExternal = (url) => openUrl(url);

export class TauriDocumentsGateway implements DocumentsGateway {
  constructor(
    private readonly invokeCommand: InvokeDesktop = invokeDesktop,
    private readonly listenEvent: ListenDocuments = listenDocuments,
    private readonly writeClipboard: CopyText = copyText,
    private readonly launchExternal: OpenExternal = openExternal,
  ) {}

  startSession(requestId: string): Promise<DocumentSessionSnapshot> {
    return this.invokeCommand("start_document_session", { requestId });
  }

  stopSession(sessionId: string): Promise<void> {
    return this.invokeCommand("stop_document_session", { sessionId });
  }

  refreshSession(sessionId: string): Promise<void> {
    return this.invokeCommand("refresh_document_session", { sessionId });
  }

  searchDocuments(
    sessionId: string,
    requestId: string,
    query: string,
    limit: number,
  ): Promise<DocumentSearchResponse> {
    return this.invokeCommand("search_documents", {
      sessionId,
      requestId,
      query,
      limit,
    });
  }

  readDocument(sessionId: string, path: string): Promise<DocumentContent> {
    return this.invokeCommand("read_document", { sessionId, path });
  }

  readDocumentAsset(
    sessionId: string,
    documentPath: string,
    assetPath: string,
  ): Promise<DocumentAsset> {
    return this.invokeCommand("read_document_asset", {
      sessionId,
      documentPath,
      assetPath,
    });
  }

  listDocumentHistory(
    sessionId: string,
    path: string,
    cursor: HistoryCursor | null,
  ): Promise<HistoryPage> {
    return this.invokeCommand("list_document_history", {
      sessionId,
      path,
      cursor,
    });
  }

  readDocumentVersion(
    sessionId: string,
    commitOid: string,
    pathAtCommit: string,
  ): Promise<DocumentContent> {
    return this.invokeCommand("read_document_version", {
      sessionId,
      commitOid,
      pathAtCommit,
    });
  }

  onDocumentEvent(
    listener: (event: DocumentEventEnvelope) => void,
  ): Promise<Unlisten> {
    return this.listenEvent("okhub://documents/event", ({ payload }) => {
      listener(payload);
    });
  }

  copyText(value: string): Promise<void> {
    return this.writeClipboard(value);
  }

  openExternal(url: string): Promise<void> {
    return this.launchExternal(url);
  }
}
