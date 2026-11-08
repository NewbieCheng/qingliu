import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, setCsrf, setUnauthorizedHandler } from "@/shared/api/client.js";
import { navigate } from "@/shared/router/index.js";
import { readStorage, removeStorage, writeStorage } from "@/shared/lib/storage.js";
import { clearApiCache } from "@/shared/api/cache.js";

import { AuthContext } from "./context.js";
const REMEMBER_KEY = "ql.login.username";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshSession = useCallback(async () => {
    const data = await api("/api/me", undefined, { skipAuthRedirect: true });
    setCsrf(data.csrf);
    window.__qlCsrf = data.csrf;
    setUser(data.user);
    return data.user;
  }, []);

  const login = useCallback(async (credentials) => {
    await api("/api/login", credentials);
    const me = await api("/api/me", undefined, { skipAuthRedirect: true });
    setCsrf(me.csrf);
    window.__qlCsrf = me.csrf;
    setUser(me.user);
    return me.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/logout", {});
    } finally {
      setCsrf("");
      window.__qlCsrf = "";
      clearApiCache();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const dispose = setUnauthorizedHandler(() => {
      clearApiCache();
      setUser(null);
      navigate("/login", { replace: true });
    });
    return dispose;
  }, []);

  useEffect(() => {
    refreshSession()
      .catch(() => {})
      .finally(() => setReady(true));
  }, [refreshSession]);

  const rememberedUsername = useMemo(() => readStorage(REMEMBER_KEY), []);

  function rememberUsername(username, remember) {
    if (remember) writeStorage(REMEMBER_KEY, String(username));
    else removeStorage(REMEMBER_KEY);
  }

  const value = useMemo(
    () => ({
      user,
      ready,
      rememberedUsername,
      login,
      logout,
      refreshSession,
      rememberUsername,
    }),
    [user, ready, rememberedUsername, login, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
