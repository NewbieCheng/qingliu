import { createServer } from "vite";
import { chromium } from "playwright-core";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
// Local-only smoke runner. Override with QL_CHROMIUM_PATH to reuse an installed
// Chromium instead of hard-coding one machine's cache path.
const executablePath =
  process.env.QL_CHROMIUM_PATH ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";

const server = await createServer({
  root: projectRoot,
  server: { host: "127.0.0.1", port: 4179, strictPort: true },
  logLevel: "error",
});

await server.listen();
const base = "http://127.0.0.1:4179";
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().includes("Failed to load resource")
  ) {
    errors.push(`console: ${message.text()}`);
  }
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

// Back-end calls are mocked so routing and rendering can be checked deterministically.
await page.route("**/api/me", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      csrf: "test-csrf",
      user: { id: "u1", username: "admin", display: "测试管理员", role: "admin" },
    }),
  }),
);
await page.route("**/api/clients?**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      count: 1,
      clients: [
        {
          id: "0123456789abcdef0123456789abcdef",
          name: "合成客户 A",
          doc_count: 2,
          running: false,
          created: "2026-01-01T08:00:00Z",
        },
      ],
    }),
  }),
);
await page.route("**/api/clients/0123456789abcdef0123456789abcdef?**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      customer: { id: "0123456789abcdef0123456789abcdef", name: "合成客户 A", created: "2026-01-01T08:00:00Z", revision: 1 },
      fields: { company: "合成企业", rules: { related: [], positive: [], negative: [], require_counterparty: false } },
      docs: [],
      jobs: [],
      rows: [],
      reports: [],
      problems: [],
      summary: { original_income: 0, scope_excluded_income: 0, quarantined_income: 0, income: 0, included: 0, invalid_income: 0, average: 0, complete_month_average: null, month_count: 0, complete_month_count: 0, monthly: [], quarters: {} },
      busy: false,
      submitted_current: false,
      row_count: 0,
      source: "bank_statement",
      choices: ["bank_statement"],
      start: "2026-01-01",
      end: "2026-01-31",
    }),
  }),
);

await page.route("**/api/admin", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      users: [
        { id: "u1", username: "admin", display: "测试管理员", role: "admin", active: true },
      ],
    }),
  }),
);
let auditCalls = 0;
await page.route("**/api/admin/audit**", (route) => {
  auditCalls += 1;
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      count: 45,
      page: 1,
      page_size: 20,
      actions: [
        { value: "login", label: "登录", category: "account" },
        { value: "create_customer", label: "新建客户", category: "customer" },
      ],
      events: Array.from({ length: 20 }, (_, index) => ({
        seq: 100 - index,
        display: "测试管理员",
        action: "login",
        action_label: "登录",
        detail: "",
        created: "2026-01-01T08:00:00Z",
      })),
    }),
  });
});

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

await check("redirect to /login when signed out", async () => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"未登录"}' }),
  );
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector(".login-page");
  if (page.url() !== `${base}/login`) throw new Error(`unexpected url ${page.url()}`);
});

await check("login page has accessible form controls", async () => {
  const username = await page.getAttribute('input[name="username"]', "autocomplete");
  if (username !== "username") throw new Error("missing username autocomplete");
  await page.getByRole("button", { name: /显示密码/ }).waitFor();
});

await check("clients page renders and table row is navigable", async () => {
  await page.unroute("**/api/me");
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrf: "test-csrf", user: { id: "u1", username: "admin", display: "测试管理员", role: "admin" } }) }),
  );
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForSelector(".client-name");
  await page.getByText("合成客户 A").click();
  await page.waitForURL("**/clients/0123456789abcdef0123456789abcdef*");
  await page.waitForSelector(".case-page");
  if (!page.url().includes("?step=")) {
    // First visit defaults to upload; step is written once the user changes step.
  }
});

await check("case steps keep SPA navigation and update URL", async () => {
  await page.getByRole("button", { name: "2 确认归属" }).click();
  await page.waitForURL("**step=ownership");
  const title = await page.locator("h1").first().textContent();
  if (!title?.includes("合成客户 A")) throw new Error("case header missing");
});

await check("mobile viewport has no horizontal overflow", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px`);
});

await check("admin audit is paginated and cached across revisit", async () => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.getByText("最近操作记录").waitFor();
  const firstCalls = auditCalls;
  await page.getByRole("link", { name: "客户档案" }).click();
  await page.waitForSelector(".client-name");
  await page.getByRole("link", { name: "团队与权限" }).click();
  await page.waitForSelector("text=最近操作记录");
  if (auditCalls !== firstCalls) {
    throw new Error(`audit refetched within TTL: ${firstCalls} -> ${auditCalls}`);
  }
  await page.getByRole("button", { name: "刷新" }).last().click();
  if (auditCalls !== firstCalls + 1) {
    throw new Error("manual refresh did not bypass cache");
  }
});

await check("unknown route renders the not-found page", async () => {
  await page.goto(`${base}/not-a-real-page`, { waitUntil: "networkidle" });
  await page.getByText("这里没有可打开的工作底稿。").waitFor();
});

if (errors.length) {
  results.push({ name: "browser console", ok: false, error: errors.join("\n") });
} else {
  results.push({ name: "browser console", ok: true });
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
await server.close();

if (results.some((result) => !result.ok)) process.exit(1);
