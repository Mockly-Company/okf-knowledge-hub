export type ErrorCode =
  | "authentication_expired"
  | "authentication_denied"
  | "reauthentication_required"
  | "credential_store_unavailable"
  | "github_permission_denied"
  | "github_unavailable"
  | "repository_path_conflict"
  | "repository_remote_mismatch"
  | "repository_dirty"
  | "clone_failed"
  | "workspace_missing"
  | "workspace_invalid"
  | "workspace_version_unsupported"
  | "workspace_changed_since_preview"
  | "document_path_invalid"
  | "document_history_invalid"
  | "document_asset_too_large"
  | "document_session_conflict"
  | "document_session_stale"
  | "document_index_unavailable"
  | "push_failed"
  | "draft_pull_request_failed"
  | "local_settings_unavailable"
  | "desktop_only";

export type RecoveryAction =
  | "restart_login"
  | "reinstall_github_app"
  | "choose_another_directory"
  | "connect_existing_clone"
  | "clean_working_tree"
  | "open_workspace_file"
  | "update_okhub"
  | "retry";

export interface AppError {
  code: ErrorCode;
  message: string;
  recovery: RecoveryAction | null;
  details: Record<string, string>;
}

export interface DocumentSummary {
  path: string;
  fileName: string;
  title: string;
  documentId: string | null;
  frontmatterStatus: FrontmatterStatus;
  modifiedAtUnixMs: number;
  size: number;
}

export type FrontmatterStatus =
  | { status: "valid" }
  | { status: "missing" }
  | { status: "invalid"; error: FrontmatterError };

export interface FrontmatterError {
  line: number;
  message: string;
}

export type DocumentTreeEntry =
  | {
      kind: "folder";
      name: string;
      path: string;
      children: DocumentTreeEntry[];
    }
  | { kind: "document"; summary: DocumentSummary };

export interface DocumentCatalog {
  documents: DocumentSummary[];
  roots: DocumentTreeEntry[];
}

export type IndexStatus =
  | { status: "preparing"; indexed: number; total: number }
  | { status: "ready" }
  | { status: "degraded"; message: string };

export type SearchMatchField = "title" | "path" | "body";

export interface SearchResult {
  path: string;
  title: string;
  matchField: SearchMatchField;
  matchText: string;
  snippet: string;
}

export interface DocumentSearchResponse {
  sessionId: string;
  requestId: string;
  items: SearchResult[];
}

export interface TableOfContentsItem {
  level: number;
  title: string;
  id: string;
}

export interface DocumentCommitSummary {
  commitOid: string;
  shortOid: string;
  authorName: string;
  authoredAtUnix: number;
  message: string;
}

export interface DocumentContent {
  summary: DocumentSummary;
  markdown: string;
  properties: unknown;
  tableOfContents: TableOfContentsItem[];
  lastCommit: DocumentCommitSummary | null;
}

export type DocumentAsset =
  | { kind: "raster"; mimeType: string; base64: string }
  | { kind: "svg"; source: string };

export interface HistoryCursor {
  beforeCommitOid: string;
  trackedPath: string;
}

export interface HistoryItem {
  commitOid: string;
  shortOid: string;
  pathAtCommit: string;
  authorName: string;
  authoredAtUnix: number;
  message: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: HistoryCursor | null;
}

export interface DocumentSessionStateSnapshot {
  sessionId: string;
  catalog: DocumentCatalog;
  indexStatus: IndexStatus;
  lastOpenedPath: string | null;
}

export interface DocumentSessionSnapshot extends DocumentSessionStateSnapshot {
  revision: number;
  workspaceId: string;
  repositoryFullName: string;
  branch: string;
}

export type DocumentEvent =
  | {
      type: "tree_changed";
      sessionId: string;
      catalog: DocumentCatalog;
    }
  | {
      type: "index_status_changed";
      sessionId: string;
      status: IndexStatus;
    }
  | {
      type: "open_document_changed";
      sessionId: string;
      path: string;
    }
  | { type: "failed"; sessionId: string; error: AppError }
  | {
      type: "resynced";
      sessionId: string;
      barrierId: string;
      snapshot: DocumentSessionStateSnapshot;
    };

/** Task 9 serializes the event with `#[serde(flatten)]`. */
export type DocumentEventEnvelope = DocumentEvent & { revision: number };

export type Unlisten = () => void;
