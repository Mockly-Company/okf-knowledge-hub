import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import type {
  AppError,
  DocumentAsset,
  DocumentContent,
  DocumentEventEnvelope,
  DocumentSearchResponse,
  DocumentSessionSnapshot,
  HistoryCursor,
  HistoryPage,
  Unlisten,
} from "@/features/documents/model";

const DESKTOP_ONLY_MESSAGE =
  "문서 탐색은 OkHub 데스크톱 앱에서 사용할 수 있습니다.";

export function documentsDesktopOnlyError(): AppError {
  return {
    code: "desktop_only",
    message: DESKTOP_ONLY_MESSAGE,
    recovery: null,
    details: {},
  };
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(documentsDesktopOnlyError());
}

export class UnavailableDocumentsGateway implements DocumentsGateway {
  startSession(_requestId: string): Promise<DocumentSessionSnapshot> {
    return unavailable();
  }

  stopSession(_sessionId: string): Promise<void> {
    return unavailable();
  }

  refreshSession(_sessionId: string): Promise<void> {
    return unavailable();
  }

  searchDocuments(
    _sessionId: string,
    _requestId: string,
    _query: string,
    _limit: number,
  ): Promise<DocumentSearchResponse> {
    return unavailable();
  }

  readDocument(
    _sessionId: string,
    _requestId: string,
    _path: string,
  ): Promise<DocumentContent> {
    return unavailable();
  }

  readDocumentAsset(
    _sessionId: string,
    _documentPath: string,
    _assetPath: string,
  ): Promise<DocumentAsset> {
    return unavailable();
  }

  listDocumentHistory(
    _sessionId: string,
    _path: string,
    _cursor: HistoryCursor | null,
  ): Promise<HistoryPage> {
    return unavailable();
  }

  readDocumentVersion(
    _sessionId: string,
    _requestId: string,
    _commitOid: string,
    _pathAtCommit: string,
  ): Promise<DocumentContent> {
    return unavailable();
  }

  onDocumentEvent(
    _listener: (event: DocumentEventEnvelope) => void,
  ): Promise<Unlisten> {
    return unavailable();
  }

  copyText(_value: string): Promise<void> {
    return unavailable();
  }

  openExternal(_url: string): Promise<void> {
    return unavailable();
  }
}
