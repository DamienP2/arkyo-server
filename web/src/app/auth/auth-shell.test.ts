// arkyo-server: habillage Strata — les champs et le bouton de connexion suivent la maquette validée.
import { INPUT_CLASS, SUBMIT_CLASS } from "./auth-shell";

test("champ de connexion : h-8, rayon 6 px, fond --muted, focus bordure accent sans anneau", () => {
  expect(INPUT_CLASS).toContain("h-8");
  expect(INPUT_CLASS).toContain("rounded-md");
  expect(INPUT_CLASS).toContain("bg-[var(--muted)]");
  expect(INPUT_CLASS).toContain("text-[13px]");
  expect(INPUT_CLASS).toContain("focus-visible:border-[var(--accent)]");
  expect(INPUT_CLASS).not.toContain("ring");
});

test("bouton principal : h-8, rounded-lg, semibold sur --accent", () => {
  expect(SUBMIT_CLASS).toContain("h-8");
  expect(SUBMIT_CLASS).toContain("rounded-lg");
  expect(SUBMIT_CLASS).toContain("font-semibold");
  expect(SUBMIT_CLASS).toContain("bg-[var(--accent)]");
  expect(SUBMIT_CLASS).toContain("text-[var(--accent-foreground)]");
});
