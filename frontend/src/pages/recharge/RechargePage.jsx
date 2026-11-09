import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import {
  CheckoutPanel,
  LedgerTable,
  OrdersTable,
  SkuGrid,
  createOrder,
  getLedgers,
  getOrder,
  getOrders,
  getSkus,
  isExpired,
  isResumable,
  remainingText,
} from "@/features/billing/index.js";

export function RechargePage() {
  const [skus, setSkus] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ledgers, setLedgers] = useState([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const LEDGER_PAGE_SIZE = 10;
  const [order, setOrder] = useState(null);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [loaded, setLoaded] = useState(false);
  const orderRef = useRef(null);

  async function openOrder(next, scroll = false) {
    orderRef.current = next;
    setOrder(next);
    if (
      next?.status === "pending" &&
      next.code_url &&
      !next.code_url.startsWith("mock://")
    ) {
      try {
        setQr(await QRCode.toDataURL(next.code_url, { width: 240, margin: 1 }));
      } catch {
        setQr("");
      }
    } else {
      setQr("");
    }
    if (scroll) {
      window.setTimeout(() => {
        document
          .querySelector(".checkout")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  }

  async function loadLedgers(page) {
    try {
      const ledgerData = await getLedgers({ page, pageSize: LEDGER_PAGE_SIZE });
      const items = ledgerData.items || [];
      setLedgers(items);
      setLedgerTotal(ledgerData.total ?? ledgerData.count ?? items.length);
      setLedgerPage(page);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  // 余额牌子已收进顶栏全局显示；这里下单/支付成功后发事件通知顶栏重查。
  function notifyBalanceChanged() {
    window.dispatchEvent(new Event("ql:balance-changed"));
  }

  async function load(resume = true) {
    try {
      const [skuData, orderData] = await Promise.all([
        getSkus(),
        getOrders(),
      ]);
      setSkus(skuData.items || []);
      const nextOrders = orderData.items || [];
      setOrders(nextOrders);
      setError("");
      await loadLedgers(1);
      const resumable = nextOrders.find(isResumable);
      if (resume && !orderRef.current && resumable) await openOrder(resumable);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!order || order.status !== "pending" || !order.code_url) return undefined;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      try {
        const next = await getOrder(order.order_no);
        if (stopped) return;
        if (next.status !== "pending" || isExpired(next)) {
          await openOrder(next);
          await load(false);
          notifyBalanceChanged();
        } else {
          orderRef.current = next;
          setOrder(next);
        }
      } catch {
        // A transient network error is not a payment failure.
      }
    }, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [order?.order_no, order?.status]);

  async function choose(sku) {
    setBusy(sku.code);
    setError("");
    try {
      const created = await createOrder(sku.code);
      const reused = orderRef.current?.order_no === created.order_no;
      await openOrder(created);
      toast(
        reused
          ? "已恢复未支付订单，二维码仍可继续使用"
          : "订单已创建，请扫码支付",
        "info",
      );
      await load(false);
      notifyBalanceChanged();
    } catch (requestError) {
      toast(requestError.message, "error");
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  const currentExpired = isExpired(order);

  if (!loaded) {
    return (
      <main className="account-page">
        <Loading
          text="正在读取账户信息…"
          error={error}
          onRetry={() => void load()}
        />
      </main>
    );
  }

  return (
    <main className="account-page">
      <PageHeader
        title="把每一次调用，算清楚。"
        description="充值购买工作台积分；AI 解析按实际用量扣减，余额与流水以工作台为准。"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <SkuGrid skus={skus} busy={busy} onChoose={(sku) => void choose(sku)} />
      <CheckoutPanel
        order={order}
        qr={qr}
        expired={currentExpired}
        remaining={clock && order ? remainingText(order) : ""}
      />
      <OrdersTable orders={orders} onResume={(item) => void openOrder(item, true)} />
      <LedgerTable
        ledgers={ledgers}
        page={ledgerPage}
        pageSize={LEDGER_PAGE_SIZE}
        total={ledgerTotal}
        onPageChange={(page) => void loadLedgers(page)}
      />
    </main>
  );
}
