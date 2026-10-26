/**
 * Point d'entrée de la SPA : le routeur (`router.tsx`) porte l'arbre des URL
 * d'arkyo ; la racine (`app/root.tsx`) monte les providers de arkyo:app/layout.tsx.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createAppRouter } from "./router";
import "./app/globals.css";
import "./fonts.css";

const router = createAppRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
