import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("path alias @/", () => {
  it("résout @/lib/utils et exporte une fonction cn", () => {
    expect(typeof cn).toBe("function");
  });

  it("cn fusionne les classes correctement", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
