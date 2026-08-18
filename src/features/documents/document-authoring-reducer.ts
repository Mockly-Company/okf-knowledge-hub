import type {
  AppError,
  CreateDocumentDraftResponse,
  CreatedDocument,
  DocumentTargetValidation,
  DocumentTemplateCatalog,
  DraftSummary,
  DuplicateTeamTemplateResponse,
  RecoveredDocument,
  SaveDocumentDraftResponse,
  SaveDocumentResult,
} from "./model";

export interface DocumentCreationInput {
  title: string;
  folder: string;
  fileName: string;
  templateId: string;
  separateChange: boolean;
}

export interface TeamTemplateCopyInput {
  sourceTemplateId: string;
  fileName: string;
  label: string;
  description: string | null;
  separateChange: boolean;
}

export type CreationStatus =
  | "idle"
  | "validation_queued"
  | "validating"
  | "collision"
  | "creation_queued"
  | "creating"
  | "ready"
  | "error";

export interface DocumentCreationState {
  status: CreationStatus;
  requestId: string | null;
  input: DocumentCreationInput | null;
  validation: DocumentTargetValidation | null;
  error: AppError | null;
}

export type EditorSaveStatus =
  | "saved"
  | "dirty"
  | "queued"
  | "saving"
  | "conflict"
  | "error";

export interface DocumentEditorState {
  document: CreatedDocument;
  markdown: string;
  savedMarkdown: string;
  contentHash: string;
  saveStatus: EditorSaveStatus;
  saveRequestId: string | null;
  saveSnapshot: string | null;
  conflict: Extract<SaveDocumentResult, { status: "conflict" }> | null;
  error: AppError | null;
  mode: "rich" | "source";
  closeAfterSave: boolean;
}

export interface DocumentAuthoringState {
  templatesStatus: "idle" | "loading" | "ready" | "error";
  templatesSessionId: string | null;
  templateCatalog: DocumentTemplateCatalog;
  drafts: DraftSummary[];
  activeChangeId: string | null;
  dialogOpen: boolean;
  defaultFolder: string;
  creation: DocumentCreationState;
  existingEdit: {
    status: "idle" | "queued" | "opening" | "error";
    requestId: string | null;
    path: string | null;
    title: string | null;
    error: AppError | null;
  };
  editor: DocumentEditorState | null;
  templateCopy: {
    status: "idle" | "queued" | "copying" | "saved" | "error";
    requestId: string | null;
    input: TeamTemplateCopyInput | null;
    path: string | null;
    error: AppError | null;
  };
  draftSwitch: {
    status: "idle" | "queued" | "switching" | "error";
    requestId: string | null;
    changeId: string | null;
    error: AppError | null;
  };
}

export type DocumentAuthoringAction =
  | { type: "templatesLoading"; sessionId: string }
  | {
      type: "templatesLoaded";
      sessionId: string;
      catalog: DocumentTemplateCatalog;
      drafts: DraftSummary[];
      activeBranch: string;
      recovery: RecoveredDocument | null;
    }
  | { type: "dialogOpened"; folder: string }
  | { type: "dialogClosed" }
  | {
      type: "creationRequested";
      requestId: string;
      input: DocumentCreationInput;
    }
  | { type: "validationStarted"; requestId: string }
  | {
      type: "validationSucceeded";
      requestId: string;
      validation: DocumentTargetValidation;
    }
  | { type: "creationStarted"; requestId: string }
  | {
      type: "creationSucceeded";
      requestId: string;
      response: CreateDocumentDraftResponse;
    }
  | { type: "creationFailed"; requestId: string; error: AppError }
  | {
      type: "existingEditRequested";
      requestId: string;
      path: string;
      title: string;
    }
  | { type: "existingEditStarted"; requestId: string }
  | {
      type: "existingEditSucceeded";
      requestId: string;
      response: CreateDocumentDraftResponse;
    }
  | { type: "existingEditFailed"; requestId: string; error: AppError }
  | { type: "editorChanged"; markdown: string }
  | { type: "editorModeChanged"; mode: "rich" | "source" }
  | { type: "saveQueued"; requestId: string; markdown: string }
  | { type: "saveStarted"; requestId: string }
  | {
      type: "saveSucceeded";
      requestId: string;
      response: SaveDocumentDraftResponse;
    }
  | { type: "saveFailed"; requestId: string; error: AppError }
  | { type: "conflictDiskAccepted" }
  | { type: "conflictHubAccepted" }
  | { type: "conflictMergeStarted" }
  | { type: "editorCloseRequested" }
  | { type: "templateCopyRequested"; requestId: string; input: TeamTemplateCopyInput }
  | { type: "templateCopyStarted"; requestId: string }
  | { type: "templateCopySucceeded"; requestId: string; response: DuplicateTeamTemplateResponse }
  | { type: "templateCopyFailed"; requestId: string; error: AppError }
  | { type: "draftSwitchRequested"; requestId: string; changeId: string | null }
  | { type: "draftSwitchStarted"; requestId: string }
  | { type: "draftSwitchSucceeded"; requestId: string; changeId: string | null }
  | { type: "draftSwitchFailed"; requestId: string; error: AppError };

const EMPTY_CATALOG: DocumentTemplateCatalog = {
  templates: [],
  diagnostics: [],
};

const IDLE_CREATION: DocumentCreationState = {
  status: "idle",
  requestId: null,
  input: null,
  validation: null,
  error: null,
};

export function createInitialAuthoringState(): DocumentAuthoringState {
  return {
    templatesStatus: "idle",
    templatesSessionId: null,
    templateCatalog: EMPTY_CATALOG,
    drafts: [],
    activeChangeId: null,
    dialogOpen: false,
    defaultFolder: "docs",
    creation: IDLE_CREATION,
    existingEdit: {
      status: "idle",
      requestId: null,
      path: null,
      title: null,
      error: null,
    },
    editor: null,
    templateCopy: {
      status: "idle",
      requestId: null,
      input: null,
      path: null,
      error: null,
    },
    draftSwitch: {
      status: "idle",
      requestId: null,
      changeId: null,
      error: null,
    },
  };
}

function ownsCreation(
  state: DocumentAuthoringState,
  requestId: string,
): boolean {
  return state.creation.requestId === requestId;
}

function ownsSave(state: DocumentAuthoringState, requestId: string): boolean {
  return state.editor?.saveRequestId === requestId;
}

export function documentAuthoringReducer(
  state: DocumentAuthoringState,
  action: DocumentAuthoringAction,
): DocumentAuthoringState {
  switch (action.type) {
    case "templatesLoading":
      return {
        ...state,
        templatesStatus: "loading",
        templatesSessionId: action.sessionId,
      };
    case "templatesLoaded":
      if (state.templatesSessionId !== action.sessionId) return state;
      return {
        ...state,
        templatesStatus: "ready",
        templatesSessionId: null,
        templateCatalog: action.catalog,
        drafts: action.drafts,
        activeChangeId:
          action.drafts.find((draft) => draft.branch === action.activeBranch)
            ?.changeId ?? null,
        editor:
          state.editor ??
          (action.recovery
            ? {
                document: action.recovery.document,
                markdown: action.recovery.document.markdown,
                savedMarkdown: action.recovery.hasUnsavedRecovery
                  ? ""
                  : action.recovery.document.markdown,
                contentHash: action.recovery.document.contentHash,
                saveStatus: action.recovery.conflict
                  ? "conflict"
                  : action.recovery.hasUnsavedRecovery
                    ? "dirty"
                    : "saved",
                saveRequestId: null,
                saveSnapshot: null,
                conflict: action.recovery.conflict,
                error: null,
                mode: "source",
                closeAfterSave: false,
              }
            : null),
      };
    case "dialogOpened":
      return {
        ...state,
        dialogOpen: true,
        defaultFolder: action.folder,
        creation: IDLE_CREATION,
      };
    case "dialogClosed":
      return state.creation.status === "creating"
        ? state
        : { ...state, dialogOpen: false, creation: IDLE_CREATION };
    case "creationRequested":
      return {
        ...state,
        creation: {
          status: "validation_queued",
          requestId: action.requestId,
          input: action.input,
          validation: null,
          error: null,
        },
      };
    case "validationStarted":
      return ownsCreation(state, action.requestId) &&
        state.creation.status === "validation_queued"
        ? {
            ...state,
            creation: { ...state.creation, status: "validating" },
          }
        : state;
    case "validationSucceeded":
      return ownsCreation(state, action.requestId) &&
        state.creation.status === "validating"
        ? {
            ...state,
            creation: {
              ...state.creation,
              status: action.validation.hasCollision
                ? "collision"
                : "creation_queued",
              validation: action.validation,
            },
          }
        : state;
    case "creationStarted":
      return ownsCreation(state, action.requestId) &&
        state.creation.status === "creation_queued"
        ? {
            ...state,
            creation: { ...state.creation, status: "creating" },
          }
        : state;
    case "creationSucceeded":
      if (
        !ownsCreation(state, action.requestId) ||
        state.creation.status !== "creating" ||
        action.response.requestId !== action.requestId
      ) {
        return state;
      }
      return {
        ...state,
        dialogOpen: false,
        creation: { ...state.creation, status: "ready" },
        drafts: [
          action.response.document.draft,
          ...state.drafts.filter(
            (draft) =>
              draft.changeId !== action.response.document.draft.changeId,
          ),
        ],
        editor: {
          document: action.response.document,
          markdown: action.response.document.markdown,
          savedMarkdown: action.response.document.markdown,
          contentHash: action.response.document.contentHash,
          saveStatus: "saved",
          saveRequestId: null,
          saveSnapshot: null,
          conflict: null,
          error: null,
          mode: "rich",
          closeAfterSave: false,
        },
        activeChangeId: action.response.document.changeId,
        templatesSessionId: null,
      };
    case "creationFailed":
      return ownsCreation(state, action.requestId)
        ? {
            ...state,
            creation: {
              ...state.creation,
              status: "error",
              error: action.error,
            },
          }
        : state;
    case "existingEditRequested":
      return {
        ...state,
        existingEdit: {
          status: "queued",
          requestId: action.requestId,
          path: action.path,
          title: action.title,
          error: null,
        },
      };
    case "existingEditStarted":
      return state.existingEdit.requestId === action.requestId &&
        state.existingEdit.status === "queued"
        ? {
            ...state,
            existingEdit: { ...state.existingEdit, status: "opening" },
          }
        : state;
    case "existingEditSucceeded":
      if (
        state.existingEdit.requestId !== action.requestId ||
        state.existingEdit.status !== "opening" ||
        action.response.requestId !== action.requestId
      ) {
        return state;
      }
      return {
        ...state,
        templatesSessionId: null,
        existingEdit: {
          status: "idle",
          requestId: null,
          path: null,
          title: null,
          error: null,
        },
        drafts: [
          action.response.document.draft,
          ...state.drafts.filter(
            (draft) =>
              draft.changeId !== action.response.document.draft.changeId,
          ),
        ],
        activeChangeId: action.response.document.changeId,
        editor: {
          document: action.response.document,
          markdown: action.response.document.markdown,
          savedMarkdown: action.response.document.markdown,
          contentHash: action.response.document.contentHash,
          saveStatus: "saved",
          saveRequestId: null,
          saveSnapshot: null,
          conflict: null,
          error: null,
          mode: "rich",
          closeAfterSave: false,
        },
      };
    case "existingEditFailed":
      return state.existingEdit.requestId === action.requestId
        ? {
            ...state,
            existingEdit: {
              ...state.existingEdit,
              status: "error",
              error: action.error,
            },
          }
        : state;
    case "editorChanged":
      if (state.editor === null || state.editor.markdown === action.markdown) {
        return state;
      }
      return {
        ...state,
        editor: {
          ...state.editor,
          markdown: action.markdown,
          saveStatus: ["queued", "saving"].includes(state.editor.saveStatus)
            ? state.editor.saveStatus
            : action.markdown === state.editor.savedMarkdown
              ? "saved"
              : "dirty",
          conflict: ["queued", "saving"].includes(state.editor.saveStatus)
            ? state.editor.conflict
            : null,
          error: null,
        },
      };
    case "editorModeChanged":
      return state.editor === null
        ? state
        : { ...state, editor: { ...state.editor, mode: action.mode } };
    case "saveQueued":
      return state.editor !== null &&
        state.editor.markdown === action.markdown &&
        state.editor.saveStatus === "dirty"
        ? {
            ...state,
            editor: {
              ...state.editor,
              saveStatus: "queued",
              saveRequestId: action.requestId,
              saveSnapshot: action.markdown,
            },
          }
        : state;
    case "saveStarted":
      return ownsSave(state, action.requestId) &&
        state.editor?.saveStatus === "queued"
        ? {
            ...state,
            editor: { ...state.editor, saveStatus: "saving" },
          }
        : state;
    case "saveSucceeded": {
      if (
        !ownsSave(state, action.requestId) ||
        state.editor === null ||
        state.editor.saveStatus !== "saving" ||
        action.response.requestId !== action.requestId
      ) {
        return state;
      }
      if (action.response.result.status === "conflict") {
        return {
          ...state,
          editor: {
            ...state.editor,
            saveStatus: "conflict",
            conflict: action.response.result,
          },
        };
      }
      const savedMarkdown = state.editor.saveSnapshot ?? state.editor.markdown;
      const changedDuringSave = state.editor.markdown !== savedMarkdown;
      if (state.editor.closeAfterSave && !changedDuringSave) {
        return { ...state, editor: null };
      }
      return {
        ...state,
        editor: {
          ...state.editor,
          savedMarkdown,
          contentHash: action.response.result.contentHash,
          saveStatus: changedDuringSave ? "dirty" : "saved",
          saveRequestId: null,
          saveSnapshot: null,
          conflict: null,
          error: null,
        },
      };
    }
    case "saveFailed":
      return ownsSave(state, action.requestId) && state.editor !== null
        ? {
            ...state,
            editor: {
              ...state.editor,
              saveStatus: "error",
              error: action.error,
            },
          }
        : state;
    case "conflictDiskAccepted":
      return state.editor?.conflict
        ? {
            ...state,
            editor: {
              ...state.editor,
              markdown: state.editor.conflict.diskMarkdown,
              savedMarkdown: state.editor.conflict.diskMarkdown,
              contentHash: state.editor.conflict.diskHash,
              // Save the accepted disk snapshot once so Rust can remove the
              // recovery journal that recorded the original conflict.
              saveStatus: "dirty",
              saveRequestId: null,
              saveSnapshot: null,
              conflict: null,
            },
          }
        : state;
    case "conflictHubAccepted":
      return state.editor?.conflict
        ? {
            ...state,
            editor: {
              ...state.editor,
              contentHash: state.editor.conflict.diskHash,
              saveStatus: "dirty",
              saveRequestId: null,
              saveSnapshot: null,
              conflict: null,
            },
          }
        : state;
    case "conflictMergeStarted":
      return state.editor?.conflict
        ? {
            ...state,
            editor: {
              ...state.editor,
              contentHash: state.editor.conflict.diskHash,
              markdown: [
                "<<<<<<< 내 내용",
                state.editor.conflict.hubMarkdown,
                "=======",
                state.editor.conflict.diskMarkdown,
                ">>>>>>> 디스크 내용",
              ].join("\n"),
              mode: "source",
            },
          }
        : state;
    case "editorCloseRequested":
      if (state.editor === null) return state;
      if (state.editor.saveStatus === "saved") return { ...state, editor: null };
      return ["dirty", "queued", "saving"].includes(state.editor.saveStatus)
        ? {
            ...state,
            editor: { ...state.editor, closeAfterSave: true },
          }
        : state;
    case "templateCopyRequested":
      return {
        ...state,
        templateCopy: {
          status: "queued",
          requestId: action.requestId,
          input: action.input,
          path: null,
          error: null,
        },
      };
    case "templateCopyStarted":
      return state.templateCopy.requestId === action.requestId &&
        state.templateCopy.status === "queued"
        ? { ...state, templateCopy: { ...state.templateCopy, status: "copying" } }
        : state;
    case "templateCopySucceeded":
      return state.templateCopy.requestId === action.requestId &&
        action.response.requestId === action.requestId
        ? {
            ...state,
            templatesSessionId: null,
            drafts: [
              action.response.draft,
              ...state.drafts.filter(
                (draft) => draft.changeId !== action.response.draft.changeId,
              ),
            ],
            templateCopy: {
              ...state.templateCopy,
              status: "saved",
              path: action.response.path,
            },
            activeChangeId: action.response.draft.changeId,
          }
        : state;
    case "templateCopyFailed":
      return state.templateCopy.requestId === action.requestId
        ? {
            ...state,
            templateCopy: {
              ...state.templateCopy,
              status: "error",
              error: action.error,
            },
          }
        : state;
    case "draftSwitchRequested":
      return {
        ...state,
        draftSwitch: {
          status: "queued",
          requestId: action.requestId,
          changeId: action.changeId,
          error: null,
        },
      };
    case "draftSwitchStarted":
      return state.draftSwitch.requestId === action.requestId &&
        state.draftSwitch.status === "queued"
        ? { ...state, draftSwitch: { ...state.draftSwitch, status: "switching" } }
        : state;
    case "draftSwitchSucceeded":
      return state.draftSwitch.requestId === action.requestId
        ? {
            ...state,
            templatesSessionId: null,
            activeChangeId: action.changeId,
            editor: null,
            draftSwitch: {
              status: "idle",
              requestId: null,
              changeId: action.changeId,
              error: null,
            },
          }
        : state;
    case "draftSwitchFailed":
      return state.draftSwitch.requestId === action.requestId
        ? {
            ...state,
            draftSwitch: {
              ...state.draftSwitch,
              status: "error",
              error: action.error,
            },
          }
        : state;
  }
}
