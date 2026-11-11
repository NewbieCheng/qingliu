/**
 * 表头 aliases → standard 行，口径对齐 server/domain.go 的 standard()。
 * 方向认不出 → quality: invalid，禁止猜收支。
 */

/** 与 Go aliases 对齐；并补钱包 CSV 常见表头（金额(元) 等，PDF 路径已认）。 */
export const ALIASES = {
  date: ["交易日期", "日期", "记账日期", "交易时间"],
  time: ["交易时间", "时间", "记账时间"],
  income: ["收入金额", "收入", "贷方发生额"],
  expense: ["支出金额", "支出", "借方发生额"],
  counterparty: ["对手方", "交易对方", "对方户名", "对方账户名"],
  counter_account: ["对手账号", "对方账号", "对方卡号/账号"],
  payer: ["转出账户名称"],
  payer_account: ["转出账号(尾4)", "转出账号"],
  payee: ["转入账户名称"],
  payee_account: ["转入账号(尾4)", "转入账号"],
  memo: ["交易摘要/备注", "摘要", "备注", "交易摘要", "交易名称", "商品说明", "交易类型"],
  channel: ["交易渠道", "渠道", "支付方式", "收/付款方式"],
  account: ["本方账号", "账户"],
  account_type: ["账户类型"],
  direction: ["收支方向", "方向", "收/支", "收/支/其他", "收支"],
  amount: ["金额", "交易金额", "金额(元)", "交易金额(元)"],
  transaction_id: ["交易单号", "订单号", "交易订单号"],
};

const DIRECTION_MAP = {
  收入: "income",
  进账: "income",
  贷: "income",
  贷方: "income",
  income: "income",
  支出: "expense",
  出账: "expense",
  借: "expense",
  借方: "expense",
  expense: "expense",
  不计收支: "neutral",
  其他: "neutral",
  neutral: "neutral",
};

const AMOUNT_RE = /^[+-]?\d+(\.\d+)?$/;

export function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join("");
}

export function cents(raw) {
  let s = String(raw ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/,/g, "")
    .replace(/[¥￥]/g, "");
  if (!AMOUNT_RE.test(s)) return { ok: false, error: "金额格式无效" };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: "金额无效" };
  if (Math.abs(n) > 1e14) return { ok: false, error: "金额超出范围" };
  const scaled = Math.round(Math.abs(n) * 100 + Number.EPSILON);
  return { ok: true, value: n < 0 ? -scaled : scaled };
}

export function isoDate(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/[/.]/g, "-");
  if (s.length >= 10) s = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: "日期无效" };
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) return { ok: false, error: "日期无效" };
  return { ok: true, value: s };
}

function pickField(clean, key) {
  const names = [key, ...(ALIASES[key] || [])];
  for (const name of names) {
    const hit = clean[normalizeKey(name)];
    if (hit !== undefined) return String(hit ?? "");
  }
  return "";
}

function failRow(base, message) {
  const date = isoDate(base.date);
  return {
    ...base,
    quality: "invalid",
    income: 0,
    expense: 0,
    direction: "unknown",
    error: message,
    date: date.ok ? date.value : "",
  };
}

/**
 * @param {Record<string, string>} raw
 * @param {string} source
 * @param {string} locator
 */
export function mapToStandard(raw, source, locator) {
  const clean = {};
  for (const [key, value] of Object.entries(raw || {})) {
    clean[normalizeKey(key)] = value;
  }

  const base = {
    source,
    page: 0,
    locator,
    raw: JSON.stringify(raw || {}),
    quality: "structured",
    duplicate: false,
  };

  for (const key of Object.keys(ALIASES)) {
    base[key] = pickField(clean, key);
  }

  const date = isoDate(base.date);
  if (!date.ok) return failRow(base, "日期无效");
  base.date = date.value;

  let direction = DIRECTION_MAP[normalizeKey(base.direction)] || "";
  const hasSplit =
    String(base.income).trim() !== "" || String(base.expense).trim() !== "";

  let income = 0;
  let expense = 0;

  if (hasSplit) {
    if (String(base.income).trim() !== "") {
      const parsed = cents(base.income);
      if (!parsed.ok) return failRow(base, parsed.error);
      income = parsed.value;
    }
    if (String(base.expense).trim() !== "") {
      const parsed = cents(base.expense);
      if (!parsed.ok) return failRow(base, parsed.error);
      expense = parsed.value;
    }
    if (income < 0 || expense < 0 || (income !== 0 && expense !== 0)) {
      return failRow(base, "收入/支出列符号冲突");
    }
    let actual = "";
    if (income !== 0) actual = "income";
    else if (expense !== 0) actual = "expense";
    if (!actual) return failRow(base, "零金额没有明确方向");
    if (direction && direction !== actual) {
      return failRow(base, "方向字段与金额列矛盾");
    }
    direction = actual;
  } else {
    const amount = cents(base.amount);
    if (!amount.ok || amount.value < 0 || !direction) {
      return failRow(base, "方向或金额未确认");
    }
    if (direction === "income") income = amount.value;
    if (direction === "expense") expense = amount.value;
  }

  base.income = income;
  base.expense = expense;
  base.direction = direction;

  if (!base.counterparty) {
    base.counterparty =
      direction === "income" ? base.payer : base.payee;
  }
  if (!base.counter_account) {
    base.counter_account =
      direction === "income" ? base.payer_account : base.payee_account;
  }
  if (!base.account) {
    base.account =
      direction === "income" ? base.payee_account : base.payer_account;
  }

  return base;
}

export function zipHeader(header, cells) {
  const raw = {};
  for (let i = 0; i < header.length; i += 1) {
    const key = String(header[i] ?? "").trim();
    if (!key) continue;
    raw[key] = i < cells.length ? String(cells[i] ?? "") : "";
  }
  return raw;
}

export function rowEmpty(raw) {
  return Object.values(raw || {}).every((value) => String(value ?? "").trim() === "");
}

/**
 * @param {string[][]} records
 * @param {string} source
 * @param {string} filename
 */
export function rowsFromRecords(records, source, filename) {
  if (!records || records.length < 2) {
    return { ok: false, reason: "empty" };
  }
  const header = records[0];
  const rows = [];
  for (let i = 1; i < records.length; i += 1) {
    const raw = zipHeader(header, records[i] || []);
    if (rowEmpty(raw)) continue;
    rows.push(mapToStandard(raw, source, `row:${i + 1}`));
  }
  if (!rows.length) return { ok: false, reason: "empty" };
  return {
    ok: true,
    rows,
    meta: {
      source,
      method: "client-parse",
      filename,
      rows: rows.length,
      status: "success",
      pages: 0,
    },
  };
}
