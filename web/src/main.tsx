/**
 * Point d'entrée de la SPA : le routeur (`router.tsx`) porte l'arbre des URL
 * d'arkyo ; la racine (`app/root.tsx`) monte les providers de arkyo:app/layout.tsx.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { onCaughtError, onRouterError } from "next/navigation";
import { createAppRouter } from "./router";
import "./app/globals.css";
import "./fonts.css";

const router = createAppRouter();

// `redirect()` / `notFound()` levés au rendu : navigations, pas des erreurs
// (ni pour React, ni pour la frontière d'erreur de react-router).
createRoot(document.getElementById("root")!, { onCaughtError }).render(
  <StrictMode>
    <RouterProvider router={router} onError={onRouterError} />
  </StrictMode>,
);
