import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// 本地开发服务：前端跑在 5173，/api 与 /health 反向代理到本机清流 Go。
// 联调本机工作台时：清流 .env 的 WORKBENCH_BASE_URL=http://127.0.0.1:8080。
// 若要临时连生产清流，把 target 改回 https://qingliu.bujiaban.top 并恢复 secure/Origin 改写。
const target = "http://127.0.0.1:8787";

function localProxy() {
  return {
    target,
    changeOrigin: true,
    secure: false,
  };
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // 编辑器的原子写会先在 src 下建临时目录，Windows 上被 watch 到会 EBUSY 崩掉 dev server。
    watch: { ignored: ["**/.*.tmpdir/**", "**/*.tmp"] },
    proxy: {
      "/api": localProxy(),
      "/health": localProxy(),
    },
  },
});
