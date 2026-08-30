import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone React Flow POC — no API proxy, no server, no iframe.
// Everything is bundled JS served same-origin from dist/.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
