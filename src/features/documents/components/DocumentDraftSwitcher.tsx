import { Select, SelectOption } from "@/components/ui/select";
import type { DocumentAuthoringState } from "../document-authoring-reducer";

interface DocumentDraftSwitcherProps {
  state: DocumentAuthoringState;
  onSwitch(changeId: string | null): void;
}

export function DocumentDraftSwitcher({ state, onSwitch }: DocumentDraftSwitcherProps) {
  return (
    <div className="document-draft-switcher-container">
      <Select
        aria-label="문서 작업 전환"
        className="document-draft-switcher"
        value={state.activeChangeId ?? "main"}
        disabled={state.draftSwitch.status === "switching"}
        onValueChange={(value) => onSwitch(value === "main" ? null : value)}
      >
        <SelectOption value="main">확정 문서</SelectOption>
        {state.drafts.map((draft) => (
          <SelectOption
            key={draft.changeId}
            value={draft.changeId}
            description={draft.branch}
          >
            변경 작업
          </SelectOption>
        ))}
      </Select>
      {state.draftSwitch.error ? (
        <span className="document-draft-switcher__error" role="alert">
          {state.draftSwitch.error.message}
        </span>
      ) : null}
    </div>
  );
}
