export interface DocumentDiffLine {
  number: number;
  text: string;
  kind: "same" | "added" | "removed";
}
export interface DocumentDiffRow {
  before: DocumentDiffLine | null;
  after: DocumentDiffLine | null;
}

/** Line-preserving comparison, with bounded work for very large replacements. */
export function compareDocumentLines(before: string, after: string): DocumentDiffRow[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const rows: DocumentDiffRow[] = [];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    rows.push({ before: { number: prefix + 1, text: a[prefix], kind: "same" }, after: { number: prefix + 1, text: b[prefix], kind: "same" } });
    prefix++;
  }
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
  const left = a.slice(prefix, a.length - suffix), right = b.slice(prefix, b.length - suffix);
  const edits: { kind: "same" | "added" | "removed"; text: string }[] = [];
  if (left.length * right.length > 250_000) {
    for (const text of left) edits.push({ kind: "removed", text });
    for (const text of right) edits.push({ kind: "added", text });
  } else {
    const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) edits.push({ kind: "same", text: left[i++] }), j++;
      else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) edits.push({ kind: "added", text: right[j++] });
      else edits.push({ kind: "removed", text: left[i++] });
    }
  }
  let oldNumber = prefix, newNumber = prefix, index = 0;
  while (index < edits.length) {
    const edit = edits[index];
    if (edit.kind === "same") {
      rows.push({ before: { number: ++oldNumber, text: edit.text, kind: "same" }, after: { number: ++newNumber, text: edit.text, kind: "same" } });
      index++; continue;
    }
    const removed: string[] = [], added: string[] = [];
    while (index < edits.length && edits[index].kind !== "same") {
      const change = edits[index++];
      (change.kind === "removed" ? removed : added).push(change.text);
    }
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      rows.push({ before: k < removed.length ? { number: ++oldNumber, text: removed[k], kind: "removed" } : null, after: k < added.length ? { number: ++newNumber, text: added[k], kind: "added" } : null });
    }
  }
  for (let i = 0; i < suffix; i++) rows.push({ before: { number: ++oldNumber, text: a[a.length - suffix + i], kind: "same" }, after: { number: ++newNumber, text: b[b.length - suffix + i], kind: "same" } });
  return rows;
}
