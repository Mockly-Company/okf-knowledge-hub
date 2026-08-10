import type { DocumentContent } from "../model";

function displayProperty(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function propertyEntries(properties: unknown): Array<[string, unknown]> {
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.entries(properties as Record<string, unknown>)
    : [];
}

export function DocumentOverview({ document }: { document: DocumentContent }) {
  const entries = propertyEntries(document.properties);

  return (
    <>
      <section className="document-overview__properties" aria-label="문서 속성">
        <h2>문서 속성</h2>
        {entries.length === 0 ? (
          <p>표시할 문서 속성이 없습니다.</p>
        ) : (
          <dl>
            {entries.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{displayProperty(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <nav className="document-overview__toc" aria-label="목차">
        <h2>목차</h2>
        {document.tableOfContents.length === 0 ? (
          <p>목차가 없습니다.</p>
        ) : (
          <ol>
            {document.tableOfContents.map((item) => (
              <li key={item.id} style={{ paddingInlineStart: `${(item.level - 1) * 12}px` }}>
                <a href={`#${item.id}`}>{item.title}</a>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </>
  );
}
