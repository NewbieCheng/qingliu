import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { navigate } from "./router.jsx";

const STATUS = {
  pending: "待支付",
  paid: "已支付",
  closed: "已关闭",
  failed: "失败",
};
const CHANGE = {
  1: "注册赠送",
  2: "套餐发放",
  3: "AI 消耗",
  4: "人工调整",
  5: "预授权退回",
  6: "充值到账",
};
const SERVICE_ROLE = { admin: "管理员", sales: "业务员", reviewer: "复核员" };

export async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers:
      body === undefined
        ? { "X-CSRF-Token": window.__qlCsrf || "" }
        : {
            "Content-Type": "application/json",
            "X-CSRF-Token": window.__qlCsrf || "",
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) navigate("/login");
    throw new Error(data.error || "请求未完成，请稍后重试");
  }
  return data;
}

function fen(value) {
  return `¥${(Number(value || 0) / 100).toFixed(2)}`;
}

function stamp(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN");
}

export function RechargePage() {
  const [skus, setSkus] = useState([]);
  const [balance, setBalance] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ledgers, setLedgers] = useState([]);
  const [order, setOrder] = useState(null);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [skuData, balanceData, orderData, ledgerData] = await Promise.all([
        request("/api/billing/skus"),
        request("/api/billing/balance"),
        request("/api/billing/orders?page=1&page_size=10"),
        request("/api/billing/ledgers?page=1&page_size=10"),
      ]);
      setSkus(skuData.items || []);
      setBalance(balanceData);
      setOrders(orderData.items || []);
      setLedgers(ledgerData.items || []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!order || order.status !== "pending" || !order.code_url) return;
    const timer = setInterval(async () => {
      try {
        const next = await request(`/api/billing/orders/${order.order_no}`);
        setOrder(next);
        if (next.status !== "pending") {
          setQr("");
          await load();
        }
      } catch {
        // keep polling; a transient network error is not a payment failure
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [order?.order_no, order?.status]);

  async function choose(sku) {
    setBusy(sku.code);
    setError("");
    try {
      const created = await request("/api/billing/orders", {
        sku_code: sku.code,
      });
      setOrder(created);
      if (created.code_url && !created.code_url.startsWith("mock://")) {
        setQr(
          await QRCode.toDataURL(created.code_url, { width: 240, margin: 1 }),
        );
      } else {
        setQr("");
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const points = balance?.points_balance ?? 0;

  return (
    <main className="account-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">账户与额度</p>
          <h1>把每一次调用，算清楚。</h1>
          <p className="muted">
            充值购买工作台积分；AI 解析按实际用量扣减，余额与流水以工作台为准。
          </p>
        </div>
        <div className="balance-chip">
          <span>可用积分</span>
          <strong>{Number(points).toLocaleString("zh-CN")}</strong>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <div className="section-title">
          <h2>选择套餐</h2>
          <p>价格与积分由工作台后台维护，支付成功后自动到账。</p>
        </div>
        {skus.length === 0 && (
          <p className="muted">暂未配置可售套餐，请联系管理员。</p>
        )}
        <div className="sku-grid">
          {skus.map((sku) => (
            <article
              className={`sku-card ${sku.featured ? "featured" : ""}`}
              key={sku.code}
            >
              <div className="sku-head">
                <h3>{sku.name}</h3>
                {sku.badge && <span className="badge">{sku.badge}</span>}
              </div>
              <p className="sku-price">
                {fen(sku.amount_fen)}
                {sku.subscription && <small>/ 月</small>}
              </p>
              {sku.original_amount_fen > 0 && (
                <p className="sku-original">
                  原价 {fen(sku.original_amount_fen)}
                </p>
              )}
              <p className="sku-points">
                {sku.subscription ? "每月 " : ""}
                {Number(sku.points).toLocaleString("zh-CN")} 积分
                {sku.bonus_points ? ` · 赠 ${sku.bonus_points}` : ""}
              </p>
              <ul>
                {sku.features?.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button
                className="primary"
                disabled={busy === sku.code}
                onClick={() => void choose(sku)}
              >
                {busy === sku.code ? "正在下单…" : "立即充值"}
              </button>
            </article>
          ))}
        </div>
      </section>

      {order && (
        <section className="card checkout">
          <div className="checkout-main">
            <p className="eyebrow">订单 {order.order_no}</p>
            <h2>{order.sku_name}</h2>
            <p className="muted">
              {fen(order.amount_fen)} ·{" "}
              {Number(order.points || 0).toLocaleString("zh-CN")} 积分
              {order.bonus_points ? ` + ${order.bonus_points}` : ""}
            </p>
            <p className={`badge ${order.status === "paid" ? "" : "amber"}`}>
              {STATUS[order.status] || order.status}
            </p>
            {order.status === "pending" &&
              order.code_url &&
              !order.code_url.startsWith("mock://") && (
                <p className="muted">
                  请使用微信扫码支付，支付完成后本页会自动刷新。
                </p>
              )}
            {order.status === "pending" &&
              (!order.code_url || order.code_url.startsWith("mock://")) && (
                <p className="muted">
                  当前为人工/测试通道。请把订单号发给管理员确认到账。
                </p>
              )}
            {order.status === "paid" && (
              <p className="success">积分已到账，余额已刷新。</p>
            )}
          </div>
          {qr && <img className="checkout-qr" src={qr} alt="微信支付二维码" />}
        </section>
      )}

      <section className="card">
        <div className="section-title">
          <h2>最近订单</h2>
          <p>只显示当前账号的充值订单。</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>订单号</th>
                <th>套餐</th>
                <th>金额</th>
                <th>积分</th>
                <th>状态</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((item) => (
                <tr key={item.order_no}>
                  <td>{item.order_no}</td>
                  <td>{item.sku_name}</td>
                  <td>{fen(item.amount_fen)}</td>
                  <td>
                    {Number(item.points || 0) + Number(item.bonus_points || 0)}
                  </td>
                  <td>
                    <span
                      className={`badge ${item.status === "paid" ? "" : "amber"}`}
                    >
                      {STATUS[item.status] || item.status}
                    </span>
                  </td>
                  <td className="muted">{stamp(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && <p className="empty">还没有充值订单。</p>}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>积分流水</h2>
          <p>充值与 AI 消耗都在这里留痕。</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>变动</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.map((item) => (
                <tr key={item.ledger_id}>
                  <td className="muted">
                    {stamp(item.occurred_at || item.created_at)}
                  </td>
                  <td>{CHANGE[item.change_type] || item.change_type}</td>
                  <td
                    className={
                      item.points_delta >= 0 ? "number positive" : "number"
                    }
                  >
                    {item.points_delta >= 0 ? "+" : ""}
                    {item.points_delta}
                  </td>
                  <td>{item.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ledgers.length === 0 && <p className="empty">还没有积分流水。</p>}
      </section>
    </main>
  );
}

export function ProfilePage() {
  const [me, setMe] = useState(null);
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([request("/api/me"), request("/api/billing/balance")])
      .then(([profile, wallet]) => {
        setMe(profile.user);
        setBalance(wallet);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function changePassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/password", {
        current_password: form.get("current_password"),
        new_password: form.get("new_password"),
      });
      setNotice("密码已更新，请使用新密码重新登录。");
      event.currentTarget.reset();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me)
    return (
      <main>
        <p className={error ? "error" : "muted"}>
          {error || "正在读取个人信息…"}
        </p>
      </main>
    );

  return (
    <main className="account-page">
      <div className="page-title">
        <div>
          <p className="eyebrow">个人信息</p>
          <h1>{me.display}</h1>
          <p className="muted">
            账号由工作台统一管理；清流只保留业务角色与本地工作记录。
          </p>
        </div>
        <div className="balance-chip">
          <span>可用积分</span>
          <strong>
            {Number(balance?.points_balance || 0).toLocaleString("zh-CN")}
          </strong>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}

      <section className="card profile-grid">
        <div>
          <span className="muted">登录账号</span>
          <strong>{me.email || me.username}</strong>
        </div>
        <div>
          <span className="muted">显示名</span>
          <strong>{me.display || "—"}</strong>
        </div>
        <div>
          <span className="muted">服务角色</span>
          <strong>
            {SERVICE_ROLE[me.service_role] || SERVICE_ROLE[me.role] || me.role}
          </strong>
        </div>
        <div>
          <span className="muted">工作台账号</span>
          <strong>{me.workbench_linked ? "已绑定" : "本地过渡账号"}</strong>
        </div>
        <div>
          <span className="muted">工作台用户 ID</span>
          <strong>{me.workbench_user_id || "—"}</strong>
        </div>
        <div>
          <span className="muted">积分余额</span>
          <strong>
            {Number(balance?.points_balance || 0).toLocaleString("zh-CN")}
          </strong>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>修改密码</h2>
          <p>已绑定工作台时，密码修改会同步到工作台账号。</p>
        </div>
        <form className="profile-form" onSubmit={changePassword}>
          <label className="field">
            <span>当前密码</span>
            <input
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>新密码（10 至 72 字节）</span>
            <input
              name="new_password"
              type="password"
              minLength="10"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "正在保存…" : "更新密码"}
          </button>
        </form>
      </section>

      <section className="card actions-row">
        <a className="button-link" href="/recharge">
          去充值
        </a>
        <button
          className="ghost"
          onClick={async () => {
            await request("/api/logout", {});
            navigate("/login");
          }}
        >
          退出登录
        </button>
      </section>
    </main>
  );
}
