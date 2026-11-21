#Requires -Version 5.1
<#
.SYNOPSIS
   本地直连测试后的 QA 数据清理（先 dry-run，后按 ID 精确删除）。

.NOTES
   方案 B 下：登录/计费/AI 打线上工作台（积分不可回滚），
   但客户/资料/任务记录落在本地 qingliu 库（本机 .env 的 MYSQL_DSN）。
   本脚本只清理本地库中带 QA 前缀的客户及其级联数据；不碰线上。

   账号/口令从环境变量读取，不写死：
     QL_DB_DSN   MySQL DSN，如 qingliu:xxx@tcp(127.0.0.1:3306)/qingliu
     QL_QA_PREFIX  前缀，默认 【QA-
   用法：
     .\scripts\qa-cleanup.ps1                 # dry-run：只列出将要删除的客户
     .\scripts\qa-cleanup.ps1 -Apply          # 实际删除（需二次确认）
#>
param(
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dsn = [Environment]::GetEnvironmentVariable("QL_DB_DSN")
if ([string]::IsNullOrWhiteSpace($dsn)) { throw "缺少环境变量 QL_DB_DSN" }
$prefix = [Environment]::GetEnvironmentVariable("QL_QA_PREFIX")
if ([string]::IsNullOrWhiteSpace($prefix)) { $prefix = "【QA-" }

# DSN 形如 user:pass@tcp(host:port)/db?params
if ($dsn -notmatch '^([^:]+):([^@]+)@tcp\(([^)]+)\)/([^?]+)') {
  throw "无法解析 QL_DB_DSN: $dsn"
}
$dbUser, $dbPass, $dbHost, $dbName = $Matches[1], $Matches[2], $Matches[3], $Matches[4]
$mysql = (Get-Command mysql -ErrorAction SilentlyContinue).Source
if (-not $mysql) { throw "未找到 mysql 客户端" }

function Invoke-Sql([string]$sql) {
  $args = @("-u$dbUser", "-p$dbPass", "-h$dbHost", $dbName, "-N", "-B", "-e", $sql)
  & $mysql @args 2>$null
}

# 前缀里的【需转成 SQL LIKE；用 LEFT() 匹配，避免 LIKE 转义问题。
$safePrefix = $prefix -replace "'", "''"
$listSql = "SELECT id,name FROM ql_customers WHERE LEFT(name, CHAR_LENGTH('$safePrefix'))='$safePrefix' ORDER BY created;"
Write-Host "== 将清理的 QA 客户（前缀: $prefix）=="
$rows = @(Invoke-Sql $listSql)
if ($rows.Count -eq 0) {
  Write-Host "无匹配客户，无需清理。"
  exit 0
}
$rows | ForEach-Object { Write-Host "  $_" }

if (-not $Apply) {
  Write-Host "`n[dry-run] 未删除。确认无误后加 -Apply 重跑。"
  exit 0
}

$confirm = Read-Host "确认删除以上 $($rows.Count) 个客户及其全部级联数据？输入 yes 继续"
if ($confirm -ne "yes") { Write-Host "已取消"; exit 0 }

# 逐个按 ID 精确删除（ql_documents / ql_transactions / ql_jobs 等由外键 CASCADE 清理）。
$deleted = 0
foreach ($row in $rows) {
  $id = ($row -split "`t")[0]
  if ([string]::IsNullOrWhiteSpace($id)) { continue }
  $safeId = $id -replace "'", "''"
  Invoke-Sql "DELETE FROM ql_customers WHERE id='$safeId';" | Out-Null
  $deleted++
  Write-Host "  已删除 $id"
}

# 验收：复查是否还有残留 + 统计真实客户数
$remain = @(Invoke-Sql $listSql).Count
$total = (Invoke-Sql "SELECT COUNT(*) FROM ql_customers;") | Select-Object -First 1
Write-Host "`n== 清理报告 =="
Write-Host "已删除客户数: $deleted"
Write-Host "前缀残留数: $remain (应为 0)"
Write-Host "当前真实客户总数: $total"
if ($remain -ne 0) { throw "仍有 QA 残留，请人工检查" }
Write-Host "清理完成。（线上工作台的积分消耗与登录会话不在本脚本范围，不可回滚）"
