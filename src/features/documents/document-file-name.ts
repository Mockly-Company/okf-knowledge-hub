/** A document title is not a filename: dots and punctuation are word separators. */
export function documentFileName(title: string): string {
  const stem = title.trim().normalize("NFC")
    .replace(/[A-Z]/g, letter => letter.toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return stem ? `${stem}.md` : "";
}
