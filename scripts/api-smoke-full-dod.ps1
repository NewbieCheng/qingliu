#Requires -Version 5.1
<#
.SYNOPSIS
  总册 DoD 真机联调（本机账号 + 本机清流/工作台）：
  upload-parsed(CSV/XLSX/docx) → 有字 PDF 加强解析 → AI → cancel → 扫描 PDF page_ocr 写回。

伪代码（与实现一一对应）：
  login(csrf)  # QL_USER/QL_PASS 来自 frontend/.env.local
  A1..A3: upload-parsed CSV/XLSX/docx，断言 points>0 与 row_count
  E:  upload(bank_statement_text.pdf)；waitJob；断言 row_count>0 且非纯 needs-vision 空表
  B:  upload(csv) → AI statement_review done → ai-suggest/adopt
  C:  upload(扫描 pdf) → page_ocr → 等 wb_id → cancel
  D:  upload(扫描 pdf) → page_ocr done → result.text → 自动写回 rows>0
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Env([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($v)) { throw "缺少环境变量 $Name" }
  return $v
}

function Invoke-QlCurl {
  param([Parameter(Mandatory = $true)][string[]]$CurlArgs, [switch]$Raw)
  $outFile = [IO.Path]::GetTempFileName(); $hdr = "$outFile.hdr"
  try {
    $all = @("-sS", "-D", $hdr) + $CurlArgs + @("-o", $outFile)
    & curl.exe @all
    if ($LASTEXITCODE -ne 0) { throw "curl exit=$LASTEXITCODE" }
    $statusLine = (Get-Content -Path $hdr -TotalCount 1)
    if ($statusLine -notmatch 'HTTP/\S+\s+(\d+)') { throw "bad status: $statusLine" }
    $code = [int]$Matches[1]
    $body = Get-Content -Raw -Path $outFile
    $json = $null
    if ($body -and $body.Trim().StartsWith("{")) { $json = $body | ConvertFrom-Json }
    return [pscustomobject]@{ Code = $code; Body = $body; Json = $json }
  } finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $outFile, $hdr
  }
}

function Assert-True([bool]$Cond, [string]$Msg) {
  if (-not $Cond) { throw "ASSERT: $Msg" }
}

$Base = if ($env:QL_BASE) { $env:QL_BASE.TrimEnd("/") } else { "http://127.0.0.1:8787" }
$Origin = if ($env:QL_ORIGIN) { $env:QL_ORIGIN.TrimEnd("/") } elseif ($env:PUBLIC_ORIGIN) { $env:PUBLIC_ORIGIN.TrimEnd("/") } else { "http://127.0.0.1:5173" }
$User = Require-Env "QL_USER"
$Pass = Require-Env "QL_PASS"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$CookieJar = Join-Path ([IO.Path]::GetTempPath()) ("ql-dod-" + [guid]::NewGuid().ToString("n") + ".jar")
$PassCount = 0

function Step([string]$Name) { Write-Host ""; Write-Host "== $Name ==" }

function New-Client([string]$csrf, [string]$label) {
  $name = "合成-DoD-$label-" + (Get-Date -Format "HHmmss")
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, (@{ name = $name; authorized = $true } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  try {
    $r = Invoke-QlCurl -CurlArgs @(
      "-b", $CookieJar, "-c", $CookieJar,
      "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
      "-d", "@$tmp", "$Base/api/clients"
    )
    Assert-True ($r.Code -eq 200 -and $r.Json.id) "create client $($r.Code) $($r.Body)"
    return [string]$r.Json.id
  } finally { Remove-Item -Force -ErrorAction SilentlyContinue $tmp }
}

function Get-Case([string]$cid) {
  $r = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid")
  Assert-True ($r.Code -eq 200) "case $($r.Code)"
  return $r.Json
}

function Set-Ownership([string]$csrf, [string]$cid, [string]$docId) {
  $scopes = @{}; $scopes[$docId] = @{ holder = "合成持有人"; relationship = "本人"; include = $true }
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, (@{ scopes = $scopes; note = "dod-smoke"; spouse_name = ""; child_name = "" } | ConvertTo-Json -Depth 6 -Compress), [Text.UTF8Encoding]::new($false))
  try {
    $r = Invoke-QlCurl -CurlArgs @(
      "-b", $CookieJar, "-c", $CookieJar,
      "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
      "-d", "@$tmp", "$Base/api/clients/$cid/ownership"
    )
    Assert-True ($r.Code -eq 200) "ownership $($r.Code) $($r.Body)"
  } finally { Remove-Item -Force -ErrorAction SilentlyContinue $tmp }
}

function Wait-UploadJob([string]$cid, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    Start-Sleep -Milliseconds 800
    $r = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/jobs")
    $list = @()
    if ($r.Json.jobs) { $list = @($r.Json.jobs) }
    $up = @($list | Where-Object { $_.kind -eq "upload" })
    $pending = @($up | Where-Object { $_.status -in @("queued", "running") })
    if ($pending.Count -eq 0 -and $up.Count -gt 0) { return $up[0] }
  } while ((Get-Date) -lt $deadline)
  throw "upload job timeout cid=$cid"
}

function Build-RowsJsonNode([string]$kind, [string]$fixture) {
  $rootPosix = ($Root.Path -replace '\\', '/')
  $fixPosix = ($fixture -replace '\\', '/')
  $code = @"
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = '$rootPosix';
const lib = root + '/frontend/src/features/case/lib/';
const { rowsFromRecords } = await import(pathToFileURL(lib + 'map-standard.js').href);
const path = '$fixPosix';
const kind = '$kind';
let records;
if (kind === 'csv') {
  const { parseCsvText } = await import(pathToFileURL(lib + 'parse-csv.js').href);
  records = parseCsvText(readFileSync(path, 'utf8'));
} else if (kind === 'xlsx') {
  const { readFirstSheet } = await import(pathToFileURL(lib + 'parse-xlsx.js').href);
  const buf = readFileSync(path);
  records = await readFirstSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
} else if (kind === 'docx') {
  const { extractDocxTables } = await import(pathToFileURL(lib + 'docx-table.js').href);
  const buf = readFileSync(path);
  // extractDocxTables 返回 string[][]（含表头行），直接交给 rowsFromRecords
  records = await extractDocxTables(buf);
} else throw new Error('bad kind');
const parsed = rowsFromRecords(records, 'bank_statement', path.split('/').pop());
if (!parsed.ok) throw new Error(parsed.reason || 'parse failed');
process.stdout.write(JSON.stringify(parsed.rows));
"@
  $jsFile = Join-Path $env:TEMP ("ql-rows-" + [guid]::NewGuid().ToString("n") + ".mjs")
  Set-Content -Path $jsFile -Value $code -Encoding utf8
  try {
    $json = & node $jsFile
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) { throw "node rows failed kind=$kind" }
    return $json
  } finally { Remove-Item -Force -ErrorAction SilentlyContinue $jsFile }
}

function Invoke-UploadParsed([string]$csrf, [string]$cid, [string]$fixture, [string]$rowsJson, [string]$mime) {
  $rowsFile = Join-Path $env:TEMP ("ql-rj-" + [guid]::NewGuid().ToString("n") + ".json")
  [IO.File]::WriteAllText($rowsFile, $rowsJson, [Text.UTF8Encoding]::new($false))
  try {
    return Invoke-QlCurl -CurlArgs @(
      "-b", $CookieJar, "-c", $CookieJar,
      "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
      "-F", "file=@$fixture;type=$mime",
      "-F", "source=bank_statement",
      "-F", "client_parsed=1",
      "-F", "rows_json=<$rowsFile",
      "$Base/api/clients/$cid/upload-parsed"
    )
  } finally { Remove-Item -Force -ErrorAction SilentlyContinue $rowsFile }
}

try {
  Step "0) health + login"
  $h = Invoke-QlCurl -CurlArgs @("$Base/health")
  Assert-True ($h.Code -eq 200) "qingliu health"
  $wb = Invoke-QlCurl -CurlArgs @("http://127.0.0.1:8080/health/ready")
  Assert-True ($wb.Code -eq 200 -and ($wb.Body -match "ready")) "workbench ready"
  $loginTmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($loginTmp, (@{ username = $User; password = $Pass } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $login = Invoke-QlCurl -CurlArgs @(
    "-c", $CookieJar, "-b", $CookieJar,
    "-H", "Content-Type: application/json", "-H", "Origin: $Origin",
    "-d", "@$loginTmp", "$Base/api/login"
  )
  Remove-Item -Force -ErrorAction SilentlyContinue $loginTmp
  Assert-True ($login.Code -eq 200) "login $($login.Code)"
  $me = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "-H", "Origin: $Origin", "$Base/api/me")
  $csrf = [string]$me.Json.csrf
  Assert-True (-not [string]::IsNullOrWhiteSpace($csrf)) "csrf"
  Write-Host "login ok"

  # ---- A1 CSV ----
  Step "A1) upload-parsed CSV + 扣费"
  $csv = Join-Path $Root "samples/bank_statement.csv"
  $cid = New-Client $csrf "csv"
  $rows = Build-RowsJsonNode "csv" $csv
  $up = Invoke-UploadParsed $csrf $cid $csv $rows "text/csv"
  Assert-True ($up.Code -eq 200 -and $up.Json.ok) "csv upload-parsed $($up.Body)"
  Assert-True ([int64]$up.Json.points -gt 0) "csv points=$($up.Json.points)"
  $case = Get-Case $cid
  Assert-True ([int]$case.row_count -eq [int]$up.Json.rows) "csv rows case=$($case.row_count) api=$($up.Json.rows)"
  Write-Host "PASS A1 points=$($up.Json.points) rows=$($case.row_count)"; $PassCount++

  # ---- A2 XLSX ----
  Step "A2) upload-parsed XLSX"
  $xlsx = Join-Path $Root "samples/bank_statement.xlsx"
  Assert-True (Test-Path $xlsx) "missing $xlsx — run node scripts/make-samples-office.mjs"
  $cid = New-Client $csrf "xlsx"
  $rows = Build-RowsJsonNode "xlsx" $xlsx
  $up = Invoke-UploadParsed $csrf $cid $xlsx $rows "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  Assert-True ($up.Code -eq 200 -and $up.Json.ok) "xlsx upload-parsed $($up.Body)"
  $case = Get-Case $cid
  Assert-True ([int]$case.row_count -ge 1) "xlsx row_count=$($case.row_count)"
  Write-Host "PASS A2 points=$($up.Json.points) rows=$($case.row_count)"; $PassCount++

  # ---- A3 DOCX ----
  Step "A3) upload-parsed DOCX 标准表"
  $docx = Join-Path $Root "samples/bank_statement_table.docx"
  Assert-True (Test-Path $docx) "missing $docx — run node scripts/make-samples-office.mjs"
  $cid = New-Client $csrf "docx"
  $rows = Build-RowsJsonNode "docx" $docx
  $up = Invoke-UploadParsed $csrf $cid $docx $rows "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  Assert-True ($up.Code -eq 200 -and $up.Json.ok) "docx upload-parsed $($up.Body)"
  Assert-True ([int]$up.Json.rows -eq 5) "docx rows=$($up.Json.rows) want 5"
  Assert-True ([int64]$up.Json.points -gt 0) "docx points"
  $case = Get-Case $cid
  Assert-True ([int]$case.row_count -eq 5) "docx case rows=$($case.row_count)"
  Write-Host "PASS A3 points=$($up.Json.points) rows=5"; $PassCount++

  # ---- E 有字 PDF 加强解析（服务端文字层）----
  Step "E) 有字 PDF 加强解析入库"
  $textPdf = Join-Path $Root "samples/bank_statement_text.pdf"
  Assert-True (Test-Path $textPdf) "missing $textPdf — run python scripts/make-samples-text-pdf.py"
  $cid = New-Client $csrf "textpdf"
  $upload = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar, "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-F", "files=@$textPdf;type=application/pdf", "-F", "source=bank_statement",
    "$Base/api/clients/$cid/upload"
  )
  Assert-True ($upload.Code -eq 200) "text pdf upload $($upload.Body)"
  $job = Wait-UploadJob $cid
  Write-Host "  upload job status=$($job.status) message=$($job.message)"
  $case = Get-Case $cid
  Assert-True ($case.docs.Count -ge 1) "text pdf no document"
  $doc0 = $case.docs[0]
  $metaMethod = ""
  if ($null -ne $doc0.meta) {
    $mp = $doc0.meta.PSObject.Properties["method"]
    if ($null -ne $mp -and $null -ne $mp.Value) { $metaMethod = [string]$mp.Value }
  }
  Write-Host "  docs=1 method=$metaMethod row_count=$($case.row_count) job=$($job.status)"
  Assert-True ([int]$case.row_count -ge 1) "有字 PDF 应抽出交易行，row_count=$($case.row_count) method=$metaMethod job=$($job.status)/$($job.message)"
  Assert-True ($metaMethod -eq "text-layer" -or $metaMethod -eq "text" -or $metaMethod -eq "") "有字 PDF method 异常=$metaMethod"
  Write-Host "PASS E text-pdf rows=$($case.row_count) method=$metaMethod"; $PassCount++

  # ---- B AI done ----
  Step "B) 真实 AI statement_review done"
  $cid = New-Client $csrf "ai"
  $upload = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar, "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-F", "files=@$csv;type=text/csv", "-F", "source=bank_statement",
    "$Base/api/clients/$cid/upload"
  )
  Assert-True ($upload.Code -eq 200) "upload $($upload.Body)"
  Wait-UploadJob $cid | Out-Null
  $case = Get-Case $cid
  $docId = [string]$case.docs[0].id
  Set-Ownership $csrf $cid $docId
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, (@{ document_id = $docId } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $ai = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar,
    "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-d", "@$tmp", "$Base/api/clients/$cid/ai-analysis"
  )
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  Assert-True ($ai.Code -eq 200) "ai start $($ai.Body)"
  $aid = [string]$ai.Json.analysis.id
  $deadline = (Get-Date).AddMinutes(12)
  $final = $null
  do {
    Start-Sleep -Seconds 2
    $list = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/ai-analysis")
    $final = @($list.Json.items) | Where-Object { $_.id -eq $aid } | Select-Object -First 1
    Write-Host "  ai $($final.status)/$($final.progress)"
    if ($final.status -notin @("queued", "running", "uploading")) { break }
  } while ((Get-Date) -lt $deadline)
  Assert-True ($final.status -eq "done") "ai status=$($final.status)"
  Write-Host "PASS B aid=$aid"; $PassCount++

  # optional suggest/adopt if possible
  $sugTmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($sugTmp, (@{ analysis_id = $aid } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $sug = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar,
    "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-d", "@$sugTmp", "$Base/api/clients/$cid/ai-suggest"
  )
  Remove-Item -Force -ErrorAction SilentlyContinue $sugTmp
  Write-Host "  ai-suggest $($sug.Code) $($sug.Body)"
  if ($sug.Code -eq 200) {
    $adopt = Invoke-QlCurl -CurlArgs @(
      "-b", $CookieJar, "-c", $CookieJar,
      "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
      "-d", "{}", "$Base/api/clients/$cid/ai-adopt"
    )
    Write-Host "  ai-adopt $($adopt.Code) $($adopt.Body)"
  }

  # ---- C cancel ----
  Step "C) 双边 cancel"
  # 用 page_ocr（比 statement 更慢）保证拿到 wb_id 后仍在 running 可取消。
  $pdfCancel = Join-Path $Root "samples/ocr-probe/ocr-probe-page.pdf"
  $cid = New-Client $csrf "cancel"
  $upload = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar, "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-F", "files=@$pdfCancel;type=application/pdf", "-F", "source=wechat_statement",
    "$Base/api/clients/$cid/upload"
  )
  Wait-UploadJob $cid | Out-Null
  $case = Get-Case $cid
  $docId = [string]$case.docs[0].id
  Set-Ownership $csrf $cid $docId
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, (@{ document_id = $docId; task = "page_ocr" } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $ai = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar,
    "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-d", "@$tmp", "$Base/api/clients/$cid/ai-analysis"
  )
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  Assert-True ($ai.Code -eq 200) "cancel-start $($ai.Body)"
  $aid = [string]$ai.Json.analysis.id
  # 等 worker 拿到 workbench_analysis_id 再取消，才能验双边 cancel（过早取消只能验本地终态）。
  $wbReady = $null
  $waitWb = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 700
    $list = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/ai-analysis")
    $wbReady = @($list.Json.items) | Where-Object { $_.id -eq $aid } | Select-Object -First 1
    Write-Host "  wait wb_id=$($wbReady.workbench_analysis_id) status=$($wbReady.status)"
    if ([int64]$wbReady.workbench_analysis_id -gt 0) { break }
    if ($wbReady.status -notin @("queued", "running", "uploading")) { break }
  } while ((Get-Date) -lt $waitWb)
  Assert-True ([int64]$wbReady.workbench_analysis_id -gt 0) "missing workbench_analysis_id before cancel (status=$($wbReady.status))"
  $jobs = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/jobs")
  $aiJob = @($jobs.Json.jobs) | Where-Object { $_.kind -eq "ai_analysis" -and $_.status -in @("queued", "running") } | Select-Object -First 1
  if (-not $aiJob) { $aiJob = @($jobs.Json.jobs) | Where-Object { $_.kind -eq "ai_analysis" } | Select-Object -First 1 }
  Assert-True ($null -ne $aiJob) "no ai job"
  $cx = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar, "-X", "POST",
    "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "$Base/api/clients/$cid/jobs/$($aiJob.id)/cancel"
  )
  Assert-True ($cx.Code -eq 200 -and $cx.Json.ok) "cancel $($cx.Body)"
  Start-Sleep -Seconds 1
  $list = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/ai-analysis")
  $final = @($list.Json.items) | Where-Object { $_.id -eq $aid } | Select-Object -First 1
  Assert-True ($final.status -eq "failed") "cancel analysis status=$($final.status)"
  Assert-True ([int64]$final.workbench_analysis_id -gt 0) "missing workbench_analysis_id after cancel"
  Write-Host "PASS C wb=$($final.workbench_analysis_id)"; $PassCount++

  # ---- D page_ocr ----
  Step "D) page_ocr 写回"
  $pdf = Join-Path $Root "samples/ocr-probe/ocr-probe-page.pdf"
  Assert-True (Test-Path $pdf) "missing ocr pdf"
  $cid = New-Client $csrf "ocr"
  $upload = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar, "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-F", "files=@$pdf;type=application/pdf", "-F", "source=wechat_statement",
    "$Base/api/clients/$cid/upload"
  )
  Wait-UploadJob $cid | Out-Null
  $case = Get-Case $cid
  $docId = [string]$case.docs[0].id
  Set-Ownership $csrf $cid $docId
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, (@{ document_id = $docId; task = "page_ocr" } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  $ai = Invoke-QlCurl -CurlArgs @(
    "-b", $CookieJar, "-c", $CookieJar,
    "-H", "Content-Type: application/json", "-H", "X-CSRF-Token: $csrf", "-H", "Origin: $Origin",
    "-d", "@$tmp", "$Base/api/clients/$cid/ai-analysis"
  )
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp
  Assert-True ($ai.Code -eq 200) "page_ocr start $($ai.Body)"
  $aid = [string]$ai.Json.analysis.id
  $deadline = (Get-Date).AddMinutes(8)
  $final = $null
  do {
    Start-Sleep -Seconds 2
    $list = Invoke-QlCurl -CurlArgs @("-b", $CookieJar, "$Base/api/clients/$cid/ai-analysis")
    $final = @($list.Json.items) | Where-Object { $_.id -eq $aid } | Select-Object -First 1
    $ocrText = ""
    if ($null -ne $final -and $null -ne $final.result) {
      $prop = $final.result.PSObject.Properties["text"]
      if ($null -ne $prop -and $null -ne $prop.Value) { $ocrText = [string]$prop.Value }
    }
    Write-Host "  ocr $($final.status)/$($final.progress) text_len=$($ocrText.Length)"
    if ($final.status -notin @("queued", "running", "uploading")) { break }
  } while ((Get-Date) -lt $deadline)
  Assert-True ($final.status -eq "done") "ocr status=$($final.status) err=$($final.error)"
  $ocrText = ""
  if ($null -ne $final.result) {
    $prop = $final.result.PSObject.Properties["text"]
    if ($null -ne $prop -and $null -ne $prop.Value) { $ocrText = [string]$prop.Value }
  }
  Assert-True ($ocrText.Length -gt 0) "ocr result missing text (工作台是否热重启含 text?)"
  $case = Get-Case $cid
  Assert-True ([int]$case.row_count -gt 0) "ocr writeback rows=$($case.row_count)"
  Write-Host "PASS D text_len=$($ocrText.Length) rows=$($case.row_count)"; $PassCount++

  Write-Host ""
  Write-Host "ALL PASS steps=$PassCount"
  Write-Host "对照: docs/计划-清流减负与AI赋能总册.md §8 DoD"
}
finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $CookieJar
}
