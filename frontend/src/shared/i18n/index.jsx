import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LOCALES,
  normalizeLocale,
  readStoredLocale,
  translate,
} from "./core.js";

export { LOCALES, normalizeLocale, readStoredLocale, translate, tStandalone } from "./core.js";

const STORAGE_KEY = "ql_lang";
const LocaleContext = createContext(null);

function writeStoredLocale(locale) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore storage restrictions; the in-memory locale remains active.
  }
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(readStoredLocale);
  const setLocale = useCallback((next) => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    writeStoredLocale(normalized);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback((key, vars) => translate(locale, key, vars), [locale]);
  const value = useMemo(
    () => ({ locale, setLocale, t, locales: LOCALES }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useI18n must be used within LocaleProvider");
  return context;
}
