import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "src");
const failures = [];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

const sourceFiles = files(root).filter((file) =>
  [".js", ".jsx"].includes(path.extname(file)),
);

for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const source = fs.readFileSync(file, "utf8");

  if (relative.startsWith("shared/")) {
    if (/from\s+["']@\/(features|pages)\//.test(source)) {
      failures.push(`${relative}: shared 不能依赖 features/pages`);
    }
  }

  if (relative.startsWith("features/")) {
    const ownFeature = relative.split("/")[1];
    const imports = [
      ...source.matchAll(/from\s+["']@\/features\/([^/"']+)([^"']*)["']/g),
    ];
    for (const match of imports) {
      const target = match[1];
      const rest = match[2];
      if (target === ownFeature) {
        failures.push(`${relative}: 同一 feature 内部应使用相对路径`);
      } else if (!rest.endsWith("/index.js")) {
        failures.push(`${relative}: 跨 feature 依赖必须走 @/features/${target}/index.js`);
      }
    }
  }

  if (/window\.location\.(assign|href|replace)\s*=/.test(source)) {
    failures.push(`${relative}: 内部跳转必须使用 navigate()，不要整页刷新`);
  }

  const legacyModules = [
    "account.jsx",
    "ai_panel.jsx",
    "api.js",
    "loading.jsx",
    "router.jsx",
    "shell.jsx",
    "style.css",
    "toast.jsx",
    "ui.jsx",
    "upload.jsx",
  ];
  for (const legacy of legacyModules) {
    if (new RegExp(`from\\\\s+["'](\\\\\\/|\\\\\\.\\\\\\.\\\\\\/)${legacy.replace(".", "\\.")}["']`).test(source)) {
      failures.push(`${relative}: 引用了已下线的旧扁平模块 ${legacy}`);
    }
  }

  if (relative.startsWith("pages/")) {
    const rawFetch = /\bfetch\s*\(/.test(source) || /from\s+["']@\/shared\/api\/client\.js["']/.test(source);
    if (rawFetch) failures.push(`${relative}: 页面不要直接请求接口，请调用 feature api`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`architecture check passed: ${sourceFiles.length} files`);
