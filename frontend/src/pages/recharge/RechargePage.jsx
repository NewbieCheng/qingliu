import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { RequestErrorAlert } from "@/shared/ui/RequestErrorAlert.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { ChromeAccessory } from "@/shared/layout/ChromeTitle.jsx";
import {
  LedgerTable,
  getEmbedRechargeUrl,
  getLedgers,
} from "@/features/billing/index.js";

const TAB_PACKAGES = "packages";
const TAB_LEDGER = "ledger";

export function RechargePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState(TAB_PACKAGES);
  const [embedUrl, setEmbedUrl] = useState("");
  const [embedHeight, setEmbedHeight] = useState(640);
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
        toast(t("billing.order_paid"), "success");
        void load(false);
        notifyBalanceChanged();
      } else if (
        data &&
        data.type === "NO996_EMBED_HEIGHT" &&
        typeof data.height === "number" &&
        data.height > 200
      ) {
        setEmbedHeight(Math.max(480, Math.ceil(data.height) + 16));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [t]);

  const tabs = (
    <ChromeAccessory>
      <div className="account-tabs account-tabs--chrome" role="tablist" aria-label={t("billing.tabs_aria")}>
        <button
          type="button"
          role="tab"
          className={`account-tab ${tab === TAB_PACKAGES ? "active" : ""}`}
          aria-selected={tab === TAB_PACKAGES}
          onClick={() => setTab(TAB_PACKAGES)}
        >
          {t("billing.tab_packages")}
        </button>
        <button
          type="button"
          role="tab"
          className={`account-tab ${tab === TAB_LEDGER ? "active" : ""}`}
          aria-selected={tab === TAB_LEDGER}
          onClick={() => setTab(TAB_LEDGER)}
        >
          {t("billing.tab_ledger")}
        </button>
      </div>
    </ChromeAccessory>
  );

  if (!loaded) {
    return (
      <main className="account-page recharge-page">
        {tabs}
        <Loading
          text={t("billing.recharge_loading")}
          error={error}
          onRetry={() => void load(true)}
        />
      </main>
    );
  }

  return (
    <main className="account-page recharge-page">
      {tabs}
      {error ? (
        <RequestErrorAlert message={error} requestId={errorRequestId} />
      ) : null}

      {tab === TAB_PACKAGES ? (
        embedUrl ? (
          <section className="recharge-embed" aria-label={t("billing.tab_packages")}>
            <iframe
              src={embedUrl}
              title={t("billing.recharge_title")}
              style={{
                width: "100%",
                height: `${embedHeight}px`,
                border: "none",
                display: "block",
              }}
            />
          </section>
        ) : (
          <p className="empty">{t("billing.embed_unavailable")}</p>
        )
      ) : (
        <LedgerTable
          framed={false}
          ledgers={ledgers}
          page={ledgerPage}
          pageSize={LEDGER_PAGE_SIZE}
          total={ledgerTotal}
          onPageChange={(page) => void loadLedgers(page)}
        />
      )}
    </main>
  );
}
