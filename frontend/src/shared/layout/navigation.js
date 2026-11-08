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

export function isNavItemActive(item, pathname) {
  return item.end
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
}
