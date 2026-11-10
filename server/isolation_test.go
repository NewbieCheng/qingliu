package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 团队隔离是合规级要求：团队之间、个人之间、个人与团队之间都必须互不可见。
// 这些断言锁住 scopeWhere 的语义 —— 它是授权判定与列表查询共用的唯一口径。
//
// 判据是**当前空间**（kind + id），不是账号：同一个人切到团队空间要能看本企业
// 全部资料，切回个人空间只看得见自己创建的那几份。因此下面每条用例都显式
// 构造一个空间，而不是给用户塞 tenant_id（ql_users 上已经没有那一列）。

func TestScopeWhereTeamSeesWholeTeam(t *testing.T) {
	where, args := scopeWhere(spaceRef{Kind: spaceTeam, ID: 12}, "u-team", "c")
	if !strings.Contains(where, "workspace_tenant_id=?") {
		t.Fatalf("team scope = %q, want tenant predicate", where)
	}
	if strings.Contains(where, "owner_user_id") {
		t.Fatalf("team scope %q must not be narrowed to the creator", where)
	}
	if len(args) != 1 || integer(args[0]) != 12 {
		t.Fatalf("team args = %v, want [12]", args)
	}
}

func TestScopeWherePersonalSeesOnlyOwnData(t *testing.T) {
	where, args := scopeWhere(spaceRef{Kind: spacePersonal}, "u-a", "c")
	if !strings.Contains(where, "workspace_tenant_id=0") || !strings.Contains(where, "owner_user_id=?") {
		t.Fatalf("personal scope = %q, want tenant 0 + owner predicate", where)
	}
	if len(args) != 1 || args[0] != "u-a" {
		t.Fatalf("personal args = %v, want [u-a]", args)
	}
}

// 两个人必须有**不同**的条件值，否则一个人的资料会被另一个人看到。
func TestScopeWhereTwoPersonalUsersDiffer(t *testing.T) {
	whereA, argsA := scopeWhere(spaceRef{Kind: spacePersonal}, "u-a", "c")
	whereB, argsB := scopeWhere(spaceRef{Kind: spacePersonal}, "u-b", "c")
	if whereA != whereB {
		t.Fatalf("shape should be identical, got %q vs %q", whereA, whereB)
	}
	if argsA[0] == argsB[0] {
		t.Fatal("two personal users produced the same owner argument: isolation is broken")
	}
}

// 两个团队也必须拿到不同的条件值：切错一个 id 就是跨企业泄密。
func TestScopeWhereTwoTeamsDiffer(t *testing.T) {
	_, argsA := scopeWhere(spaceRef{Kind: spaceTeam, ID: 12}, "u-a", "c")
	_, argsB := scopeWhere(spaceRef{Kind: spaceTeam, ID: 13}, "u-b", "c")
	if integer(argsA[0]) == integer(argsB[0]) {
		t.Fatal("two team spaces produced the same tenant argument: isolation is broken")
	}
}

// 管理员不再拥有跨团队视野 —— 这条正是团队隔离要修的漏洞。
func TestScopeWhereAdminDoesNotBypassSpace(t *testing.T) {
	where, _ := scopeWhere(spaceRef{Kind: spaceTeam, ID: 2}, "u-admin", "c")
	if strings.Contains(where, "role") || strings.Contains(where, "OR 1=1") {
		t.Fatalf("admin scope = %q, must not carry a role bypass", where)
	}
	personal, _ := scopeWhere(spaceRef{Kind: spacePersonal}, "u-admin", "c")
	if !strings.Contains(personal, "owner_user_id=?") {
		t.Fatalf("personal admin scope = %q, must fall back to owner", personal)
	}
}

// 平台空间在清流里没有视图：宁可只看到自己创建的，也绝不放宽到某个企业。
func TestScopeWherePlatformFallsBackToOwnData(t *testing.T) {
	where, args := scopeWhere(spaceRef{Kind: spacePlatform, ID: 7}, "u-op", "c")
	if strings.Contains(where, "workspace_tenant_id=?") {
		t.Fatalf("platform scope = %q, must not widen to a team tenant", where)
	}
	if len(args) != 1 || args[0] != "u-op" {
		t.Fatalf("platform args = %v, want [u-op]", args)
	}
}

// 空间坐标的解析：'enterprise' 是工作台早期的说法，必须折成 team；
// 认不出的 kind 一律当个人空间（不能落到团队分支上）。
func TestSpaceKindNormalization(t *testing.T) {
	cases := map[string]string{
		"team":        spaceTeam,
		"TEAM":        spaceTeam,
		"enterprise":  spaceTeam,
		"platform":    spacePlatform,
		"personal":    spacePersonal,
		"":            spacePersonal,
		"weird-stuff": spacePersonal,
	}
	for raw, want := range cases {
		if got := normalizeSpaceKind(raw); got != want {
			t.Fatalf("normalizeSpaceKind(%q) = %q, want %q", raw, got, want)
		}
	}
	// 个人空间不记 id：它的 id 恒等于账号本身，资料隔离按 owner_user_id 判。
	if space := spaceOf(Object{"space_kind": "personal", "space_id": int64(99)}); space.ID != 0 {
		t.Fatalf("personal space kept id %d, want 0", space.ID)
	}
	if team := spaceOf(Object{"space_kind": "team", "space_id": int64(12)}); team.Kind != spaceTeam || team.ID != 12 {
		t.Fatalf("team space = %+v, want {team 12}", team)
	}
}

// 会话查询必须把空间坐标一起取出来。
// 漏选时 space_kind 落成空串 → 归一化成个人空间 → 团队账号看不到本企业资料，
// 或者（更糟）反过来把个人会话当成团队。这条锁住 SQL 里的两列。
func TestSessionQuerySelectsSpaceColumns(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "FROM ql_sessions s JOIN ql_users u")
	if start < 0 {
		t.Fatal("session query not found; the loader was rewritten")
	}
	line := text[strings.LastIndex(text[:start], "\n"):start]
	for _, column := range []string{"s.space_kind", "s.space_id"} {
		if !strings.Contains(line, column) {
			t.Fatalf("session query is missing %s; every session would degrade to the personal space", column)
		}
	}
}

// 后台任务没有会话：它必须带自己的空间坐标，否则 worker 无从判断
// 「这个任务当初是在哪个空间提交的」。
func TestWorkerReadsSpaceFromJob(t *testing.T) {
	source, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker.go: %v", err)
	}
	text := string(source)
	if !strings.Contains(text, "spaceOf(job)") {
		t.Fatal("worker does not derive the space from the job row; background jobs will reject team accounts")
	}
	index := strings.Index(text, "FROM ql_users WHERE id=? AND active=1")
	if index < 0 {
		t.Fatal("worker user query not found")
	}
	line := text[strings.LastIndex(text[:index], "\n"):index]
	if strings.Contains(line, "tenant") {
		t.Fatalf("worker user query still reads a tenant column: %s", line)
	}
}

// 清流不再有自有的空间实现：ql_users 上没有空间列，Go 源码里也不许再读它。
// 这条防的是「顺手又加一个 tenant 列」式的回潮 —— 那会让空间重新出现两个真相。
func TestNoSelfOwnedSpaceColumns(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(".", name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		for _, forbidden := range []string{"ql_users.tenant_id", "ql_sessions.tenant_id", "u.tenant_id", "s.tenant_id", "tenant_role"} {
			if strings.Contains(string(raw), forbidden) {
				t.Fatalf("%s still references %q; space lives on the session/job, not on the account", name, forbidden)
			}
		}
	}
	// 迁移 005 必须真的把三列删掉，而不只是加了新列。
	migration, err := os.ReadFile(filepath.Join("migrations", "005-drop-local-space-columns.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	for _, drop := range []string{"DROP COLUMN tenant_id", "DROP COLUMN tenant_role"} {
		if !strings.Contains(string(migration), drop) {
			t.Fatalf("migration 005 does not contain %q", drop)
		}
	}
}
