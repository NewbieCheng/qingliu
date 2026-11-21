// 对手方显示：原件里真的没有对方时，别只写「原件未记载」。
//
// 银行流水里有一类交易本来就没有对方——归还贷款利息、取现、结息、手续费，
// 对方列在原件里就是 `/` 或 `///`。此时写「原件未记载」会让业务员以为
// 解析漏了，其实数据是完整的，只是这类交易不涉及第三方。
// 这里按摘要关键字给出人话解释，区分「真的没有对方」和「确实没抽到」。

const INTERNAL_PATTERNS = [
  ["归还贷款", "银行内部·归还贷款"],
  ["贷款利息", "银行内部·贷款利息"],
  ["取现", "银行内部·取现"],
  ["付息", "银行内部·结息"],
  ["结息", "银行内部·结息"],
  ["手续费", "银行内部·手续费"],
  ["工本费", "银行内部·工本费"],
  ["年费", "银行内部·年费"],
  ["利息支出", "银行内部·利息支出"],
  ["代扣", "银行内部·代扣"],
  ["税费", "银行内部·税费"],
];

/** 返回 { text, kind }：kind=party 有对手方 / internal 银行内部 / missing 真缺。 */
export function counterpartyDisplay(row) {
  const party = String(row?.counterparty || "").trim();
  if (party) return { text: party, kind: "party" };
  const memo = String(row?.memo || "");
  for (const [needle, label] of INTERNAL_PATTERNS) {
    if (memo.includes(needle)) return { text: label, kind: "internal" };
  }
  return { text: "", kind: "missing" };
}
