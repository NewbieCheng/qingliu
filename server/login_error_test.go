package main

import (
	"net/http"
	"strings"
	"testing"
)

// 钉住「登录失败必须说清原因」：每一种失败都给出可行动的提示，
// 不能再出现笼统的"认证失败"。
func TestWBLoginErrorMapsEveryReason(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		code     string
		upstream string
		wantIn   string
	}{
		{"密码错", http.StatusUnauthorized, "AUTH_INVALID_CREDENTIALS", "账号或密码不正确", "密码"},
		{"旧码兼容", http.StatusUnauthorized, "AUTH_UNAUTHORIZED", "认证失败", "密码"},
		{"需验证码", http.StatusBadRequest, "AUTH_CAPTCHA_REQUIRED", "请完成图形验证码", "验证码"},
		{"验证码错", http.StatusBadRequest, "AUTH_CAPTCHA_INVALID", "图形验证码错误", "验证码"},
		{"账号锁定", http.StatusForbidden, "AUTH_ACCOUNT_LOCKED", "密码错误次数过多，账号已临时锁定，请 12 分钟后再试", "12 分钟"},
		{"账号冻结", http.StatusForbidden, "AUTH_ACCOUNT_FROZEN", "账号已冻结", "冻结"},
		{"账号禁用", http.StatusForbidden, "AUTH_ACCOUNT_DISABLED", "账号已禁用", "禁用"},
		{"服务凭据坏", http.StatusUnauthorized, "AUTH_SERVICE_UNAUTHORIZED", "服务认证失败", "管理员"},
		{"不属于本服务", http.StatusForbidden, "AUTH_SERVICE_SCOPE_MISMATCH", "账号不属于该服务", "清流"},
		{"无可用空间", http.StatusConflict, "AUTH_NO_SPACE_AVAILABLE", "没有可进入的空间", "客服"},
		{"别处登录", http.StatusUnauthorized, "SESSION_SUPERSEDED", "账号已在其他设备登录", "其他设备"},
		{"太频繁", http.StatusTooManyRequests, "AUTH_LOGIN_RATE_LIMITED", "登录请求过于频繁", "频繁"},
		{"验证码过期", http.StatusBadRequest, "AUTH_VERIFICATION_INVALID", "验证码无效或已过期", "验证码"},
		{"未注册", http.StatusBadRequest, "AUTH_ACCOUNT_NOT_FOUND", "该邮箱未注册", "注册"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := Object{"error": Object{"code": tc.code, "message": tc.upstream}}
			err := wbLoginError(tc.status, data)
			if err == nil {
				t.Fatal("应当返回错误")
			}
			msg := err.Error()
			if !strings.Contains(msg, tc.wantIn) {
				t.Fatalf("消息 = %q, 期望包含 %q", msg, tc.wantIn)
			}
			// 绝不能把笼统的"认证失败"直接透给用户
			if strings.TrimSpace(msg) == "认证失败" {
				t.Fatalf("仍在使用笼统文案: %q", msg)
			}
		})
	}
}

// 上游没给 code 时，至少要有一句可行动的话，不能是空字符串。
func TestWBLoginErrorFallbackNotEmpty(t *testing.T) {
	err := wbLoginError(http.StatusInternalServerError, Object{})
	if err == nil || strings.TrimSpace(err.Error()) == "" {
		t.Fatal("兜底错误不能为空")
	}
	if strings.Contains(err.Error(), "认证失败") {
		t.Fatalf("兜底不应回笼统文案: %q", err.Error())
	}
}
