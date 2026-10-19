import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"], capacitor: ["@capacitor/core", "@capacitor/local-notifications", "@capacitor/status-bar"] } } },
  },
  server: {
    proxy: {
      "/api": API,
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
});
