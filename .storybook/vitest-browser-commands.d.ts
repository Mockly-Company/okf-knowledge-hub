import "vitest/internal/browser";

declare module "vitest/internal/browser" {
  interface BrowserCommands {
    pointerDown(selector: string): Promise<void>;
    pointerUp(): Promise<void>;
    setReducedMotion(reduced: boolean): Promise<void>;
  }
}
