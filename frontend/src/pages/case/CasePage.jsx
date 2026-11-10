import React, { useMemo, useState } from "react";
import { useSearchParams } from "@/shared/router/index.js";
import { Loading } from "@/shared/ui/Loading.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { CASE_STEPS } from "@/features/case/constants.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import {
  CaseAdminGrant,
  CaseHeader,
  CaseSteps,
  OriginalEvidenceDialog,
  OwnershipStep,
  ReportStep,
  ReviewStep,
  TaskList,
  UploadStep,
  getTransaction,
  useCaseData,
} from "@/features/case/index.js";

const VALID_STEPS = new Set(CASE_STEPS.map(([key]) => key));

export function CasePage({ cid, user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStep = searchParams.get("step");
  const step = VALID_STEPS.has(requestedStep) ? requestedStep : "upload";
  const [period, setPeriod] = useState(null);
  const [view, setView] = useState("issues");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [original, setOriginal] = useState(null);

  const range = useMemo(
    () => (period ? new URLSearchParams(period).toString() : ""),
    [period],
  );

  const { data, error, selected, setSelected, load, mutate } = useCaseData(cid, {
    range,
    view,
    query,
    page,
  });

  if (!data) {
    return (
      <main>
        <Loading text="正在读取客户档案…" error={error} onRetry={load} />
      </main>
    );
  }

  const summary = data.summary;

  function changeStep(next) {
    const params = new URLSearchParams(searchParams);
    params.set("step", next);
    setSearchParams(params);
  }

  async function openOriginal(transactionId) {
    try {
      const detail = await getTransaction(cid, transactionId);
      const document = data.docs.find(
        (item) => String(item.id) === String(detail.row.document_id),
      );
      setOriginal({
        ...detail,
        pages: Number(document?.meta?.pages) || detail.row.page || 1,
        sha: document?.sha || "",
      });
    } catch (requestError) {
      toast(requestError.message, "error");
    }
  }

  return (
    <main className="case-page">
      <CaseHeader
        data={data}
        adminAction={
          isQingliuAdmin(user) &&
          (user.kind || user.space?.kind) === "team" ? (
            <CaseAdminGrant
              onGrant={(payload) => mutate("grant", payload)}
              onError={(message) => toast(message, "error")}
            />
          ) : null
        }
      />
      <CaseSteps step={step} onChange={changeStep} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <TaskList
        data={data}
        onRetry={(jobId) => mutate(`retry/${jobId}`, {})}
        onCancel={(jobId) => mutate(`jobs/${jobId}/cancel`, {})}
      />

      {step === "upload" && (
        <UploadStep
          data={data}
          onUpload={(form) => mutate("upload", form)}
          onNext={() => changeStep("ownership")}
        />
      )}
      {step === "ownership" && (
        <OwnershipStep
          data={data}
          onSave={(payload) => mutate("ownership", payload)}
          onNext={() => changeStep("review")}
        />
      )}
      {step === "review" && (
        <ReviewStep
          data={data}
          summary={summary}
          selected={selected}
          onSelectedChange={setSelected}
          view={view}
          onViewChange={setView}
          query={query}
          onQueryChange={setQuery}
          page={page}
          onPageChange={setPage}
          onRangeChange={(next) => {
            setPage(1);
            setPeriod(next);
          }}
          onReview={(payload) => mutate("review", payload)}
          onRulesSave={(rules) => mutate("rules", rules)}
          onCoverage={(payload) => mutate("coverage", payload)}
          onOpenOriginal={openOriginal}
          onStepChange={changeStep}
        />
      )}
      {step === "report" && (
        <ReportStep
          cid={cid}
          data={data}
          user={user}
          summary={summary}
          onGenerate={(payload) => mutate("report", payload)}
          onSubmit={() => mutate("submit", {})}
          onFormal={(payload) => mutate("report", payload)}
        />
      )}
      {original && (
        <OriginalEvidenceDialog
          cid={cid}
          original={original}
          onClose={() => setOriginal(null)}
        />
      )}
    </main>
  );
}
