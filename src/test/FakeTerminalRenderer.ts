import type { TerminalRenderer } from "@/features/ai/TerminalSessionStore";

/** xterm 없이 터미널 렌더러 동작을 기록하는 Fake. */
export class FakeTerminalRenderer implements TerminalRenderer {
  static created: FakeTerminalRenderer[] = [];

  static create = (): FakeTerminalRenderer => {
    const renderer = new FakeTerminalRenderer();
    FakeTerminalRenderer.created.push(renderer);
    return renderer;
  };

  written = "";
  parent: HTMLElement | null = null;
  disposed = false;
  size: { cols: number; rows: number } | null = { cols: 100, rows: 25 };
  private inputListener: (data: string) => void = () => {};

  attach(parent: HTMLElement): void {
    this.parent = parent;
  }

  detach(): void {
    this.parent = null;
  }

  write(data: string): void {
    this.written += data;
  }

  fit(): { cols: number; rows: number } | null {
    return this.size;
  }

  focus(): void {}

  onInput(listener: (data: string) => void): void {
    this.inputListener = listener;
  }

  /** 사용자가 키를 누르거나 터미널이 질의에 응답한 상황. */
  type(data: string): void {
    this.inputListener(data);
  }

  dispose(): void {
    this.disposed = true;
  }
}
