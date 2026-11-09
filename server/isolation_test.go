package main

import (
	"strings"
	"testing"
)

// 团队隔离是合规级要求：团队之间、个人之间、个人与团队之间都必须互不可见。
// 这些断言锁住 scopeWhere 的语义 —— 它是授权判定与列表查询共用的唯一口径。

func TestScopeWhereTeamSeesWholeTeam(t *testing.T) {
	user := Object{"id": "u-team", "tenant_id": int64(1)}
	where, args := scopeWhere(user, "c")
	if !strings.Contains(where, "workspace_tenant_id=?") {
		t.Fatalf("team scope = %q, want tenant predicate", where)
	}
	if strings.Contains(where, "owner_user_id") {
		t.Fatalf("team scope %q must not be narrowed to the creator", where)
	}
	if len(args) != 1 || integer(args[0]) != 1 {
		t.Fatalf("team args = %v, want [1]", args)
	}
}

func TestScopeWherePersonalSeesOnlyOwnData(t *testing.T) {
	user := Object{"id": "u-a", "tenant_id": int64(0)}
	where, args := scopeWhere(user, "c")
	if !strings.Contains(where, "workspace_tenant_id=0") || !strings.Contains(where, "owner_user_id=?") {
		t.Fatalf("personal scope = %q, want tenant 0 + owner predicate", where)
	}
	if len(args) != 1 || args[0] != "u-a" {
		t.Fatalf("personal args = %v, want [u-a]", args)
	}
}

// 两个人必须有**不同**的条件值，否则一个人的资料会被另一个人看到。
func TestScopeWhereTwoPersonalUsersDiffer(t *testing.T) {
	whereA, argsA := scopeWhere(Object{"id": "u-a", "tenant_id": int64(0)}, "c")
	whereB, argsB := scopeWhere(Object{"id": "u-b", "tenant_id": int64(0)}, "c")
	if whereA != whereB {
		t.Fatalf("shape should be identical, got %q vs %q", whereA, whereB)
	}
	if argsA[0] == argsB[0] {
		t.Fatal("two personal users produced the same owner argument: isolation is broken")
	}
}

// 管理员不再拥有跨团队视野 —— 这条正是本次要修的漏洞。
func TestScopeWhereAdminDoesNotBypassTenant(t *testing.T) {
	admin := Object{"id": "u-admin", "role": "admin", "tenant_id": int64(2)}
	where, _ := scopeWhere(admin, "c")
	if strings.Contains(where, "role") || strings.Contains(where, "OR 1=1") {
		t.Fatalf("admin scope = %q, must not carry a role bypass", where)
	}
	personal, _ := scopeWhere(Object{"id": "u-admin", "role": "admin", "tenant_id": int64(0)}, "c")
	if !strings.Contains(personal, "owner_user_id=?") {
		t.Fatalf("personal admin scope = %q, must fall back to owner", personal)
	}
}

func TestTenantScopeNames(t *testing.T) {
	if tenantScope(Object{"tenant_id": int64(1)}) != "team" {
		t.Fatal("tenant>0 must read as team")
	}
	if tenantScope(Object{"tenant_id": int64(0)}) != "personal" {
		t.Fatal("tenant 0 must read as personal")
	}
}
