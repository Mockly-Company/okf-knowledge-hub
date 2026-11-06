import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalRenderer } from "@/features/ai/TerminalSessionStore";

/** xterm은 CSS 변수를 직접 못 읽으므로 디자인 토큰의 실제 값을 넘긴다. */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

class XtermRenderer implements TerminalRenderer {
  private readonly element = document.createElement("div");
  private readonly fitAddon = new FitAddon();
  private readonly terminal = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, Menlo, "D2Coding", "Malgun Gothic", monospace',
    fontSize: 13,
    scrollback: 5000,
    theme: {
      background: readToken("--color-code-background"),
      foreground: readToken("--color-code-text"),
    },
  });
  private opened = false;

  constructor() {
    this.element.style.height = "100%";
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.attachCustomKeyEventHandler((event) =>
      this.handleClipboardKey(event),
    );
  }

  /** Windows에서 Ctrl+C는 선택 영역이 있을 때만 복사, Ctrl+V는 브라우저 붙여넣기로 넘긴다. */
  private handleClipboardKey(event: KeyboardEvent): boolean {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.type !== "keydown") {
      return true;
    }
    const key = event.key.toLowerCase();
    if (key === "c" && this.terminal.hasSelection()) {
      void navigator.clipboard
        .writeText(this.terminal.getSelection())
        .catch((error: unknown) => {
          console.warn("[ai-terminal] copy failed", error);
        });
      this.terminal.clearSelection();
      event.preventDefault();
      return false;
    }
    return key !== "v";
  }

  attach(parent: HTMLElement): void {
    parent.appendChild(this.element);
    if (!this.opened) {
      this.terminal.open(this.element);
      this.opened = true;
    }
  }

  detach(): void {
    this.element.remove();
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  fit(): { cols: number; rows: number } | null {
    if (!this.element.isConnected) {
      return null;
    }
    const proposed = this.fitAddon.proposeDimensions();
    if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
      return null;
    }
    this.fitAddon.fit();
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  focus(): void {
    this.terminal.focus();
  }

  onInput(listener: (data: string) => void): void {
    this.terminal.onData(listener);
  }

  dispose(): void {
    this.terminal.dispose();
    this.element.remove();
  }
}

export const createXtermRenderer = (): TerminalRenderer => new XtermRenderer();
