/// <reference types="vite/client" />
import css from "./tokens.css?raw";
import { describe, expect, it } from "vitest";

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing color token: ${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (bright + 0.05) / (dark + 0.05);
}

describe("OkHub color tokens", () => {
  it.each([
    ["--color-on-primary", "--color-primary"],
    ["--color-on-primary", "--color-primary-hover"],
    ["--color-primary-text", "--color-surface"],
    ["--color-primary-text", "--color-primary-soft"],
    ["--color-text-muted", "--color-surface"],
    ["--color-text-muted", "--color-canvas"],
    ["--color-success", "--color-success-soft"],
    ["--color-info", "--color-info-soft"],
    ["--color-warning", "--color-warning-soft"],
    ["--color-error", "--color-error-soft"],
    ["--color-error", "--color-error-hover"],
  ])("keeps %s readable on %s", (foreground, background) => {
    expect(contrast(token(css, foreground), token(css, background))).toBeGreaterThanOrEqual(4.5);
  });
});
