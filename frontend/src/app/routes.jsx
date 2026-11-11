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
    title: "Sign in",
  },
  {
    path: "/",
    page: ClientsPage,
    title: "Customers",
  },
  {
    path: "/clients/:cid",
    page: CasePage,
    title: "Customer case",
    back: { to: "/", label: "Back to customers" },
  },
  {
    path: "/recharge",
    page: RechargePage,
    title: "Top up",
  },
  {
    path: "/profile",
    page: ProfilePage,
    title: "Profile",
  },
  {
    path: "/admin",
    page: AdminPage,
    title: "Team & access",
    roles: ["admin"],
  },
  {
    path: "*",
    page: NotFoundPage,
    title: "Page not found",
  },
];
