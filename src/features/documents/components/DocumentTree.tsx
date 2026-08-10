import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DocumentTreeEntry } from "../model";

interface DocumentTreeProps {
  entries: DocumentTreeEntry[];
  selectedPath: string | null;
  onSelectDocument(path: string): void;
}

interface VisibleTreeEntry {
  entry: DocumentTreeEntry;
  key: string;
  parentPath: string | null;
  level: number;
}

function entryKey(entry: DocumentTreeEntry): string {
  return entry.kind === "folder" ? entry.path : entry.summary.path;
}

function visibleEntries(
  entries: DocumentTreeEntry[],
  expanded: ReadonlySet<string>,
  level = 1,
  parentPath: string | null = null,
): VisibleTreeEntry[] {
  return entries.flatMap((entry) => {
    const key = entryKey(entry);
    const current = [{ entry, key, parentPath, level }];
    if (entry.kind !== "folder" || !expanded.has(key)) return current;
    return [
      ...current,
      ...visibleEntries(entry.children, expanded, level + 1, entry.path),
    ];
  });
}

function labelFor(entry: DocumentTreeEntry): string {
  return entry.kind === "folder" ? entry.name : entry.summary.title;
}

function ancestorPaths(
  entries: DocumentTreeEntry[],
  selectedPath: string | null,
): string[] {
  if (selectedPath === null) return [];
  for (const entry of entries) {
    if (entry.kind === "document") {
      if (entry.summary.path === selectedPath) return [];
      continue;
    }
    const nested = ancestorPaths(entry.children, selectedPath);
    const containsSelected = entry.children.some(
      (child) =>
        (child.kind === "document" && child.summary.path === selectedPath) ||
        (child.kind === "folder" && selectedPath.startsWith(`${child.path}/`)),
    );
    if (containsSelected || nested.length > 0) return [entry.path, ...nested];
  }
  return [];
}

export function DocumentTree({
  entries,
  selectedPath,
  onSelectDocument,
}: DocumentTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestorPaths(entries, selectedPath)),
  );
  const [activeKey, setActiveKey] = useState<string | null>(
    selectedPath ?? (entries[0] ? entryKey(entries[0]) : null),
  );
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const visible = useMemo(
    () => visibleEntries(entries, expanded),
    [entries, expanded],
  );

  useEffect(() => {
    if (selectedPath === null) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const path of ancestorPaths(entries, selectedPath)) next.add(path);
      return next.size === current.size ? current : next;
    });
    setActiveKey(selectedPath);
  }, [entries, selectedPath]);

  useEffect(() => {
    if (visible.some(({ key }) => key === activeKey)) return;
    setActiveKey(visible[0]?.key ?? null);
  }, [activeKey, visible]);

  if (entries.length === 0) {
    return <p className="document-tree__empty">표시할 문서가 없습니다.</p>;
  }

  const toggleFolder = (path: string, shouldExpand?: boolean) => {
    const expand = shouldExpand ?? !expanded.has(path);
    if (!expand && activeKey?.startsWith(`${path}/`)) setActiveKey(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (expand) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const focusEntry = (key: string | undefined) => {
    if (!key) return;
    setActiveKey(key);
    itemRefs.current.get(key)?.focus();
  };

  return (
    <div className="document-tree" role="tree" aria-label="문서">
      {visible.map(({ entry, key, parentPath, level }, index) => {
        const isFolder = entry.kind === "folder";
        const isExpanded = isFolder && expanded.has(entry.path);
        const label = labelFor(entry);
        const isSelected = !isFolder && selectedPath === entry.summary.path;
        const item = (
          <button
            key={key}
            ref={(element) => {
              if (element) itemRefs.current.set(key, element);
              else itemRefs.current.delete(key);
            }}
            type="button"
            role="treeitem"
            aria-level={level}
            aria-expanded={isFolder ? isExpanded : undefined}
            aria-selected={isFolder ? undefined : isSelected}
            tabIndex={key === activeKey ? 0 : -1}
            className={cn(
              "document-tree__item",
              isSelected && "document-tree__item--selected",
            )}
            style={{
              "--tree-indent": `${8 + (level - 1) * 14}px`,
            } as CSSProperties}
            title={label}
            onFocus={() => setActiveKey(key)}
            onClick={() => {
              if (entry.kind === "folder") toggleFolder(entry.path);
              else onSelectDocument(entry.summary.path);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusEntry(visible[index + 1]?.key);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                focusEntry(visible[index - 1]?.key);
                return;
              }
              if (event.key === "Home") {
                event.preventDefault();
                focusEntry(visible[0]?.key);
                return;
              }
              if (event.key === "End") {
                event.preventDefault();
                focusEntry(visible.at(-1)?.key);
                return;
              }
              if (event.key === "ArrowRight" && entry.kind === "folder") {
                event.preventDefault();
                if (!isExpanded) toggleFolder(entry.path, true);
                else if (entry.children.length > 0) {
                  focusEntry(entryKey(entry.children[0]));
                }
                return;
              }
              if (event.key === "ArrowLeft") {
                if (entry.kind === "folder" && isExpanded) {
                  event.preventDefault();
                  toggleFolder(entry.path, false);
                } else if (parentPath) {
                  event.preventDefault();
                  focusEntry(parentPath);
                }
              }
            }}
          >
            {isFolder ? (
              <>
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "document-tree__chevron",
                    isExpanded && "document-tree__chevron--expanded",
                  )}
                />
                {isExpanded ? (
                  <FolderOpen aria-hidden="true" />
                ) : (
                  <Folder aria-hidden="true" />
                )}
              </>
            ) : (
              <>
                <span className="document-tree__chevron" aria-hidden="true" />
                <FileText aria-hidden="true" />
              </>
            )}
            <span>{label}</span>
          </button>
        );

        return label.length > 28 ? (
          <Tooltip key={key} content={label}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </div>
  );
}
