import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface DeviceCodeCopyProps {
  code: string;
  writeClipboard?: (text: string) => Promise<void>;
}

type CopyStatus = "idle" | "copied" | "error";

export function DeviceCodeCopy({
  code,
  writeClipboard = writeText,
}: DeviceCodeCopyProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    setStatus("idle");
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, [code]);

  const copy = async () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    try {
      await writeClipboard(code);
      setStatus("copied");
      resetTimer.current = window.setTimeout(() => setStatus("idle"), 2_000);
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="device-code-copy">
      <div className="workspace-connection__code-row">
        <code>{code}</code>
        <Button
          type="button"
          variant="secondary"
          aria-label="사용자 코드 복사"
          onClick={() => void copy()}
        >
          {status === "copied" ? (
            <Check aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden="true" strokeWidth={1.75} />
          )}
          {status === "copied" ? "복사됨" : "코드 복사"}
        </Button>
      </div>
      {status === "error" ? (
        <p className="device-code-copy__error" role="alert">
          복사하지 못했습니다. 코드를 직접 선택해 주세요.
        </p>
      ) : null}
    </div>
  );
}
