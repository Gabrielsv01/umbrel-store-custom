import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production the backend serves the built files, so API calls are relative
// (/api). In dev, proxy /api to the FastAPI server.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:5124",
    },
  },
  build: {
    outDir: "dist",
  },
});
