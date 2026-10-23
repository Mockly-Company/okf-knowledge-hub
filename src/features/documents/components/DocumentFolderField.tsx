import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DocumentTreeEntry } from "../model";
import { collectFolderPaths, removePendingBranch, resolveFolderPath } from "../folder-selection";

interface DocumentFolderFieldProps {
  roots: DocumentTreeEntry[];
  value: string;
  onValueChange(path: string): void;
  disabled?: boolean;
}
const displayPath = (path: string) => path.split("/").join(" / ");

export function DocumentFolderField({ roots, value, onValueChange, disabled = false }: DocumentFolderFieldProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prefixRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [initialLocation] = useState(value);
  const existing = useMemo(() => {
    const paths = collectFolderPaths(roots);
    // The initial location can be an empty configured document root absent from the catalog.
    if (!paths.length) return initialLocation.split("/").map((_, index, segments) => segments.slice(0, index + 1).join("/"));
    return paths;
  }, [roots, initialLocation]);
  const [pending, setPending] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(value.split("/").map((_, index, segments) => segments.slice(0, index + 1).join("/"))));
  const [creating, setCreating] = useState(false);
  const [parent, setParent] = useState(value);
  const [completed, setCompleted] = useState<string[]>([]);
  const [leaf, setLeaf] = useState("");
  const [typed, setTyped] = useState(false);
  const [inputWidth, setInputWidth] = useState(18);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    const prefix = prefixRef.current;
    if (!prefix) return;
    const revealEnd = () => { prefix.scrollLeft = prefix.scrollWidth; };
    const measureInput = () => {
      const input = inputRef.current;
      const measure = measureRef.current;
      if (!input || !measure) return;
      const style = getComputedStyle(input);
      setInputWidth(Math.ceil(measure.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2));
    };
    measureInput();
    revealEnd();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => { measureInput(); revealEnd(); });
    observer.observe(prefix);
    if (measureRef.current) observer.observe(measureRef.current);
    return () => observer.disconnect();
  }, [completed, parent, creating, leaf]);
  const paths = [...new Set([...existing, ...pending])];
  const visible = paths.filter(path => {
    const segments = path.split("/");
    return segments.slice(0, -1).every((_, index) => {
      const ancestor = segments.slice(0, index + 1).join("/");
      return !paths.includes(ancestor) || expanded.has(ancestor);
    });
  }).sort((a, b) => a.localeCompare(b, "ko", {numeric: true}));

  function beginCreation() {
    setOpen(false); setParent(value); setCompleted([]); setLeaf(""); setTyped(false); setError(null); setCreating(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function cancelCreation() {
    setCreating(false); setError(null); addTrigger.current?.focus();
  }
  function addFolder() {
    try {
      const result = resolveFolderPath(parent, [...completed, ...(leaf.trim() ? [leaf] : [])].join("/"), paths);
      if (!result.missing.length) { setError("이미 있는 폴더입니다. 저장 폴더에서 선택해주세요."); return; }
      setPending(current => [...new Set([...current, ...result.missing])]);
      setExpanded(current => new Set([...current, ...result.path.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))]));
      onValueChange(result.path); setCreating(false); setError(null); trigger.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "폴더 이름을 확인해주세요."); }
  }
  let cumulative = "";
  const prefix = [...parent.split("/"), ...completed].map(segment => {
    cumulative += `${cumulative ? "/" : ""}${segment}`;
    return { segment, path: cumulative, exists: existing.includes(cumulative) };
  });

  return <div className="document-folder-field">
    <div className="document-folder-field__label">
      <span id={`${id}-label`}>저장 폴더</span>
      <IconButton ref={addTrigger} label="새 폴더 만들기" tooltip={false} disabled={disabled} onClick={beginCreation}><FolderPlus aria-hidden="true" /></IconButton>
    </div>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="secondary" className="document-folder-field__trigger" aria-label="저장 폴더 선택" disabled={disabled}>
          <Folder aria-hidden="true" /><span>{displayPath(value)}</span><ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="document-folder-field__menu" align="start" aria-labelledby={`${id}-label`}>
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {visible.map(path => {
            const hasChildren = paths.some(candidate => candidate.slice(0, candidate.lastIndexOf("/")) === path);
            const depth = path.split("/").slice(0, -1).filter((_, index) => paths.includes(path.split("/").slice(0, index + 1).join("/"))).length;
            return <div key={path} className="document-folder-field__row" style={{paddingLeft: `${depth * 20}px`}}>
              {hasChildren ? <DropdownMenuItem aria-label={`${displayPath(path)} ${expanded.has(path) ? "접기" : "펼치기"}`} className="document-folder-field__expand" onSelect={event => {
                event.preventDefault(); setExpanded(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; });
              }}>{expanded.has(path) ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</DropdownMenuItem> : <span className="document-folder-field__expand-spacer" />}
              <DropdownMenuRadioItem value={path} className="document-folder-field__option"><Folder aria-hidden="true" />{path.split("/").at(-1)}{pending.includes(path) ? <span className="document-folder-field__pending-tag">생성 예정</span> : null}</DropdownMenuRadioItem>
            </div>;
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {pending.includes(value) ? <div className="document-folder-field__pending">
      <span>문서를 만들 때 새 폴더도 함께 생성됩니다.</span>
      <Button variant="ghost" aria-label="생성 예정 폴더 추가 취소" disabled={disabled} onClick={() => { const next = removePendingBranch(existing, pending, value); setPending(next.pending); onValueChange(next.fallback); }}>추가 취소</Button>
    </div> : null}
    {creating ? <div role="group" aria-label="새 폴더 만들기" className="document-folder-field__creation" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelCreation(); } }}>
      <div className="document-folder-field__creation-heading">
        <label htmlFor={`${id}-name`}>새 폴더 이름</label>
        <IconButton label="새 폴더 입력 취소" tooltip={false} disabled={disabled} onClick={cancelCreation}><X aria-hidden="true" /></IconButton>
      </div>
      <div className="document-folder-field__path-control">
        <span ref={prefixRef} className="document-folder-field__prefix" aria-hidden="true">{prefix.map(({ segment, path, exists }) => <span key={path}><span data-folder-state={exists ? "existing" : "new"}>{segment}</span><span className="document-folder-field__slash"> / </span></span>)}</span>
        <span ref={measureRef} className="document-folder-field__input-measure" aria-hidden="true">{leaf || "\u200b"}</span>
        <Input ref={inputRef} id={`${id}-name`} value={leaf} disabled={disabled} style={typed ? {width: `${inputWidth}px`, flex: "0 0 auto"} : undefined} aria-describedby={`${id}-parent${error ? ` ${id}-error` : ""}`} aria-invalid={error ? true : undefined} placeholder={typed ? "" : "폴더 이름 또는 하위 경로를 입력해주세요"} onChange={event => {
          const text = event.target.value; setTyped(true); setError(null);
          if (text.includes("/")) {
            const parts = text.split("/"); const finished = parts.slice(0, -1).map(part => part.trim().normalize("NFC"));
            if (finished.every(part => part && part !== "." && part !== ".." && !part.includes("\\"))) { setCompleted(current => [...current, ...finished]); setLeaf(parts.at(-1) ?? ""); return; }
          }
          setLeaf(text);
        }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelCreation(); }
          else if (event.key === "Enter") { event.preventDefault(); if (leaf.trim() || completed.length) addFolder(); }
          else if (event.key === "Backspace" && !leaf && completed.length) { event.preventDefault(); setLeaf(completed.at(-1)!); setCompleted(current => current.slice(0, -1)); }
        }} />
      </div>
      <div className="document-folder-field__actions"><Button disabled={disabled || (!leaf.trim() && !completed.length)} onClick={addFolder}>추가</Button></div>
      <span id={`${id}-parent`} className="sr-only" aria-live="polite">생성 위치: {displayPath([parent, ...completed].join("/"))}</span>
      {error ? <p id={`${id}-error`} role="alert" className="document-folder-field__error">{error}</p> : null}
    </div> : null}
  </div>;
}
