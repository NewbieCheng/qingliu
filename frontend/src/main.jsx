import { createRoot } from "react-dom/client";
import "./shared/styles/index.css";
import { App } from "./app/App.jsx";
import { installCacheInspector } from "@/shared/cache/inspector.js";

// 缓存自检挂在 window.__qlCache 上，控制台可直接 report() / clear()。
// 没有可观测性的缓存等于没有缓存，出问题时无从判断是没写入还是 key 错了。
installCacheInspector();

createRoot(document.getElementById("root")).render(<App />);
