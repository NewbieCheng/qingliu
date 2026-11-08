import React from "react";

function Svg({ children, size = 16, viewBox = "0 0 20 20", ...rest }) {
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function LockIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.5">
      <rect x="4" y="8.5" width="12" height="8" rx="1.8" />
      <path d="M6.5 8.5V6.8a3.5 3.5 0 0 1 7 0v1.7" />
    </Svg>
  );
}

export function UserIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.5">
      <circle cx="10" cy="6.8" r="2.8" />
      <path d="M4.5 17c.7-3 2.6-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
    </Svg>
  );
}

export function EyeIcon({ size = 17, off = false }) {
  return (
    <Svg size={size} strokeWidth="1.4">
      <path d="M2.5 10s2.7-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.7 4.5-7.5 4.5S2.5 10 2.5 10Z" />
      <circle cx="10" cy="10" r="2.1" />
      {off && <path d="m3 3 14 14" />}
    </Svg>
  );
}

export function ArrowRightIcon({ size = 14 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 13 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <path d="M9.5 3.5 5 8l4.5 4.5" />
    </Svg>
  );
}

export function ShieldIcon({ size = 12 }) {
  return (
    <Svg size={size} strokeWidth="1.4">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
    </Svg>
  );
}

export function UploadIcon({ size = 26 }) {
  return (
    <Svg size={size} viewBox="0 0 24 24" strokeWidth="1.5">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </Svg>
  );
}

export function RailToggleIcon({ collapsed, size = 17 }) {
  return (
    <Svg size={size}>
      <path d="M4 4v12" />
      <path d={collapsed ? "m8 7 3 3-3 3" : "m11 7-3 3 3 3"} />
    </Svg>
  );
}

export function TopbarToggleIcon({ collapsed, size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.7">
      {collapsed ? <path d="m5 8 5 5 5-5" /> : <path d="m5 12 5-5 5 5" />}
    </Svg>
  );
}

const NAV_PATHS = {
  clients: (
    <>
      <path d="M3.5 6.5h6l1.6 2H20.5v9.5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 18V8a1.5 1.5 0 0 1 .5-1.5Z" />
      <path d="M3.5 9h17" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 9h18M16 13.5h2.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3 20 6v6.2c0 4.6-2.7 7.5-8 9.1-5.3-1.6-8-4.5-8-9.1V6l8-3Z" />
      <path d="M9 12.2l2 2 4-4.2" />
    </>
  ),
};

export function NavIcon({ kind, size = 17 }) {
  return (
    <Svg className="rail-link-icon" size={size} viewBox="0 0 24 24" strokeWidth="1.5">
      {NAV_PATHS[kind]}
    </Svg>
  );
}
