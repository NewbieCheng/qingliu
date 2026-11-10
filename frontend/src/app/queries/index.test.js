import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listClients: vi.fn(),
  listAuditEvents: vi.fn(),
  getAdminOverview: vi.fn(),
  getBalance: vi.fn(),
  getCase: vi.fn(),
  getProfile: vi.fn(),
}));
const { listClients, listAuditEvents, getAdminOverview, getBalance, getCase, getProfile } = mocks;

vi.mock("@/features/clients/api.js", () => ({ listClients: mocks.listClients }));
vi.mock("@/features/admin/api.js", () => ({
  getAdminOverview: mocks.getAdminOverview,
  listAuditEvents: mocks.listAuditEvents,
}));
vi.mock("@/features/billing/api.js", () => ({ getBalance: mocks.getBalance }));
vi.mock("@/features/case/api.js", () => ({ getCase: mocks.getCase }));
vi.mock("@/features/profile/api.js", () => ({ getProfile: mocks.getProfile }));

import { clearApiCache } from "@/shared/api/cache.js";
import {
  invalidateAdmin,
  invalidateBalance,
  invalidateCase,
  invalidateClients,
  queryAdminOverview,
  queryAuditEvents,
  queryBalance,
  queryCase,
  queryClients,
  queryProfile,
} from "./index.js";

describe("query cache policy", () => {
  beforeEach(() => {
    clearApiCache();
    vi.clearAllMocks();
  });

  it("deduplicates identical client queries within TTL", async () => {
    listClients.mockResolvedValue({ clients: [] });
    await queryClients({ query: "a", page: 1 });
    await queryClients({ query: "a", page: 1 });
    expect(listClients).toHaveBeenCalledTimes(1);
  });

  it("keeps different pages separate", async () => {
    listClients.mockResolvedValue({ clients: [] });
    await queryClients({ query: "a", page: 1 });
    await queryClients({ query: "a", page: 2 });
    expect(listClients).toHaveBeenCalledTimes(2);
  });

  it("invalidates clients only", async () => {
    listClients.mockResolvedValue({ clients: [] });
    getProfile.mockResolvedValue({ user: {} });
    await queryClients({ query: "", page: 1 });
    await queryProfile();
    invalidateClients();
    await queryClients({ query: "", page: 1 });
    await queryProfile();
    expect(listClients).toHaveBeenCalledTimes(2);
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it("invalidates admin overview and every audit filter", async () => {
    getAdminOverview.mockResolvedValue({ users: [] });
    listAuditEvents.mockResolvedValue({ events: [], count: 0 });
    await queryAdminOverview();
    await queryAuditEvents({ page: 1, page_size: 20, q: "", action: "login" });
    invalidateAdmin();
    await queryAdminOverview();
    await queryAuditEvents({ page: 1, page_size: 20, q: "", action: "login" });
    expect(getAdminOverview).toHaveBeenCalledTimes(2);
    expect(listAuditEvents).toHaveBeenCalledTimes(2);
  });

  it("deduplicates balance and invalidates it independently", async () => {
    getBalance.mockResolvedValue({ points_balance: 1 });
    await queryBalance();
    await queryBalance();
    invalidateBalance();
    await queryBalance();
    expect(getBalance).toHaveBeenCalledTimes(2);
  });

  it("force bypasses a cached entry", async () => {
    listAuditEvents.mockResolvedValue({ events: [] });
    await queryAuditEvents({ page: 1, page_size: 20 });
    await queryAuditEvents({ page: 1, page_size: 20 }, { force: true });
    expect(listAuditEvents).toHaveBeenCalledTimes(2);
  });

  it("deduplicates case queries and invalidates by customer", async () => {
    getCase.mockResolvedValue({ rows: [] });
    await queryCase("c1", { range: "", view: "issues", query: "", page: 1 });
    await queryCase("c1", { range: "", view: "issues", query: "", page: 1 });
    expect(getCase).toHaveBeenCalledTimes(1);
    invalidateCase("c1");
    await queryCase("c1", { range: "", view: "issues", query: "", page: 1 });
    expect(getCase).toHaveBeenCalledTimes(2);
  });
});
