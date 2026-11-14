import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type CodeRepositoryMappingSource =
  | "manual"
  | "auto_detected"
  | "unmapped";

export interface WorkspaceCodeRepositoryStatus {
  key: string;
  label: string;
  fullName: string;
  localPath: string | null;
  mappingSource: CodeRepositoryMappingSource;
  exists: boolean;
}

export interface CodeRepositoryFilePreview {
  repositoryKey: string;
  repositoryFullName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

export interface CodeRepositoriesGateway {
  listWorkspaceCodeRepositories(): Promise<WorkspaceCodeRepositoryStatus[]>;
  setCodeRepositoryLocalPath(
    fullName: string,
    localPath: string,
  ): Promise<WorkspaceCodeRepositoryStatus>;
  clearCodeRepositoryLocalPath(fullName: string): Promise<void>;
  readCodeRepositoryFile(
    repository: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<CodeRepositoryFilePreview>;
  pickDirectory?(): Promise<string | null>;
}

class TauriCodeRepositoriesGateway implements CodeRepositoriesGateway {
  listWorkspaceCodeRepositories(): Promise<WorkspaceCodeRepositoryStatus[]> {
    return invoke<WorkspaceCodeRepositoryStatus[]>(
      "list_workspace_code_repositories",
    );
  }

  setCodeRepositoryLocalPath(
    fullName: string,
    localPath: string,
  ): Promise<WorkspaceCodeRepositoryStatus> {
    return invoke<WorkspaceCodeRepositoryStatus>(
      "set_code_repository_local_path",
      {
        fullName,
        localPath,
      },
    );
  }

  clearCodeRepositoryLocalPath(fullName: string): Promise<void> {
    return invoke<void>("clear_code_repository_local_path", {
      fullName,
    });
  }

  readCodeRepositoryFile(
    repository: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<CodeRepositoryFilePreview> {
    return invoke<CodeRepositoryFilePreview>("read_code_repository_file", {
      repository,
      filePath,
      startLine: startLine ?? null,
      endLine: endLine ?? null,
    });
  }

  async pickDirectory(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "코드 저장소 로컬 클론 폴더 선택",
    });
    return typeof selected === "string" ? selected : null;
  }
}

class FallbackCodeRepositoriesGateway implements CodeRepositoriesGateway {
  async listWorkspaceCodeRepositories(): Promise<
    WorkspaceCodeRepositoryStatus[]
  > {
    return [];
  }

  async setCodeRepositoryLocalPath(): Promise<WorkspaceCodeRepositoryStatus> {
    throw new Error(
      "코드 저장소 연결은 OkHub 데스크톱 앱에서 사용할 수 있습니다.",
    );
  }

  async clearCodeRepositoryLocalPath(): Promise<void> {}

  async readCodeRepositoryFile(): Promise<CodeRepositoryFilePreview> {
    throw new Error("코드 미리보기는 연결된 로컬 클론이 필요합니다.");
  }
}

export function createCodeRepositoriesGateway(
  detectDesktop: () => boolean = isTauri,
): CodeRepositoriesGateway {
  return detectDesktop()
    ? new TauriCodeRepositoriesGateway()
    : new FallbackCodeRepositoriesGateway();
}
