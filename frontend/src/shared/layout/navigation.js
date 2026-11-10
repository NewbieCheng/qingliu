export const NAVIGATION = [
  {
    label: "工作区",
    items: [
      { to: "/", icon: "clients", label: "客户档案", end: true },
    ],
  },
  {
    label: "账户",
    items: [
      { to: "/recharge", icon: "wallet", label: "充值" },
      { to: "/profile", icon: "user", label: "个人信息" },
    ],
  },
  {
    label: "管理",
    adminOnly: true,
    items: [{ to: "/admin", icon: "admin", label: "团队与权限" }],
  },
];

/** 手机底部主 Tab（「我的」由 MobileTabBar 单独处理） */
export const MOBILE_PRIMARY_TABS = [
  { to: "/", icon: "clients", label: "客户", end: true },
  { to: "/recharge", icon: "wallet", label: "充值" },
];

export const MOBILE_ME_PATHS = ["/profile", "/admin"];

export function isNavItemActive(item, pathname) {
  return item.end
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function isMobileMeActive(pathname) {
  return MOBILE_ME_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
