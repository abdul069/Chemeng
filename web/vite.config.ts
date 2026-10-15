import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.API_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": API,
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
});
