import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes the built asset paths relative, so the bundle works no
// matter what path Umbrel serves the app under.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    // During `npm run dev`, proxy API + WebSocket to the FastAPI backend.
    proxy: {
      "/api": "http://localhost:5157",
      "/ws": { target: "ws://localhost:5157", ws: true },
    },
  },
});
