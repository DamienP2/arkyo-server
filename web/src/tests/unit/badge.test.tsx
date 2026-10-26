import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge (composant UI)", () => {
  it("rend le texte passé en children", () => {
    render(<Badge>En cours</Badge>);
    expect(screen.getByText("En cours")).toBeInTheDocument();
  });

  it("rend sans crasher avec la variante destructive", () => {
    render(<Badge variant="destructive">Erreur</Badge>);
    expect(screen.getByText("Erreur")).toBeInTheDocument();
  });
});
