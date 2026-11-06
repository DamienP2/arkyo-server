import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// `waitFor` / `findBy*` : 5 s au lieu de 1 s (redirections vers des pages
// chargées à la demande sur une machine chargée).
configure({ asyncUtilTimeout: 5000 });
