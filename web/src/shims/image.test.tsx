import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Image from "next/image";

describe("shim next/image", () => {
  it("rend un <img> avec src, alt, width, height et className", () => {
    render(
      <Image
        src="/uploads/brands/a.svg"
        alt="Marque"
        width={32}
        height={24}
        className="h-full w-full object-contain"
        unoptimized
      />,
    );
    const img = screen.getByAltText("Marque");
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/uploads/brands/a.svg");
    expect(img.getAttribute("width")).toBe("32");
    expect(img.getAttribute("height")).toBe("24");
    expect(img.className).toBe("h-full w-full object-contain");
    expect(img.hasAttribute("unoptimized")).toBe(false);
  });

  it("fill → absolute inset-0 w-full h-full object-cover", () => {
    render(<Image src="/logo.png" alt="Logo" fill sizes="24px" />);
    const img = screen.getByAltText("Logo");
    expect(img.className).toBe("absolute inset-0 w-full h-full object-cover");
    expect(img.hasAttribute("fill")).toBe(false);
  });

  it("fill garde la className fournie par l'appelant", () => {
    render(<Image src="/logo.png" alt="Logo" fill className="object-contain" />);
    expect(screen.getByAltText("Logo").className).toBe(
      "absolute inset-0 w-full h-full object-contain",
    );
  });
});
