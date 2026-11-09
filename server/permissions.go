// permissions.go 是「清流权限」的唯一真相。
//
// # 为什么要有这一层
//
// 改造前清流的权限是 ql_users.role 一个三档字符串（admin/sales/reviewer），
// 而工作台是 RBAC 权限码。两边各判一次的直接后果是**降级**：
// wbUpsertLocalUser 把「不认识的服务角色」一律写成 sales，于是工作台上的
// enterprise_member_readonly（只读成员）在清流里能上传、能核对、能签发。
//
// 现在改为：登录时把工作台的权限码快照存进 ql_workbench_accounts.permissions，
// 每个判定问的是「快照里有没有这个码」；ql_users.role 只作为**兜底默认值**
// （本地过渡账号、或迁移前登录还没刷新快照的会话）。
//
// # 映射放在这里而不是散在 handler 里
//
// 「只读成员不能改资料」这类规则只应该写一遍。handler 只说「我要
// PermCaseWrite」，具体是哪个角色给的由本文件决定 —— 否则每加一个角色，
// 都要把所有 handler 再翻一遍。
package main

import "encoding/json"

// 权限码。取值与工作台的 permission_code 同名同义，方便快照直接拿来比对。
//
// 企业侧的码（permTenantAdmin 等）由 loginPermissions 依据服务角色推导，
// 只有当工作台真的返回了权限码时才使用工作台的那一份。
const (
	// permAdmin 是「我是这家企业的管理员」这一个**粗粒度**判断的码，
	// 与原先 q.admin() 的语义一一对应。保留它是因为既有 handler 全部按它判，
	// 一次改到细粒度会把这个 PR 变成一次大重构。
	permAdmin = "qingliu.admin"

	// 细粒度码：只在快照里存在时生效，用于修掉「只读成员能改」这个缺陷。
	permCaseRead        = "qingliu.case.read"
	permCaseWrite       = "qingliu.case.write"
	permReportSign      = "qingliu.report.sign"
	permMemberManage    = "qingliu.member.manage"
	permBillingRead     = "qingliu.billing.read"
	permBillingRecharge = "qingliu.billing.recharge"
)

// rolePermissions 是「工作台服务角色 → 清流权限」的映射。
//
// 这是本文件存在的理由：**只写一遍**。工作台的 enterprise_member_readonly
// 在这里被明确映射成「只读」，而不是被降级成 sales。
//
// 未知角色一律按**最小权限**（只读）处理，而不是按 sales 处理：
// 认不出一个角色的权限时，放行写操作是最坏的选择。
var rolePermissions = map[string][]string{
	"admin":    {permAdmin, permCaseRead, permCaseWrite, permReportSign, permMemberManage, permBillingRead, permBillingRecharge},
	"reviewer": {permCaseRead, permCaseWrite, permReportSign, permBillingRead},
	"sales":    {permCaseRead, permCaseWrite, permBillingRead, permBillingRecharge},
	// 工作台的企业成员档位（t_role.role_code）：
	"enterprise_member_full":     {permCaseRead, permCaseWrite, permReportSign, permBillingRead},
	"enterprise_member_basic":    {permCaseRead, permCaseWrite, permBillingRead},
	"enterprise_member_readonly": {permCaseRead, permBillingRead},
	"enterprise_admin":           {permAdmin, permCaseRead, permCaseWrite, permReportSign, permMemberManage, permBillingRead, permBillingRecharge},
	// 只读兜底：认不出的角色给到这里，而不是给 sales。
	"readonly": {permCaseRead, permBillingRead},
}

// parsePermissions 把 ql_workbench_accounts.permissions 的 JSON 解析成集合。
//
// nil 表示「没有快照」——调用方据此退回 ql_users.role 的三档判定，
// 与改造前的行为完全一致（本地过渡账号靠它继续工作）。
func parsePermissions(raw string) map[string]bool {
	if raw == "" || raw == "null" {
		return nil
	}
	var codes []string
	if json.Unmarshal([]byte(raw), &codes) != nil {
		return nil
	}
	set := make(map[string]bool, len(codes))
	for _, code := range codes {
		if code != "" {
			set[code] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

// loginPermissions 算出一次登录应该存下的权限集合。
//
// 优先用工作台**真的返回**的权限码（wbSession 里带了 permissions 就用它）；
// 没有时按服务角色映射；再没有时按 ql_users.role 的三档映射。
// 返回 nil 表示「没法判断」，调用方保持既有角色判定。
func loginPermissions(serviceRole string, remote []string) []string {
	if len(remote) > 0 {
		return remote
	}
	if codes, ok := rolePermissions[serviceRole]; ok {
		return codes
	}
	if serviceRole == "" {
		return nil
	}
	return rolePermissions["readonly"]
}

// can 是服务端的权限判定。
//
// 有快照时只看快照：**不**再叠加 role，否则「把只读成员降级」这件事
// 会被 ql_users.role 里残留的旧值抵消掉（快照说要只读、role 还写着 sales）。
func (q *request) can(code string) bool {
	if q.permissions != nil {
		return q.permissions[code]
	}
	return legacyAllowed(str(q.user, "role"), code)
}

// legacyAllowed 是**没有快照**时的兜底映射，语义必须与改造前逐字一致。
func legacyAllowed(role, code string) bool {
	switch code {
	case permCaseRead:
		return true // 任何登录用户都能读自己空间内的资料（scopeWhere 收口）
	case permCaseWrite:
		return role == "admin" || role == "sales" || role == "reviewer"
	case permReportSign:
		return role == "admin" || role == "reviewer"
	case permAdmin, permMemberManage, permBillingRead, permBillingRecharge:
		return role == "admin"
	default:
		return false
	}
}

// permissionList 供 /api/me 下发（前端据此显示/隐藏按钮）。
func (q *request) permissionList() []string {
	if q.permissions != nil {
		out := make([]string, 0, len(q.permissions))
		for code := range q.permissions {
			out = append(out, code)
		}
		return out
	}
	out := make([]string, 0, 6)
	for _, code := range []string{permCaseRead, permCaseWrite, permReportSign, permAdmin, permMemberManage, permBillingRead, permBillingRecharge} {
		if legacyAllowed(str(q.user, "role"), code) {
			out = append(out, code)
		}
	}
	return out
}

// isAdmin 替代原来的 `role != "admin"` 判断。
func (q *request) isAdmin() bool { return q.can(permAdmin) }

// canWriteCase 替代「能不能上传/核对」这类原先没有单独判定的动作。
func (q *request) canWriteCase() bool { return q.can(permCaseWrite) }

// canSignReport 替代原来手写的 `role == "admin" || role == "reviewer"`。
func (q *request) canSignReport() bool { return q.can(permReportSign) }
