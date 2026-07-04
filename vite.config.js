import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.js",
    // Vitest owns *.spec.{js,jsx}; backend node:test files stay on *.test.js
    include: ["tests/**/*.spec.{js,jsx}"],
    exclude: ["node_modules", "dist", "e2e"]
  }
});
