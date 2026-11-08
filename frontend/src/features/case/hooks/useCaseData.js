import { useCallback, useEffect, useRef, useState } from "react";
import { getCase, mutateCase } from "../api.js";

export function useCaseData(cid, { range, view, query, page }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const requestRef = useRef(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const value = await getCase(cid, {
        range,
        view,
        query,
        page,
        signal: controller.signal,
      });
      setData(value);
      setError("");
      setSelected([]);
      return value;
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message);
      return null;
    }
  }, [cid, range, view, query, page]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!data?.busy) return undefined;
    const timer = window.setTimeout(() => void load(), 2000);
    return () => window.clearTimeout(timer);
  }, [data?.busy, load]);

  const mutate = useCallback(
    async (action, body) => {
      await mutateCase(cid, range, action, body);
      return load();
    },
    [cid, range, load],
  );

  return { data, error, selected, setSelected, load, mutate };
}
