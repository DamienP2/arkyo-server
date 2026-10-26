import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "happy-dom",
      globals: true,
      setupFiles: ["./src/tests/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
);
