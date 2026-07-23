import { describe, expect, it } from "vitest";
import { parseDisplayDensity } from "./display-density";

describe("parseDisplayDensity", () => {
  it.each(["default", "compact"])("accepts %s", (value) => {
    expect(parseDisplayDensity(value)).toBe(value);
  });

  it.each([undefined, null, "dense", 1])("falls back for %s", (value) => {
    expect(parseDisplayDensity(value)).toBe("default");
  });
});
