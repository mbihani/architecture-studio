import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Self-contained Vite config for the React Flow architecture-viewer POC.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
