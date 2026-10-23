const relativeTime = new Intl.RelativeTimeFormat("ko-KR", { numeric: "always" });
const absoluteTime = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeStyle: "long" });

function relativeLabel(value: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(value)) / 1000);
  if (seconds < 60) return "방금 전";
  const units = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ] as const;
  const [size, unit] = units.find(([size]) => seconds >= size)!;
  return relativeTime.format(-Math.floor(seconds / size), unit);
}

/** Compact display; machine-readable and exact local timestamps remain available. */
export function TaskTime({ value, now = Date.now(), format = "relative" }: { value: string; now?: number; format?: "relative" | "absolute" }) {
  const exact = absoluteTime.format(new Date(value));
  const label = format === "absolute" ? exact : relativeLabel(value, now);
  return <time dateTime={value} title={exact} aria-label={format === "relative" ? `${label}, ${exact}` : undefined}>{label}</time>;
}
