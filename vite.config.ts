import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = env.VITE_API_BASE_URL || "/api";
  const backendPort = env.SENTINEL_PORT || "8787";
  const proxyTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${backendPort}`;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: apiBaseUrl.startsWith("/")
        ? {
            [apiBaseUrl]: {
              target: proxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
