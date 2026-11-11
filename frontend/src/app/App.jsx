import React, { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/features/auth/index.js";
import { SpaceSwitcher } from "@/features/profile/index.js";
import { Loading } from "@/shared/ui/Loading.jsx";
import { ToastHost } from "@/shared/ui/toast.jsx";
import { WorkspaceShell } from "@/shared/layout/WorkspaceShell.jsx";
import {
  matchPath,
  navigate,
  useLinkInterceptor,
  useLocation,
} from "@/shared/router/index.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import { ROUTES } from "./routes.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { ChangePasswordDialog } from "./ChangePasswordDialog.jsx";
import { LocaleProvider } from "@/shared/i18n/index.jsx";

function resolveRoute(pathname) {
  let fallback = null;
  for (const route of ROUTES) {
    if (route.path === "*") {
      fallback = { route, params: {} };
      continue;
    }
    const match = matchPath(route.path, pathname);
    if (match) return { route, params: match.params };
  }
  return fallback || { route: ROUTES[ROUTES.length - 1], params: {} };
}

function Workspace() {
  const { user, ready, logout } = useAuth();
  const location = useLocation();
  useLinkInterceptor();
  const [passwordOpen, setPasswordOpen] = useState(false);
  // 空间切换在 features/profile；由 app 注入 Shell，shared/layout 不反向依赖业务域。
  const spaceSwitcher = (collapsed) => (
    <SpaceSwitcher user={user} collapsed={collapsed} />
  );

  const { route, params } = resolveRoute(location.pathname);

  useEffect(() => {
    document.title = route.title
      ? `${route.title} · 青流`
      : "Qingliu · Customer files & statement screening";
  }, [route.title]);

  const mustGoHome = ready && route.public && Boolean(user);
  const mustLogin = ready && !route.public && !user;

  useEffect(() => {
    if (mustGoHome) navigate("/", { replace: true });
    if (mustLogin) navigate("/login", { replace: true });
  }, [mustGoHome, mustLogin]);

  if (!ready || mustGoHome || mustLogin) {
    return (
      <main>
        <Loading text="Opening workspace…" />
      </main>
    );
  }

  if (route.public) return <route.page />;

  if (
    route.roles?.includes("admin")
      ? !isQingliuAdmin(user)
      : route.roles && !route.roles.includes(user.role)
  ) {
    return (
      <WorkspaceShell
        user={user}
        pathname={location.pathname}
        title={route.title}
        back={route.back}
        onPassword={() => setPasswordOpen(true)}
        onLogout={async () => {
          await logout();
          navigate("/login");
        }}
        spaceSwitcher={spaceSwitcher}
      >
        <main>
          <div className="card">
            <h1>You do not have access to this page.</h1>
            <p className="muted">Ask an admin to grant the required role or customer access.</p>
          </div>
        </main>
      </WorkspaceShell>
    );
  }

  const Page = route.page;

  return (
    <>
      <WorkspaceShell
        user={user}
        pathname={location.pathname}
        title={route.title}
        back={route.back}
        onPassword={() => setPasswordOpen(true)}
        onLogout={async () => {
          await logout();
          navigate("/login");
        }}
        spaceSwitcher={spaceSwitcher}
      >
        <Page {...params} user={user} />
      </WorkspaceShell>
      {passwordOpen && (
        <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </>
  );
}

export function App() {
  return (
    <LocaleProvider>
      <ErrorBoundary>
        <AuthProvider>
          <Workspace />
          <ToastHost />
        </AuthProvider>
      </ErrorBoundary>
    </LocaleProvider>
  );
}
