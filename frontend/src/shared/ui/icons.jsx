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

export function BuildingIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.5">
      <rect x="4" y="3.5" width="12" height="13" rx="1" />
      <path d="M7 6.5h2M11 6.5h2M7 10h2M11 10h2M7 13.5h2M11 13.5h2" />
    </Svg>
  );
}

export function CheckIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="2">
      <path d="m4 10.5 4 4 8-9" />
    </Svg>
  );
}

export function XIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.8">
      <path d="m5 5 10 10M15 5 5 15" />
    </Svg>
  );
}

export function SearchIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <circle cx="9" cy="9" r="5.2" />
      <path d="M13.2 13.2 17 17" />
    </Svg>
  );
}

/** 圆圈感叹号，用于口径/说明悬停提示。 */
export function AlertIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.4v5M10 13.6h.01" />
    </Svg>
  );
}

export function TrashIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.9" viewBox="0 0 20 20">
      <path d="M3.5 5.5h13" />
      <path d="M8 5.5V4h4v1.5" />
      <path d="M5.5 5.5l.7 11h7.6l.7-11" />
      <path d="M8.2 9v5.2M11.8 9v5.2" />
    </Svg>
  );
}

export function RefreshIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.7">
      <path d="M4.2 8.2A6 6 0 0 1 16 9.5" />
      <path d="M15.8 11.8A6 6 0 0 1 4 10.5" />
      <path d="M15.5 5.5V9h-3.5M4.5 14.5V11H8" />
    </Svg>
  );
}

export function UserPlusIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <circle cx="8.2" cy="6.8" r="2.6" />
      <path d="M3.5 16.2c.6-2.6 2.3-3.9 4.7-3.9s4.1 1.3 4.7 3.9" />
      <path d="M14.2 7.2v5M11.7 9.7h5" />
    </Svg>
  );
}

export function BanIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <circle cx="10" cy="10" r="6.5" />
      <path d="m6 14 8-8" />
    </Svg>
  );
}

export function PlayIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <circle cx="10" cy="10" r="6.5" />
      <path d="M8.4 7.2 13.2 10 8.4 12.8Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function DownloadIcon({ size = 16 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <path d="M10 3v9.5M6 9.5l4 4 4-4" />
      <path d="M4 16.5h12" />
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

export function ArrowLeftIcon({ size = 13 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <path d="M17 10H8M11.5 6.5 8 10l3.5 3.5" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 13 }) {
  return (
    <Svg size={size} strokeWidth="1.6">
      <path d="M12 5.5 7.5 10 12 14.5" />
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
