import { Select } from "@/components/ui/select";
import type { DocumentAuthoringState } from "../document-authoring-reducer";

interface DocumentDraftSwitcherProps {
  state: DocumentAuthoringState;
  onSwitch(changeId: string | null): void;
}

export function DocumentDraftSwitcher({ state, onSwitch }: DocumentDraftSwitcherProps) {
  return (
    <div className="document-draft-switcher-container">
      <label className="document-draft-switcher">
        <span>작업 기준</span>
        <Select
          aria-label="문서 Draft 전환"
          value={state.activeChangeId ?? "main"}
          disabled={state.draftSwitch.status === "switching"}
          onChange={(event) =>
            onSwitch(event.target.value === "main" ? null : event.target.value)
          }
        >
          <option value="main">main · 확정 문서</option>
          {state.drafts.map((draft) => (
            <option key={draft.changeId} value={draft.changeId}>
              {draft.branch}
            </option>
          ))}
        </Select>
      </label>
      {state.draftSwitch.error ? (
        <span className="document-draft-switcher__error" role="alert">
          {state.draftSwitch.error.message}
        </span>
      ) : null}
    </div>
  );
}
