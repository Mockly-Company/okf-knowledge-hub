import type {
  DocumentAsset,
  DocumentContent,
  DocumentEventEnvelope,
  DocumentSearchResponse,
  DocumentSessionSnapshot,
  HistoryCursor,
  HistoryPage,
  Unlisten,
} from "./model";

export interface DocumentsGateway {
  startSession(requestId: string): Promise<DocumentSessionSnapshot>;
  stopSession(sessionId: string): Promise<void>;
  refreshSession(sessionId: string): Promise<void>;
  searchDocuments(
    sessionId: string,
    requestId: string,
    query: string,
    limit: number,
  ): Promise<DocumentSearchResponse>;
  readDocument(sessionId: string, path: string): Promise<DocumentContent>;
  readDocumentAsset(
    sessionId: string,
    documentPath: string,
    assetPath: string,
  ): Promise<DocumentAsset>;
  listDocumentHistory(
    sessionId: string,
    path: string,
    cursor: HistoryCursor | null,
  ): Promise<HistoryPage>;
  readDocumentVersion(
    sessionId: string,
    commitOid: string,
    pathAtCommit: string,
  ): Promise<DocumentContent>;
  onDocumentEvent(
    listener: (event: DocumentEventEnvelope) => void,
  ): Promise<Unlisten>;
  copyText(value: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}
