#Requires -Version 5.1
<#
.SYNOPSIS
   旧数据补跑：列出 failed 且有正文的文档，逐个走 reparse 主干重解析。

.NOTES
   通过 HTTP 调 /api/clients/{cid}/documents/{did}/reparse，
   用已存原件重跑，不重新上传、不重复扣费，payload 保留 _backup_before_reparse。

   环境变量：
     QL_BASE            本地清流 http://127.0.0.1:8787
     QL_USER/QL_PASS    登录账号（走线上工作台）
     QL_CAPTCHA_ID/CODE 需要时
   # 需要先登录拿 cookie + csrf（复用 api-smoke-case 的登录逻辑简化版）

   用法：
     .\scripts\reparse-legacy.ps1 -Cid <客户ID>          # dry-run 列出候选
     .\scripts\reparse-legacy.ps1 -Cid <客户ID> -Apply   # 实际提交重解析
#>
param(
  [Parameter(Mandatory = $true)][string]$Cid,
  [string]$Source = "other",
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Base = if ($env:QL_BASE) { $env:QL_BASE.TrimEnd("/") } else { "http://127.0.0.1:8787" }
$Origin = if ($env:QL_ORIGIN) { $env:QL_ORIGIN.TrimEnd("/") } else { "http://127.0.0.1:5173" }
$User = $env:QL_USER
$Pass = $env:QL_PASS
if (-not $User -or -not $Pass) { throw "缺少 QL_USER / QL_PASS" }

function Invoke-Ql {
  param([string[]]$CurlArgs)
  $out = [System.IO.Path]::GetTempFileName()
  $hdr = "$out.hdr"
  try {
    & curl.exe @("-sS", "-D", $hdr) + $CurlArgs + @("-o", $out)
    $body = Get-Content -Raw -Path $out
    if ($body -and $body.Trim().StartsWith("{")) { return $body | ConvertFrom-Json }
    return $body
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $out, $hdr
  }
}

$jar = Join-Path ([System.IO.Path]::GetTempPath()) ("ql-reparse-" + [guid]::NewGuid().ToString("n") + ".jar")

# 登录
$loginObj = @{ username = $User; password = $Pass }
if ($env:QL_CAPTCHA_ID -and $env:QL_CAPTCHA_CODE) {
  $loginObj.captcha_id = $env:QL_CAPTCHA_ID
  $loginObj.captcha_code = $env:QL_CAPTCHA_CODE
}
$lf = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($lf, ($loginObj | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
try {
  $login = Invoke-Ql @("-c", $jar, "-b", $jar, "-H", "Content-Type: application/json", "-H", "Origin: $Origin", "-d", "@$lf", "$Base/api/login")
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $lf }
if (-not $login.ok) { throw "登录失败: $($login | ConvertTo-Json -Compress)" }

$me = Invoke-Ql @("-b", $jar, "-c", $jar, "$Base/api/me")
$csrf = [string]$me.csrf

# 列出客户资料
$case = Invoke-Ql @("-b", $jar, "-c", $jar, "$Base/api/clients/$Cid")
$docs = @($case.docs)
$candidates = @($docs | Where-Object {
  $_.meta.status -ne "success" -and -not [string]::IsNullOrWhiteSpace($_.meta.extract_text)
})
Write-Host "== 可补跑文档（failed + 有正文）=="
if ($candidates.Count -eq 0) { Write-Host "无候选"; exit 0 }
foreach ($d in $candidates) {
  Write-Host ("  {0}  {1}  status={2} rows={3}" -f $d.id, $d.name, $d.meta.status, $d.meta.rows)
}
if (-not $Apply) { Write-Host "`n[dry-run] 未提交。加 -Apply 实际重解析。"; exit 0 }

$confirm = Read-Host "确认对以上 $($candidates.Count) 份文档提交重解析？输入 yes"
if ($confirm -ne "yes") { Write-Host "已取消"; exit 0 }
foreach ($d in $candidates) {
  $bf = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($bf, (@{ source = $Source } | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
  try {
    $r = Invoke-Ql @("-b", $jar, "-c", $jar, "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin", "-d", "@$bf", "$Base/api/clients/$Cid/documents/$($d.id)/reparse")
    Write-Host "  已提交 $($d.id): $($r | ConvertTo-Json -Compress)"
  } finally { Remove-Item -Force -ErrorAction SilentlyContinue $bf }
}
Write-Host "`n补跑任务已入队，去后台任务面板查看结果。"
