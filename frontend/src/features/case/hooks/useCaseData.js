import { useCallback, useEffect, useRef, useState } from "react";
import { invalidateCase, queryCase } from "@/app/queries/index.js";
import { listCaseJobs, mutateCase } from "../api.js";
import { jobPolicy } from "../lib/job-policy.js";
import { useJobPoll } from "./useJobPoll.js";

function jobsSomeLive(jobs) {
  return (jobs || []).some(
    (job) => job.status === "queued" || job.status === "running",
  );
}

export function useCaseData(cid, { range, view, query, page }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const [jobOverlay, setJobOverlay] = useState(null);
  const requestRef = useRef(null);
  const busyRef = useRef(false);

  const load = useCallback(
    async ({ force = false } = {}) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        // busy 进行中禁止靠 force 狂刷整包 case；初次/写后仍可 force。
        const value = await queryCase(cid, {
          range,
          view,
          query,
          page,
          signal: controller.signal,
          force,
        });
        setData(value);
        busyRef.current = Boolean(value?.busy || value?.jobs_live);
        setJobOverlay(null);
        setError("");
        setSelected([]);
        return value;
      } catch (requestError) {
        if (requestError.name !== "AbortError") setError(requestError.message);
        return null;
      }
    },
    [cid, range, view, query, page],
  );

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const polling = Boolean(data?.busy || data?.jobs_live);

  const liveKinds = (jobOverlay || data?.jobs || [])
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => job.kind);
  const pollMs = liveKinds.length
    ? Math.max(...liveKinds.map((kind) => jobPolicy(kind).pollMs))
    : jobPolicy("upload").pollMs;

  useJobPoll({
    enabled: polling,
    intervalMs: pollMs,
    tick: async () => {
      const payload = await listCaseJobs(cid);
      const jobs = payload?.jobs || [];
      setJobOverlay(jobs);
      if (!jobsSomeLive(jobs)) {
        invalidateCase(cid);
        await load({ force: true });
        return { terminal: true, jobs };
      }
      return { terminal: false, jobs };
    },
    isTerminal: (state) => Boolean(state?.terminal),
  });

  const mutate = useCallback(
    async (action, body) => {
      await mutateCase(cid, range, action, body);
      invalidateCase(cid);
      return load({ force: true });
    },
    [cid, range, load],
  );

  const viewData =
    data && jobOverlay
      ? {
          ...data,
          jobs: jobOverlay,
          busy: jobsSomeLive(
            jobOverlay.filter(
              (job) => job.kind === "upload" || job.kind === "report",
            ),
          ),
          jobs_live: jobsSomeLive(jobOverlay),
        }
      : data;

  return { data: viewData, error, selected, setSelected, load, mutate };
}
