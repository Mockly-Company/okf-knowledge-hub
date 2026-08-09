import { isTauri } from "@tauri-apps/api/core";
import type { DocumentsGateway } from "@/features/documents/DocumentsGateway";
import { TauriDocumentsGateway } from "./TauriDocumentsGateway";
import { UnavailableDocumentsGateway } from "./UnavailableDocumentsGateway";

export function createDocumentsGateway(
  detectDesktop: () => boolean = isTauri,
): DocumentsGateway {
  return detectDesktop()
    ? new TauriDocumentsGateway()
    : new UnavailableDocumentsGateway();
}
