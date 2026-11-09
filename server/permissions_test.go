package main

import "testing"

// TestReadonlyMemberCannotWrite 是本轮修复的主断言。
//
// 历史缺陷：wbUpsertLocalUser 把不认识的 service_role 一律降级成 sales，
// 于是工作台上的 enterprise_member_readonly 在清流里拿到了写权限。
func TestReadonlyMemberCannotWrite(t *testing.T) {
	codes := loginPermissions("enterprise_member_readonly", nil)
	q := &request{user: Object{"role": "readonly"}, permissions: parsePermissions(js(codes))}
	if q.canWriteCase() {
		t.Fatal("enterprise_member_readonly must not be able to modify customer data")
	}
	if q.canSignReport() {
		t.Fatal("enterprise_member_readonly must not be able to sign a formal report")
	}
	if q.isAdmin() {
		t.Fatal("enterprise_member_readonly must not be an admin")
	}
	if !q.can(permCaseRead) {
		t.Fatal("enterprise_member_readonly should still be able to read its own space")
	}
}

// TestUnknownRoleFallsBackToReadOnly 钉住「认不出就只读」而不是「认不出就当 sales」。
func TestUnknownRoleFallsBackToReadOnly(t *testing.T) {
	codes := loginPermissions("some_new_workbench_role", nil)
	q := &request{user: Object{"role": "readonly"}, permissions: parsePermissions(js(codes))}
	if q.canWriteCase() {
		t.Fatal("an unknown service role must not be granted write access")
	}
}

// TestRemotePermissionsWinOverRoleMapping 钉住优先级：工作台真的给了权限码
// 就按它判，不再叠一层本地猜测。
func TestRemotePermissionsWinOverRoleMapping(t *testing.T) {
	q := &request{user: Object{"role": "admin"}, permissions: parsePermissions(js([]string{permCaseRead}))}
	if q.isAdmin() {
		t.Fatal("the snapshot says read-only; ql_users.role must not grant admin on top of it")
	}
}

// TestNoSnapshotKeepsLegacyBehaviour 钉住兼容路径：没有快照（本地过渡账号、
// 迁移前登录的会话）时，语义必须与改造前逐字一致。
func TestNoSnapshotKeepsLegacyBehaviour(t *testing.T) {
	cases := map[string]struct {
		admin bool
		write bool
		sign  bool
	}{
		"admin":    {admin: true, write: true, sign: true},
		"sales":    {admin: false, write: true, sign: false},
		"reviewer": {admin: false, write: true, sign: true},
	}
	for role, want := range cases {
		q := &request{user: Object{"role": role}}
		if q.isAdmin() != want.admin || q.canWriteCase() != want.write || q.canSignReport() != want.sign {
			t.Fatalf("role %q: admin=%v write=%v sign=%v, want %v/%v/%v",
				role, q.isAdmin(), q.canWriteCase(), q.canSignReport(), want.admin, want.write, want.sign)
		}
	}
}

// TestParsePermissionsTreatsGarbageAsNoSnapshot 钉住宽松解析：
// 形状不对时退化成「没有快照」，而不是让整次登录失败。
func TestParsePermissionsTreatsGarbageAsNoSnapshot(t *testing.T) {
	for _, raw := range []string{"", "null", "not json", "{}", "[]"} {
		if parsePermissions(raw) != nil {
			t.Fatalf("parsePermissions(%q) should be nil (no snapshot)", raw)
		}
	}
}
