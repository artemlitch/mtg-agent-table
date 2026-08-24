import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The Bun server on :4780 owns the game; Vite only serves the UI. In dev it
// proxies the API and the websocket straight through, so `bun run dev` never
// touches the running game's state.
const SERVER = `http://localhost:${process.env.PORT ?? 4780}`;
const page = (name: string) => fileURLToPath(new URL(`./client/${name}.html`, import.meta.url));

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    port: 4781,
    strictPort: true,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/ws": { target: SERVER, ws: true },
    },
  },
  build: {
    // straight into the directory the Bun server already serves, so a built
    // app needs no server change and the Electron shell keeps working
    outDir: "../web",
    emptyOutDir: true,
    rollupOptions: {
      input: { main: page("index"), soundlab: page("soundlab"), swap: page("swap") },
    },
  },
});
