import React, { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/features/auth/index.js";
import { Loading } from "@/shared/ui/Loading.jsx";
import { ToastHost } from "@/shared/ui/toast.jsx";
import { WorkspaceShell } from "@/shared/layout/WorkspaceShell.jsx";
import {
  matchPath,
  navigate,
  useLinkInterceptor,
  useLocation,
} from "@/shared/router/index.js";
import { ROUTES } from "./routes.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { ChangePasswordDialog } from "./ChangePasswordDialog.jsx";

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

  const { route, params } = resolveRoute(location.pathname);

  useEffect(() => {
    document.title = route.title
      ? `${route.title} · 青流`
      : "青流 · 客户资料与流水初筛";
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
        <Loading text="正在打开工作台…" />
      </main>
    );
  }

  if (route.public) return <route.page />;

  if (route.roles && !route.roles.includes(user.role)) {
    return (
      <WorkspaceShell
        user={user}
        pathname={location.pathname}
        onPassword={() => setPasswordOpen(true)}
        onLogout={async () => {
          await logout();
          navigate("/login");
        }}
      >
        <main>
          <div className="card">
            <p className="eyebrow">权限不足</p>
            <h1>当前账号没有访问此页面的权限。</h1>
            <p className="muted">请联系管理员分配对应角色或客户访问权限。</p>
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
        onPassword={() => setPasswordOpen(true)}
        onLogout={async () => {
          await logout();
          navigate("/login");
        }}
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
    <ErrorBoundary>
      <AuthProvider>
        <Workspace />
        <ToastHost />
      </AuthProvider>
    </ErrorBoundary>
  );
}
