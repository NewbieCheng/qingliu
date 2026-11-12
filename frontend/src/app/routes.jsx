import React from "react";
import { LoginPage } from "@/pages/login/LoginPage.jsx";
import { ClientsPage } from "@/pages/clients/ClientsPage.jsx";
import { CasePage } from "@/pages/case/CasePage.jsx";
import { RechargePage } from "@/pages/recharge/RechargePage.jsx";
import { ProfilePage } from "@/pages/profile/ProfilePage.jsx";
import { AdminPage } from "@/pages/admin/AdminPage.jsx";
import { NotFoundPage } from "@/pages/not-found/NotFoundPage.jsx";

export const ROUTES = [
  {
    path: "/login",
    page: LoginPage,
    public: true,
    chrome: false,
    titleKey: "route.login",
  },
  {
    path: "/",
    page: ClientsPage,
    titleKey: "nav.clients",
  },
  {
    path: "/clients/:cid",
    page: CasePage,
    titleKey: "route.case",
    back: { to: "/", labelKey: "route.back_customers" },
  },
  {
    path: "/recharge",
    page: RechargePage,
    titleKey: "nav.recharge",
  },
  {
    path: "/profile",
    page: ProfilePage,
    titleKey: "nav.profile",
  },
  {
    path: "/admin",
    page: AdminPage,
    titleKey: "nav.admin",
    roles: ["admin"],
  },
  {
    path: "*",
    page: NotFoundPage,
    titleKey: "route.not_found",
  },
];
