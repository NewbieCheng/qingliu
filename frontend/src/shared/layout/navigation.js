export const NAVIGATION = [
  {
    label: "Workspace",
    items: [
      { to: "/", icon: "clients", label: "Customers", end: true },
    ],
  },
  {
    label: "Account",
    items: [
      { to: "/recharge", icon: "wallet", label: "Top up" },
      { to: "/profile", icon: "user", label: "Profile" },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [{ to: "/admin", icon: "admin", label: "Team & access" }],
  },
];

/** 手机底部主 Tab（「我的」由 MobileTabBar 单独处理） */
export const MOBILE_PRIMARY_TABS = [
  { to: "/", icon: "clients", label: "Customers", end: true },
  { to: "/recharge", icon: "wallet", label: "Top up" },
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
