import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// 本地开发服务：前端跑在 5173，/api 与 /health 反向代理到生产后端
// （生产后端自己连生产库，所以本地不需要数据库、也不需要 Go 二进制）。
const target = "https://qingliu.bujiaban.top";

// 生产后端对写请求校验 Origin（必须是主站 Origin），代理转发时要改写，
// 否则本地页面调登录/保存会被 403。生产 Cookie 带 Secure，本地是 http，
// 转发时去掉 Secure，localhost 才存得住会话。
function prodProxy() {
  return {
    target,
    changeOrigin: true,
    secure: true,
    headers: { Origin: target, Referer: `${target}/` },
    configure(proxy) {
      proxy.on("proxyRes", (proxyRes) => {
        const cookies = proxyRes.headers["set-cookie"];
        if (cookies) {
          proxyRes.headers["set-cookie"] = cookies.map((cookie) =>
            cookie.replace(/;\s*Secure/gi, ""),
          );
        }
      });
    },
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
      "/api": prodProxy(),
      "/health": prodProxy(),
    },
  },
});
