#Requires -Version 5.1
<#
.SYNOPSIS
  清流底稿接口冒烟：登录 → 建客户 → 上传合成 CSV → 等识别 → 确认归属 → 真实发起 AI。

.NOTES
  - 账号只从环境变量读取，不写死在脚本里。
  - 默认不操作浏览器；后续 Agent 直接跑本脚本或复用其中的 HTTP 步骤。
  - AI 默认开启：真实打工作台 aidoc / 大模型；不是读 samples 里的假 JSON。
  - 需要本机 curl.exe（Windows 10+ 自带）、工作台可达、账号积分 > 0。

环境变量：
  QL_BASE           默认 http://127.0.0.1:8787
  QL_USER / QL_PASS 登录账号密码（须能走工作台登录）
  QL_CAPTCHA_ID / QL_CAPTCHA_CODE  工作台图形验证码（需要时）
  QL_SKIP_AI=1      仅当你只要测识别/归属时才设；默认会真实调 AI
  QL_FIXTURE        相对仓库根的夹具路径，默认 samples/bank_statement.csv
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Env([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($v)) {
    throw "缺少环境变量 $Name"
  }
  return $v
}

function Invoke-QlCurl {
  param(
    [Parameter(Mandatory = $true)][string[]]$CurlArgs,
    [switch]$Raw
  )
  $outFile = [System.IO.Path]::GetTempFileName()
  $hdr = "$outFile.hdr"
  try {
    $all = @("-sS", "-D", $hdr) + $CurlArgs + @("-o", $outFile)
    & curl.exe @all
    if ($LASTEXITCODE -ne 0) {
      throw "curl 失败 exit=$LASTEXITCODE"
    }
    $statusLine = (Get-Content -Path $hdr -TotalCount 1)
    if ($statusLine -notmatch 'HTTP/\S+\s+(\d+)') {
      throw "无法解析 HTTP 状态: $statusLine"
    }
    $code = [int]$Matches[1]
    $body = Get-Content -Raw -Path $outFile
    if ($Raw) {
      return [pscustomobject]@{ Code = $code; Body = $body; Headers = (Get-Content -Raw -Path $hdr) }
    }
    $json = $null
    if ($body -and $body.Trim().StartsWith("{")) {
      $json = $body | ConvertFrom-Json
    }
    return [pscustomobject]@{ Code = $code; Body = $body; Json = $json; Headers = (Get-Content -Raw -Path $hdr) }
  }
  finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $outFile, $hdr
  }
}

$Base = if ($env:QL_BASE) { $env:QL_BASE.TrimEnd("/") } else { "http://127.0.0.1:8787" }
# Origin 必须等于服务端 PUBLIC_ORIGIN（常见为前端 http://127.0.0.1:5173），不能误用 API 基址。
$Origin = if ($env:QL_ORIGIN) { $env:QL_ORIGIN.TrimEnd("/") } elseif ($env:PUBLIC_ORIGIN) { $env:PUBLIC_ORIGIN.TrimEnd("/") } else { "http://127.0.0.1:5173" }
$User = Require-Env "QL_USER"
$Pass = Require-Env "QL_PASS"
$FixtureRel = if ($env:QL_FIXTURE) { $env:QL_FIXTURE } else { "samples/bank_statement.csv" }
$SkipAi = $env:QL_SKIP_AI -eq "1"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Fixture = Join-Path $Root $FixtureRel
if (-not (Test-Path -LiteralPath $Fixture)) {
  throw "夹具不存在: $Fixture"
}

$CookieJar = Join-Path ([System.IO.Path]::GetTempPath()) ("ql-smoke-" + [guid]::NewGuid().ToString("n") + ".jar")

Write-Host "== 1) health =="
$h = Invoke-QlCurl -CurlArgs @("$Base/health")
if ($h.Code -ne 200) { throw "health $($h.Code) $($h.Body)" }
Write-Host "ok"

Write-Host "== 2) login =="
$loginObj = @{
  username = $User
  password = $Pass
}
if ($env:QL_CAPTCHA_ID -and $env:QL_CAPTCHA_CODE) {
  $loginObj.captcha_id = $env:QL_CAPTCHA_ID
  $loginObj.captcha_code = $env:QL_CAPTCHA_CODE
}
$loginJson = $loginObj | ConvertTo-Json -Compress
$loginFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($loginFile, $loginJson, [System.Text.UTF8Encoding]::new($false))
try {
  $login = Invoke-QlCurl -CurlArgs @(
    "-c", $CookieJar, "-b", $CookieJar,
    "-H", "Content-Type: application/json",
    "-H", "Origin: $Origin",
    "-d", "@$loginFile",
    "$Base/api/login"
  )
}
finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $loginFile
}
if ($login.Code -ne 200) {
  throw "login $($login.Code) $($login.Body)"
}
Write-Host "ok"

Write-Host "== 3) me / csrf =="
$me = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "-c", $CookieJar, "$Base/api/me")
if ($me.Code -ne 200 -or -not $me.Json.csrf) {
  throw "me 失败: $($me.Body)"
}
$csrf = [string]$me.Json.csrf
Write-Host "csrf ok"

Write-Host "== 4) create client =="
$name = "合成-冒烟-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$clientBody = @{ name = $name; authorized = $true } | ConvertTo-Json -Compress
$clientFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($clientFile, $clientBody, [System.Text.UTF8Encoding]::new($false))
try {
  $created = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar,
    "-H", "Content-Type: application/json",
    "-H", "X-CSRF-Token: $csrf",
    "-H", "Origin: $Origin",
    "-d", "@$clientFile",
    "$Base/api/clients"
  )
}
finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $clientFile
}
if ($created.Code -ne 200 -or -not $created.Json.id) {
  throw "create client $($created.Code) $($created.Body)"
}
$cid = [string]$created.Json.id
Write-Host "cid=$cid name=$name"

Write-Host "== 5) upload $FixtureRel =="
$upload = Invoke-QlCurl -CurlArgs @(
  "-b", $CookieJar, "-c", $CookieJar,
  "-H", "X-CSRF-Token: $csrf",
  "-H", "Origin: $Origin",
  "-F", "files=@$Fixture;type=text/csv",
  "-F", "source=bank_statement",
  "$Base/api/clients/$cid/upload"
)
if ($upload.Code -ne 200) {
  throw "upload $($upload.Code) $($upload.Body)"
}
Write-Host "queued: $($upload.Body)"

Write-Host "== 6) wait jobs =="
$deadline = (Get-Date).AddMinutes(5)
$final = $null
do {
  Start-Sleep -Seconds 2
  $jobs = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/jobs")
  if ($jobs.Code -ne 200) { throw "jobs $($jobs.Code) $($jobs.Body)" }
  $list = @()
  if ($jobs.Json.jobs) { $list = @($jobs.Json.jobs) }
  elseif ($jobs.Json.items) { $list = @($jobs.Json.items) }
  $uploadJobs = @($list | Where-Object { $_.kind -eq "upload" })
  if ($uploadJobs.Count -eq 0 -and $list.Count -gt 0) {
    $uploadJobs = $list
  }
  $pending = @($uploadJobs | Where-Object { $_.status -in @("queued", "running") })
  $final = $uploadJobs | Select-Object -First 1
  if ($pending.Count -eq 0 -and $uploadJobs.Count -gt 0) { break }
  Write-Host ("  ... " + (($uploadJobs | ForEach-Object { "$($_.status)/$($_.progress)%" }) -join ", "))
} while ((Get-Date) -lt $deadline)

if (-not $final) { throw "没有 upload 任务" }
Write-Host "job status=$($final.status) message=$($final.message)"

Write-Host "== 7) case snapshot =="
$case = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid")
if ($case.Code -ne 200) { throw "case $($case.Code) $($case.Body)" }
$docs = @($case.Json.docs)
$rows = @($case.Json.rows)
Write-Host "docs=$($docs.Count) rows_page=$($rows.Count) row_count=$($case.Json.row_count)"

if ($docs.Count -lt 1) {
  Write-Warning "无文档入库（识别可能失败）。Body 片段: $($case.Body.Substring(0, [Math]::Min(400, $case.Body.Length)))"
} else {
  $scopes = @{}
  foreach ($d in $docs) {
    $scopes[$d.id] = @{
      holder       = "合成持有人"
      relationship = "本人"
      include      = $true
    }
  }
  $own = @{
    scopes      = $scopes
    note        = "api-smoke 自动归属"
    spouse_name = ""
    child_name  = ""
  } | ConvertTo-Json -Depth 6 -Compress
  $ownFile = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($ownFile, $own, [System.Text.UTF8Encoding]::new($false))
  try {
    Write-Host "== 8) ownership =="
    $ownRes = Invoke-QlCurl -CurlArgs @(
      "-b", $CookieJar, "-c", $CookieJar,
      "-H", "Content-Type: application/json",
      "-H", "X-CSRF-Token: $csrf",
      "-H", "Origin: $Origin",
      "-d", "@$ownFile",
      "$Base/api/clients/$cid/ownership"
    )
    if ($ownRes.Code -ne 200) { throw "ownership $($ownRes.Code) $($ownRes.Body)" }
    Write-Host "ok"
  }
  finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $ownFile
  }

  if (-not $SkipAi) {
    $docId = [string]$docs[0].id
    Write-Host "== 9) ai-analysis document_id=$docId =="
    $aiBody = @{ document_id = $docId } | ConvertTo-Json -Compress
    $aiFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($aiFile, $aiBody, [System.Text.UTF8Encoding]::new($false))
    try {
      $ai = Invoke-QlCurl -CurlArgs @(
        "-b", $CookieJar, "-c", $CookieJar,
        "-H", "Content-Type: application/json",
        "-H", "X-CSRF-Token: $csrf",
        "-H", "Origin: $Origin",
        "-d", "@$aiFile",
        "$Base/api/clients/$cid/ai-analysis"
      )
      Write-Host "POST ai-analysis $($ai.Code) $($ai.Body)"
      if ($ai.Code -eq 200) {
        $deadline2 = (Get-Date).AddMinutes(12)
        do {
          Start-Sleep -Seconds 3
          $listAi = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/ai-analysis")
          $item = @($listAi.Json.items) | Select-Object -First 1
          if (-not $item) { break }
          Write-Host "  ai status=$($item.status) stage=$($item.stage) progress=$($item.progress)"
          if ($item.status -notin @("queued", "running", "uploading")) { break }
        } while ((Get-Date) -lt $deadline2)
      }
    }
    finally {
      Remove-Item -Force -ErrorAction SilentlyContinue $aiFile
    }
  } else {
    Write-Host "== 9) skip AI (QL_SKIP_AI=1) =="
  }
}

Write-Host ""
Write-Host "DONE cid=$cid"
Write-Host "对照测试表: docs/测试表-资料识别扩容与AI落地核对.md"
Remove-Item -Force -ErrorAction SilentlyContinue $CookieJar
