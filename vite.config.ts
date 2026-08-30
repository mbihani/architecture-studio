import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Architecture Studio frontend.
// The dev server proxies /api to the Express backend on port 3001 so the
// frontend and backend share a single origin during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
