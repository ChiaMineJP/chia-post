import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
// Served from https://chiaminejp.github.io/chia-post/ on GitHub Pages, so the
// production build needs that base path; dev/preview stay at root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/chia-post/" : "/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
  },
}));
