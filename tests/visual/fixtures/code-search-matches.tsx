import { createRoot } from "react-dom/client";
import { MarkdownCodeBlock } from "../../../src/features/documents/components/MarkdownCodeBlock";

// Browser-only fixture: exercise the real renderer without adding catalog stories
// or test-only search APIs to production components.
export function renderCodeSearchMatches() {
  const host = document.createElement("div");
  host.dataset.testid = "code-search-matches";
  host.className = "markdown-document";
  document.body.append(host);
  const source = 'const value = "ok";';
  createRoot(host).render(
    <>
      {["typescript", "unknown-lang"].map((language) => (
        <MarkdownCodeBlock
          key={language}
          id={`searched-${language}`}
          language={language}
          source={source}
          searchMatch={{ start: 0, end: source.length }}
          onCopy={async () => {}}
        />
      ))}
    </>,
  );
}
