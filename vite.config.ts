import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client connects to /ws on its own origin. In dev, proxy /ws to a local
// backend on :8080 so the WebSocket URL is identical in both environments.
export default defineConfig({
  // Relative asset paths so the same bundle works on any static host
  // (including subpath hosting) or served by a backend.
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: { outDir: "dist" },
});
