import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const src = path.resolve(import.meta.dirname, "src");

/**
 * Les fichiers repris d'arkyo (Next.js) sont copiés tels quels : leurs imports
 * `next/*`, `next-auth/react` et `next-intl` sont redirigés vers les shims de
 * `src/shims`. Les mêmes correspondances figurent dans `tsconfig.json`.
 */
export const alias = [
  { find: /^next\/navigation$/, replacement: path.join(src, "shims/next/navigation.ts") },
  { find: /^next\/link$/, replacement: path.join(src, "shims/next/link.tsx") },
  { find: /^next\/image$/, replacement: path.join(src, "shims/next/image.tsx") },
  { find: /^next-auth\/react$/, replacement: path.join(src, "shims/next-auth-react.tsx") },
  { find: /^next-intl$/, replacement: path.join(src, "shims/next-intl.tsx") },
  { find: /^@\//, replacement: `${src}/` },
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  server: {
    proxy: {
      "/api": "http://localhost:8090",
      "/uploads": "http://localhost:8090",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
