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
    title: "登录",
  },
  {
    path: "/",
    page: ClientsPage,
    title: "客户档案",
  },
  {
    path: "/clients/:cid",
    page: CasePage,
    title: "客户底稿",
  },
  {
    path: "/recharge",
    page: RechargePage,
    title: "充值",
  },
  {
    path: "/profile",
    page: ProfilePage,
    title: "个人信息",
  },
  {
    path: "/admin",
    page: AdminPage,
    title: "团队与权限",
    roles: ["admin"],
  },
  {
    path: "*",
    page: NotFoundPage,
    title: "页面不存在",
  },
];
