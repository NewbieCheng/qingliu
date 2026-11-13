import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { RequestErrorAlert } from "@/shared/ui/RequestErrorAlert.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import {
  BalanceStrip,
  LedgerTable,
  getBalance,
  getEmbedRechargeUrl,
  getLedgers,
} from "@/features/billing/index.js";

export function RechargePage() {
  const { t } = useI18n();
  const [embedUrl, setEmbedUrl] = useState("");
  const [balance, setBalance] = useState(null);
  const [ledgers, setLedgers] = useState([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const LEDGER_PAGE_SIZE = 10;
  const [error, setError] = useState("");
  const [errorRequestId, setErrorRequestId] = useState("");
  const [loaded, setLoaded] = useState(false);

  function captureError(requestError) {
    setError(requestError?.message || "");
    setErrorRequestId(requestError?.requestId || "");
  }

  async function loadLedgers(page) {
    try {
      const ledgerData = await getLedgers({ page, pageSize: LEDGER_PAGE_SIZE });
      const items = ledgerData.items || [];
      setLedgers(items);
      setLedgerTotal(ledgerData.total ?? ledgerData.count ?? items.length);
      setLedgerPage(page);
      return null;
    } catch (requestError) {
      return requestError;
    }
  }

  function notifyBalanceChanged() {
    window.dispatchEvent(new Event("ql:balance-changed"));
  }

  async function load(withEmbed = true) {
    const failures = [];
    if (withEmbed) {
      try {
        const res = await getEmbedRechargeUrl();
        setEmbedUrl(res?.url || "");
      } catch (requestError) {
        failures.push(requestError);
      }
    }
    try {
      setBalance(await getBalance());
    } catch (requestError) {
      failures.push(requestError);
    }
    const ledgerError = await loadLedgers(1);
    if (ledgerError) failures.push(ledgerError);
    if (failures[0]) captureError(failures[0]);
    else {
      setError("");
      setErrorRequestId("");
    }
    setLoaded(true);
  }

  useEffect(() => {
    void load(true);
  }, []);

  useEffect(() => {
    function onMessage(event) {
      const data = event?.data;
      if (data && data.type === "NO996_PAYMENT_SUCCESS") {
        toast(t("billing.order_paid") || "充值成功，积分已到账", "success");
        void load(false);
        notifyBalanceChanged();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [t]);

  if (!loaded) {
    return (
      <main className="account-page">
        <Loading
          text={t("billing.recharge_loading")}
          error={error}
          onRetry={() => void load(true)}
        />
      </main>
    );
  }

  return (
    <main className="account-page">
      <PageHeader
        title={t("billing.recharge_title")}
        description={t("billing.recharge_desc")}
      />
      {error ? (
        <RequestErrorAlert message={error} requestId={errorRequestId} />
      ) : null}
      <BalanceStrip balance={balance} />
      {embedUrl ? (
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <iframe
            src={embedUrl}
            title={t("billing.recharge_title")}
            style={{
              width: "100%",
              minHeight: "760px",
              border: "none",
              display: "block",
            }}
          />
        </section>
      ) : null}
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
