import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Folder, Home, PanelLeft, Pencil, RefreshCw, Settings, SquareKanban, Undo2, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { UnstyledButton } from "@/components/ui/unstyled-button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import "./workspace-settings-preview.css";

type Repository = { name: string; document: boolean; code: boolean; roots: string[]; excluded: string[] };
type Board = { id: number; name: string };
type Workspace = { source: string; repositories: Repository[]; boards: Board[]; defaultBoard: number | null };
type Change = "added" | "removed" | "modified" | undefined;
type Modal = "edit" | "add" | "review" | "saved" | "conflict" | "source" | null;
type Diff = { title: string; before: string; after: string };
const categories = ["외부 연결", "Workspaces", "문서", "작업 방식", "화면", "AI 연동", "앱 정보"];
const repositoryCatalog = ["Mockly-Company/hub-knowledge", "Mockly-Company/okf-knowledge-hub", "example-team/team-docs", "example-team/service-api"];
const boardCatalog: Board[] = [{ id: 3, name: "Project-OKF" }, { id: 8, name: "운영 개선" }, { id: 12, name: "제품 개발" }];
const initial: Workspace = { source: "Mockly-Company/hub-knowledge", repositories: [
  { name: "Mockly-Company/hub-knowledge", document: true, code: false, roots: ["docs/"], excluded: [] },
  { name: "Mockly-Company/okf-knowledge-hub", document: false, code: true, roots: ["."], excluded: [] },
], boards: boardCatalog.slice(0, 2), defaultBoard: 8 };
const copy = <T,>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const shortName = (name: string) => name.split("/").at(-1)!;
const purpose = (repo?: Repository) => repo ? [repo.document && "문서", repo.code && "코드"].filter(Boolean).join(" · ") || "미지정" : "연결 없음";
const folderSummary = (repo?: Repository) => !repo?.document ? "문서 용도 없음" : repo.roots.map(path => path === "." ? "전체" : path).join(", ") + (repo.excluded.length ? ` (제외: ${repo.excluded.join(", ")})` : "");
function repoChange(before?: Repository, after?: Repository): Change { return !before ? "added" : !after ? "removed" : !equal(before, after) ? "modified" : undefined; }
function differences(before: Workspace, after: Workspace): Diff[] {
  const result: Diff[] = [];
  for (const name of new Set([...before.repositories, ...after.repositories].map(repo => repo.name))) {
    const old = before.repositories.find(repo => repo.name === name), next = after.repositories.find(repo => repo.name === name);
    if (purpose(old) !== purpose(next)) result.push({ title: `${shortName(name)} · 용도`, before: purpose(old), after: purpose(next) });
    if (folderSummary(old) !== folderSummary(next)) result.push({ title: `${shortName(name)} · 문서 폴더`, before: folderSummary(old), after: folderSummary(next) });
  }
  for (const board of before.boards.filter(board => !after.boards.some(next => next.id === board.id))) result.push({ title: "보드 연결 해제", before: board.name, after: "연결 없음" });
  for (const board of after.boards.filter(board => !before.boards.some(old => old.id === board.id))) result.push({ title: "보드 추가", before: "연결 없음", after: board.name });
  if (before.defaultBoard !== after.defaultBoard) result.push({ title: "기본 보드", before: before.boards.find(board => board.id === before.defaultBoard)?.name || "없음", after: after.boards.find(board => board.id === after.defaultBoard)?.name || "없음" });
  return result;
}
function ChangeMark({ change }: { change: Change }) {
  const labels = { added: "추가 예정", removed: "연결 해제 예정", modified: "수정됨" };
  return <span className="wsp-change-mark" role={change ? "img" : undefined} aria-label={change ? labels[change] : undefined} aria-hidden={!change || undefined} title={change ? labels[change] : undefined}>{change === "added" ? "+" : change === "removed" ? "−" : change === "modified" ? "~" : ""}</span>;
}
function DiffList({ items }: { items: Diff[] }) {
  return <dl className="wsp-diff">{items.map((item, index) => <div key={`${item.title}-${index}`}><dt>{item.title}</dt><dd className="wsp-diff-before"><span aria-hidden="true">−</span><span className="wsp-diff-label">변경 전</span><span>{item.before}</span></dd><dd className="wsp-diff-after"><span aria-hidden="true">+</span><span className="wsp-diff-label">변경 후</span><span>{item.after}</span></dd></div>)}</dl>;
}

function FolderTree({ repo, onChange, many }: { repo: Repository; onChange: (repo: Repository) => void; many: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const paths = [...new Set(["docs/", "docs/api/", "docs/product/", "decisions/", ...(many ? Array.from({ length: 32 }, (_, index) => `docs/product/feature-${String(index + 1).padStart(2, "0")}/`) : []), ...repo.roots.filter(path => path !== "."), ...repo.excluded])].sort();
  const covers = (parent: string, path: string) => parent === "." || parent === path || path.startsWith(parent);
  const enabled = (path: string) => [...repo.roots.map(path => ({ path, selected: true })), ...repo.excluded.map(path => ({ path, selected: false }))].filter(rule => covers(rule.path, path)).sort((a, b) => (a.path === "." ? 0 : a.path.length) - (b.path === "." ? 0 : b.path.length)).at(-1)?.selected || false;
  function toggle(path: string, checked: boolean) {
    if (path === ".") { onChange({ ...repo, roots: checked ? ["."] : [], excluded: [] }); return; }
    const roots = repo.roots.filter(root => !covers(path, root)), excluded = repo.excluded.filter(root => !covers(path, root));
    if (checked) roots.push(path); else excluded.push(path);
    onChange({ ...repo, roots, excluded });
  }
  function row(path: string, label: string) {
    const descendants = paths.filter(child => child !== path && covers(path, child));
    const values = [enabled(path), ...descendants.map(enabled)];
    const mixed = values.some(Boolean) && !values.every(Boolean);
    const checked = values.every(Boolean), childId = `${id}-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
    const isCollapsed = collapsed.has(path) && !query;
    return <div className="wsp-folder-row"><Checkbox id={childId} checked={checked} aria-checked={mixed ? "mixed" : checked} ref={input => { if (input) input.indeterminate = mixed; }} onChange={event => toggle(path, event.target.checked)} />{path !== "." && <Folder aria-hidden="true" />}<label htmlFor={childId}>{label}</label>{path !== "." && descendants.length > 0 && <IconButton className="wsp-tree-toggle" label={`${label} ${isCollapsed ? "펼치기" : "접기"}`} aria-expanded={!isCollapsed} onClick={() => setCollapsed(value => { const next = new Set(value); next.has(path) ? next.delete(path) : next.add(path); return next; })}>{isCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</IconButton>}</div>;
  }
  function branch(parent: string): ReactNode {
    const children = paths.filter(path => {
      const bits = path.split("/").filter(Boolean), direct = (bits.length === 1 ? "" : `${bits.slice(0, -1).join("/")}/`) === parent;
      return direct && (!query || path.toLowerCase().includes(query.toLowerCase()) || paths.some(child => child.startsWith(path) && child.toLowerCase().includes(query.toLowerCase())));
    });
    return children.length ? <ul>{children.map(path => <li key={path}>{row(path, path.split("/").filter(Boolean).at(-1)!)}{(!collapsed.has(path) || query) && branch(path)}</li>)}</ul> : null;
  }
  const tree = branch("");
  return <fieldset className="wsp-folder-field" disabled={!repo.document}><legend>문서 폴더</legend><Input type="search" aria-label="폴더 검색" placeholder="폴더 검색" value={query} onChange={event => setQuery(event.target.value)} /><div className="wsp-tree"><div className="wsp-tree-all">{row(".", "전체")}</div><div className="wsp-tree-scroll">{tree || <p className="wsp-muted">일치하는 폴더가 없어요.</p>}</div></div></fieldset>;
}

/** Local design fixtures only. No filesystem, GitHub, authentication or MCP calls. */
export function WorkspaceSettingsPreview({ folderSize = "few", access = "ready", saveResult = "success", initialChanges = false }: { folderSize?: "few" | "many"; access?: "ready" | "denied"; saveResult?: "success" | "failure" | "conflict"; initialChanges?: boolean }) {
  const [baseline, setBaseline] = useState<Workspace>(() => copy(initial));
  const [draft, setDraft] = useState<Workspace>(() => ({ ...copy(initial), defaultBoard: initialChanges ? 3 : initial.defaultBoard }));
  const [modal, setModal] = useState<Modal>(null), [editor, setEditor] = useState<Repository | null>(null);
  const [savedDiff, setSavedDiff] = useState<Diff[]>([]);
  const [refreshing, setRefreshing] = useState(false), [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false), [conflicted, setConflicted] = useState(false), [rebased, setRebased] = useState(false);
  const latest: Workspace = { ...copy(initial), boards: copy(boardCatalog), defaultBoard: 12 };
  const [error, setError] = useState(""), [boardEditing, setBoardEditing] = useState(false), [boardCandidate, setBoardCandidate] = useState("");
  const [repositoryCandidate, setRepositoryCandidate] = useState("");
  const [category, setCategory] = useState("Workspaces"), [detail, setDetail] = useState(true), [navOpen, setNavOpen] = useState(true);
  const [sourceStep, setSourceStep] = useState<"input" | "review">("input"), [sourceCandidate, setSourceCandidate] = useState("");
  const trigger = useRef<HTMLElement | null>(null);
  const changes = differences(baseline, draft), dirty = changes.length > 0;
  const repoNames = [...new Set([...baseline.repositories, ...draft.repositories].map(repo => repo.name))];
  const boards = [...new Map([...baseline.boards, ...draft.boards].map(board => [board.id, board])).values()];
  function open(next: Modal) { trigger.current = document.activeElement as HTMLElement; setError(next === "review" && conflicted ? "다른 사람이 설정을 먼저 변경했어요. 최신 내용을 확인해 주세요." : ""); setModal(next); }
  function close() { setModal(null); queueMicrotask(() => trigger.current?.isConnected && trigger.current.focus()); }
  function edit(repo: Repository) { setEditor(copy(repo)); open("edit"); }
  function saveEditor() {
    if (!editor) return;
    if (!editor.document && !editor.code) { setError("용도를 하나 이상 선택해 주세요."); return; }
    if (editor.document && !editor.roots.length) { setError("문서 폴더를 선택해 주세요."); return; }
    setDraft(current => ({ ...current, repositories: current.repositories.some(repo => repo.name === editor.name) ? current.repositories.map(repo => repo.name === editor.name ? copy(editor) : repo) : [...current.repositories, copy(editor)] })); close();
  }
  function restoreRepository(name: string) {
    const original = baseline.repositories.find(repo => repo.name === name);
    if (original) setDraft(current => ({ ...current, repositories: [...current.repositories.filter(repo => repo.name !== name), copy(original)] }));
  }
  async function save() {
    if (busy || conflicted) return;
    if (draft.boards.length && !draft.boards.some(board => board.id === draft.defaultBoard)) { setError("기본 보드를 선택해 주세요."); return; }
    setBusy(true); setError("");
    await new Promise(resolve => setTimeout(resolve, 400));
    setBusy(false);
    if (saveResult === "failure") { setSaveFailed(true); setError("저장하지 못했어요. 변경 내용은 유지됐어요. 다시 시도해 주세요."); return; }
    if (saveResult === "conflict" && !rebased) { setConflicted(true); setError("다른 사람이 설정을 먼저 변경했어요. 최신 내용을 확인해 주세요."); return; }
    setSavedDiff(copy(changes)); setBaseline(copy(draft)); setBoardEditing(false); setSaveFailed(false); setModal("saved");
  }
  function reviewLatest() {
    const newBoards = latest.boards.filter(board => !baseline.boards.some(old => old.id === board.id));
    setDraft(current => ({ ...current, boards: [...current.boards, ...newBoards.filter(board => !current.boards.some(item => item.id === board.id))] }));
    setBaseline(copy(latest)); setConflicted(false); setRebased(true); setError(""); setSaveFailed(false); setModal("review");
  }
  const title = modal === "edit" ? "저장소 편집" : modal === "add" ? "저장소 추가" : modal === "source" ? "설정 저장소 변경" : modal === "saved" ? "저장 완료" : modal === "conflict" ? "최신 변경 확인" : "변경 내용 확인";
  return <div className="wsp-preview"><header className="wsp-appbar"><IconButton label={navOpen ? "설정 메뉴 접기" : "설정 메뉴 펼치기"} onClick={() => setNavOpen(value => !value)}><PanelLeft aria-hidden="true" /></IconButton><Folder aria-hidden="true" /><strong>OkHub</strong><span className="wsp-prototype-note">가상 데이터 · 실제 설정 변경 없음</span></header><div className={`wsp-layout${navOpen ? "" : " wsp-layout--collapsed"}`}><aside className="wsp-rail" aria-label="앱 탐색"><Home aria-label="Home" /><Folder aria-label="Documents" /><SquareKanban aria-label="Project" /><Settings aria-label="Settings" /><span className="wsp-avatar" role="img" aria-label="GitHub 계정 hyeeun">HY</span></aside>{navOpen && <nav className="wsp-settings-nav" aria-label="설정 메뉴">{categories.map(item => <Button key={item} variant="ghost" aria-current={category === item ? "page" : undefined} onClick={() => setCategory(item)}>{item}</Button>)}</nav>}<main className="wsp-main"><div className="wsp-content">{category !== "Workspaces" ? <><h1>{category}</h1><p className="wsp-muted">워크스페이스 디자인 검토 범위 밖의 설정입니다.</p></> : !detail ? <><h1>Workspaces</h1><Button variant="ghost" className="wsp-workspace-item" onClick={() => setDetail(true)}><span><strong>OkHub</strong><span className="wsp-muted">{draft.source}</span></span><ChevronRight aria-hidden="true" /></Button><p className="wsp-muted">저장소에서 워크스페이스를 가져오는 흐름은 기존 HTML 시안에 유지되어 있어요.</p></> : <><nav aria-label="Breadcrumb"><ol className="wsp-breadcrumb"><li><UnstyledButton onClick={() => setDetail(false)}>Workspaces</UnstyledButton></li><li aria-hidden="true">/</li><li aria-current="page">OkHub</li></ol></nav><div className="wsp-page-heading"><div><h1>OkHub</h1><div className="wsp-checked"><span role="status">{refreshing ? "설정 확인 중…" : "설정 확인 · 방금"}</span><IconButton label="새로고침" tooltip disabled={refreshing} onClick={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 300); }}><RefreshCw aria-hidden="true" /></IconButton></div></div><Button variant="secondary" disabled={dirty || busy} onClick={() => { setSourceStep("input"); setSourceCandidate(""); open("source"); }}>설정 저장소 변경</Button></div>
    <section className="wsp-section" aria-labelledby="wsp-repositories"><div className="wsp-section-heading"><h2 id="wsp-repositories">연결된 저장소</h2><Button variant="ghost" disabled={busy} onClick={() => { setRepositoryCandidate(""); open("add"); }}>저장소 추가</Button></div><ul className="wsp-list">{repoNames.map(name => {
      const old = baseline.repositories.find(repo => repo.name === name), next = draft.repositories.find(repo => repo.name === name), change = repoChange(old, next), repo = next || old!;
      return <li className="wsp-repository-row" key={name} aria-label={shortName(name)} data-change={change}><div className="wsp-row-identity"><strong className={change === "removed" ? "wsp-struck" : ""} title={name}>{shortName(name)}</strong><span className="wsp-tags">{repo.document && <span className="wsp-chip">문서</span>}{repo.code && <span className="wsp-chip">코드</span>}</span></div><div className="wsp-row-actions"><ChangeMark change={change} />{next ? <IconButton label={`${shortName(name)} 편집`} tooltip disabled={busy} onClick={() => edit(repo)}><Pencil aria-hidden="true" /></IconButton> : <IconButton label={`${shortName(name)} 되돌리기`} tooltip disabled={busy} onClick={() => restoreRepository(name)}><Undo2 aria-hidden="true" /></IconButton>}<a className="wsp-external" href={`https://github.com/${name}`} target="_blank" rel="noopener noreferrer" aria-label={`${shortName(name)} GitHub에서 열기 (새 탭)`} title="GitHub에서 열기"><ExternalLink aria-hidden="true" /></a></div>{access === "denied" && name === initial.repositories[0].name && <p className="wsp-row-error" role="alert">저장소를 읽을 권한이 없어요. GitHub 권한을 확인해 주세요.</p>}</li>;
    })}</ul></section>
    <section className="wsp-section" aria-labelledby="wsp-boards"><div className="wsp-section-heading"><h2 id="wsp-boards">프로젝트 보드</h2><Button variant="ghost" disabled={busy} onClick={() => setBoardEditing(value => !value)}>{boardEditing ? "편집 완료" : "보드 편집"}</Button></div><ul className="wsp-list">{boards.map(board => {
      const was = baseline.boards.some(item => item.id === board.id), exists = draft.boards.some(item => item.id === board.id);
      const change: Change = !was ? "added" : !exists ? "removed" : baseline.defaultBoard !== draft.defaultBoard && (baseline.defaultBoard === board.id || draft.defaultBoard === board.id) ? "modified" : undefined;
      return <li className="wsp-board-row" key={board.id} aria-label={board.name} data-change={change}><div className="wsp-row-identity"><strong className={change === "removed" ? "wsp-struck" : ""}>{board.name}<span className="wsp-muted"> · #{board.id}</span></strong>{exists && draft.defaultBoard === board.id && <span className="wsp-chip">기본</span>}</div><div className="wsp-board-actions"><ChangeMark change={change} />{!exists ? <IconButton label={`${board.name} 되돌리기`} tooltip disabled={busy} onClick={() => setDraft(current => ({ ...current, boards: [...current.boards, board], defaultBoard: current.defaultBoard ?? (baseline.defaultBoard === board.id ? board.id : null) }))}><Undo2 aria-hidden="true" /></IconButton> : <>{draft.defaultBoard !== board.id && <Button variant="secondary" aria-label={`${board.name} 기본으로 설정`} disabled={busy} onClick={() => setDraft(current => ({ ...current, defaultBoard: board.id }))}>기본으로 설정</Button>}{boardEditing && <IconButton label={`${board.name} 연결 해제`} tooltip disabled={busy} onClick={() => setDraft(current => ({ ...current, boards: current.boards.filter(item => item.id !== board.id), defaultBoard: current.defaultBoard === board.id ? null : current.defaultBoard }))}><X aria-hidden="true" /></IconButton>}</>}</div></li>;
    })}</ul>{boardEditing && <div className="wsp-add-board"><label className="wsp-sr-only" htmlFor="wsp-board-candidate">추가할 보드</label><Select id="wsp-board-candidate" aria-label="추가할 보드" placeholder="추가할 보드 선택" value={boardCandidate} onValueChange={setBoardCandidate}>{boardCatalog.filter(board => !draft.boards.some(item => item.id === board.id)).map(board => <option key={board.id} value={board.id}>{board.name} · #{board.id}</option>)}</Select><Button variant="secondary" disabled={!boardCandidate} onClick={() => { const board = boardCatalog.find(item => item.id === Number(boardCandidate))!; setDraft(current => ({ ...current, boards: [...current.boards, board] })); setBoardCandidate(""); }}>추가</Button></div>}</section>
    <section className="wsp-section"><h2>설정 원본</h2><a className="wsp-source-link" href={`https://github.com/${draft.source}`} target="_blank" rel="noopener noreferrer">{draft.source}<ExternalLink aria-label="새 탭에서 열기" /></a></section>{dirty && !busy && <footer className="wsp-page-actions"><Button variant="secondary" onClick={() => { setDraft(copy(baseline)); setBoardEditing(false); }}>취소</Button><Button onClick={() => open("review")}>변경 저장</Button></footer>}</> }</div></main></div>
    <Dialog open={modal !== null} onOpenChange={value => { if (!value && !busy) close(); }}><DialogContent aria-label={title} className={`wsp-dialog${modal === "edit" ? " wsp-dialog--editor" : ""}`} onCloseAutoFocus={event => { event.preventDefault(); queueMicrotask(() => trigger.current?.isConnected && trigger.current.focus()); }}><DialogHeader><div><DialogTitle>{title}</DialogTitle><DialogDescription>{modal === "edit" ? editor?.name : "OkHub"}</DialogDescription></div><DialogCloseButton label="대화상자 닫기" disabled={busy} /></DialogHeader><DialogBody className="wsp-dialog-body">
      {modal === "edit" && editor && <><fieldset className="wsp-purpose"><legend>용도</legend><label><Checkbox checked={editor.document} onChange={event => setEditor({ ...editor, document: event.target.checked })} />문서</label><label><Checkbox checked={editor.code} onChange={event => setEditor({ ...editor, code: event.target.checked })} />코드</label></fieldset><FolderTree repo={editor} onChange={setEditor} many={folderSize === "many"} /></>}
      {modal === "add" && <div className="wsp-picker"><label htmlFor="wsp-repo-search">저장소 검색</label><Input id="wsp-repo-search" type="search" value={repositoryCandidate} onChange={event => setRepositoryCandidate(event.target.value)} /><div className="wsp-picker-results">{repositoryCatalog.filter(name => !draft.repositories.some(repo => repo.name === name) && name.toLowerCase().includes(repositoryCandidate.toLowerCase())).map(name => <Button variant="ghost" key={name} onClick={() => { setEditor({ name, document: false, code: true, roots: ["."], excluded: [] }); setModal("edit"); }}>{name}</Button>)}</div></div>}
      {modal === "review" && <>{rebased && <p className="wsp-save-notice" role="status">최신 설정을 기준으로 다시 확인해 주세요.</p>}<DiffList items={changes} /></>}
      {modal === "saved" && <DiffList items={savedDiff} />}
      {modal === "conflict" && <><section className="wsp-conflict-group"><h3>다른 사람의 변경</h3><DiffList items={differences(baseline, latest)} /></section><section className="wsp-conflict-group"><h3>내 변경</h3><DiffList items={changes} /></section></>}
      {modal === "source" && (sourceStep === "input" ? <div className="wsp-picker"><label htmlFor="wsp-source">새 설정 저장소</label><Input id="wsp-source" value={sourceCandidate} onChange={event => setSourceCandidate(event.target.value)} placeholder="조직/저장소" /><div className="wsp-picker-results">{repositoryCatalog.filter(name => name !== baseline.source && name.toLowerCase().includes(sourceCandidate.toLowerCase())).map(name => <Button variant="ghost" key={name} onClick={() => setSourceCandidate(name)}>{name}</Button>)}</div></div> : <DiffList items={[{ title: "설정 저장소", before: baseline.source, after: sourceCandidate }]} />)}
      {error && <p className="wsp-error" role="alert">{error}</p>}
    </DialogBody><DialogFooter className="wsp-dialog-footer">
      {modal === "edit" && editor && <><Button variant="destructive" className="wsp-disconnect" onClick={() => { setDraft(current => ({ ...current, repositories: current.repositories.filter(repo => repo.name !== editor.name) })); close(); }}>연결 해제</Button><Button variant="secondary" onClick={close}>취소</Button><Button onClick={saveEditor}>적용</Button></>}
      {modal === "add" && <Button variant="secondary" onClick={close}>취소</Button>}
      {modal === "review" && <><Button variant="secondary" disabled={busy} onClick={close}>취소</Button>{conflicted ? <Button onClick={() => { setError(""); setModal("conflict"); }}>최신 내용 확인</Button> : <Button loading={busy} onClick={save}>{saveFailed ? "다시 저장" : "저장"}</Button>}</>}
      {modal === "saved" && <Button onClick={close}>닫기</Button>}
      {modal === "conflict" && <><Button variant="secondary" onClick={close}>편집으로 돌아가기</Button><Button onClick={reviewLatest}>다시 검토</Button></>}
      {modal === "source" && <><Button variant="secondary" onClick={() => sourceStep === "review" ? setSourceStep("input") : close()}>{sourceStep === "input" ? "취소" : "이전"}</Button><Button disabled={!sourceCandidate || sourceCandidate === baseline.source} onClick={() => { if (!/^[\w.-]+\/[\w.-]+$/.test(sourceCandidate)) { setError("저장소를 선택하거나 조직/저장소 형식으로 입력해 주세요."); return; } if (sourceStep === "input") { setError(""); setSourceStep("review"); } else { setBaseline(current => ({ ...current, source: sourceCandidate })); setDraft(current => ({ ...current, source: sourceCandidate })); close(); } }}>{sourceStep === "input" ? "변경 내용 확인" : "변경 적용"}</Button></>}
    </DialogFooter></DialogContent></Dialog>
  </div>;
}
