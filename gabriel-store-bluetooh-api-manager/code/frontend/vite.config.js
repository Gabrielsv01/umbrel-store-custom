import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes the built asset paths relative, so the bundle works no
// matter what path Umbrel serves the app under.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    // During `npm run dev`, proxy API + WebSocket + Swagger docs to the
    // FastAPI backend (in production FastAPI serves everything itself, so
    // this only matters for local dev).
    proxy: {
      "/api": "http://localhost:5157",
      "/ws": { target: "ws://localhost:5157", ws: true },
      "/docs": "http://localhost:5157",
      "/redoc": "http://localhost:5157",
      "/openapi.json": "http://localhost:5157",
    },
  },
});
