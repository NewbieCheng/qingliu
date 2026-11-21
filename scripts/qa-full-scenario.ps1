#Requires -Version 5.1
<#
  全场景回归：把测试夹具 + 今天出问题的文档全部走一遍真实上传→解析链路。
  纯本地（qingliu :8787 + 本地工作台 :8080），不扣真实积分。
  每个文档建独立客户，等任务终态，打印 doc_type/verdict/status/rows/method/issue。
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Base = "http://127.0.0.1:8787"
$Origin = "http://127.0.0.1:5173"
$Root = Split-Path $PSScriptRoot -Parent
$Jar = Join-Path $Root ".local\qa-cookies.txt"

function Ql {
  param([string[]]$Args2)
  $out = [System.IO.Path]::GetTempFileName(); $hdr = "$out.hdr"
  & curl.exe -sS -D $hdr -c $Jar -b $Jar @Args2 -o $out 2>$null
  $code = ((Get-Content $hdr -ErrorAction SilentlyContinue | Select-String 'HTTP/') | Select-Object -Last 1).Line
  $code = if ($code) { [int](($code -split ' ')[1]) } else { 0 }
  $body = Get-Content $out -Raw -ErrorAction SilentlyContinue
  $json = $null
  if ($body -and $body.Trim().StartsWith("{")) { try { $json = $body | ConvertFrom-Json } catch {} }
  Remove-Item -Force $out, $hdr -ErrorAction SilentlyContinue
  return [pscustomobject]@{ Code = $code; Body = $body; Json = $json }
}

function Write-Field([string]$p, [string]$v) {
  $f = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($f, $v, [System.Text.UTF8Encoding]::new($false))
  return $f
}

# --- 登录 ---
$loginBody = '{"username":"admin@example.com","password":"demo1234"}'
$lf = Write-Field "" $loginBody
$login = Ql @("-X","POST","$Base/api/login","-H","Content-Type: application/json","-H","Origin: $Origin","--data-binary","@$lf")
Remove-Item -Force $lf
if ($login.Code -ne 200) { throw "login failed $($login.Code) $($login.Body)" }
$me = Ql "$Base/api/me"
$csrf = [string]$me.Json.csrf
Write-Host "login OK csrf=$($csrf.Substring(0,8))...`n"

# --- 场景清单：name | 文件相对路径 | source | 场景说明 ---
$cases = @(
  # 今天出问题的：增值税申报表（应走 form 模板，不误判流水）
  @{ n="申报表-2026-10"; f="recovered\增值税申报表_2026-10.pdf"; s="other";    sc="表单·应识别为form" },
  @{ n="申报表-2025-12"; f="recovered\增值税申报表_2025-12.pdf"; s="other";    sc="表单·应识别为form" },
  @{ n="申报表-2024-12"; f="recovered\增值税申报表_2024-12.pdf"; s="other";    sc="表单·应识别为form" },
  # 标准流水（应走 transaction，有交易行）
  @{ n="银行流水CSV";   f="samples\bank_statement.csv";         s="bank_statement"; sc="标准流水CSV" },
  @{ n="银行流水XLSX";  f="samples\bank_statement.xlsx";        s="bank_statement"; sc="标准流水Excel" },
  @{ n="银行流水DOCX";  f="samples\bank_statement_table.docx";  s="bank_statement"; sc="标准流水Word表" },
  @{ n="微信流水CSV";   f="samples\wechat_statement.csv";       s="wechat_statement"; sc="微信流水" },
  @{ n="支付宝CSV";     f="samples\alipay_statement.csv";       s="alipay_statement"; sc="支付宝流水" },
  @{ n="合成CSV";       f="samples\synthetic.csv";              s="bank_statement"; sc="合成标准流水" },
  @{ n="分列金额CSV";   f="samples\bank_split_amount.csv";      s="bank_statement"; sc="收入支出分列" },
  # 有文字层PDF（text-layer 路径）
  @{ n="文字层PDF";     f="samples\bank_statement_text.pdf";    s="bank_statement"; sc="有文字层PDF" },
  # 坏文件（应优雅失败）
  @{ n="空CSV";         f="samples\bad_empty.csv";              s="bank_statement"; sc="坏文件·应优雅报错" },
  # 扫描件/图片PDF（应走 OCR 路径）
  @{ n="扫描PDF";       f="samples\ocr-probe\ocr-probe-page.pdf"; s="other"; sc="无文字层·OCR路径" },
  @{ n="图片PNG";       f="samples\ocr-probe\ocr-probe-page.png"; s="other"; sc="图片·OCR路径" }
)

$results = @()

foreach ($c in $cases) {
  $path = Join-Path $Root $c.f
  if (-not (Test-Path $path)) { Write-Host "SKIP $($c.n): 文件不存在 $path"; continue }
  $cname = "【QA-1121-$($c.n)]"
  # 建客户
  $cb = @{ name=$cname; authorized=$true } | ConvertTo-Json -Compress
  $cf = Write-Field "" $cb
  $cr = Ql @("-X","POST","$Base/api/clients","-H","Content-Type: application/json","-H","X-CSRF-Token: $csrf","-H","Origin: $Origin","--data-binary","@$cf")
  Remove-Item -Force $cf
  if ($cr.Code -ne 200 -or -not $cr.Json.id) { Write-Host "FAIL $($c.n): 建客户失败 $($cr.Code) $($cr.Body)"; $results += [pscustomobject]@{场景=$c.n;结果="建客户失败";说明=$c.sc;详情=$cr.Body}; continue }
  $cid = [string]$cr.Json.id

  # 上传
  $ext = [System.IO.Path]::GetExtension($path).TrimStart('.').ToLower()
  $ctype = switch($ext){ 'csv'{'text/csv'} 'pdf'{'application/pdf'} 'png'{'image/png'} 'xlsx'{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} 'docx'{'application/vnd.openxmlformats-officedocument.wordprocessingml.document'} default{'application/octet-stream'} }
  $up = Ql @("-X","POST","$Base/api/clients/$cid/upload","-H","X-CSRF-Token: $csrf","-H","Origin: $Origin","-F","files=@$path;type=$ctype","-F","source=$($c.s)")
  if ($up.Code -ne 200) { Write-Host "FAIL $($c.n): 上传 $($up.Code) $($up.Body)"; $results += [pscustomobject]@{场景=$c.n;结果="上传失败$($up.Code)";说明=$c.sc;详情=$up.Body}; continue }

  # 等任务终态
  $deadline = (Get-Date).AddMinutes(6)
  $job = $null
  do {
    Start-Sleep -Seconds 2
    $jr = Ql "$Base/api/clients/$cid/jobs"
    $list = @()
    $jobj = $jr.Json
    if ($null -ne $jobj) {
      $it = $jobj.PSObject.Properties['items']; $jb = $jobj.PSObject.Properties['jobs']
      if ($null -ne $it) { $list = @($it.Value) } elseif ($null -ne $jb) { $list = @($jb.Value) }
    }
    $uj = @($list | Where-Object { $_.kind -eq 'upload' })
    if ($uj.Count -eq 0 -and $list.Count -gt 0) { $uj = $list }
    $pending = @($uj | Where-Object { $_.status -in @('queued','running') })
    if ($pending.Count -eq 0 -and $uj.Count -gt 0) { $job = $uj[0]; break }
  } while ((Get-Date) -lt $deadline)
  if (-not $job) { Write-Host "FAIL $($c.n): 任务超时"; $results += [pscustomobject]@{场景=$c.n;结果="任务超时";说明=$c.sc;详情=""}; continue }

  # 抓快照
  $case = Ql "$Base/api/clients/$cid"
  $docs = @()
  if ($null -ne $case.Json) {
    $dp = $case.Json.PSObject.Properties['docs']
    if ($null -ne $dp) { $docs = @($dp.Value) }
  }
  $doc = $docs | Select-Object -First 1
  $meta = $null
  if ($null -ne $doc) { $mp = $doc.PSObject.Properties['meta']; if ($null -ne $mp) { $meta = $mp.Value } }
  $detail = ""
  if ($meta) {
    $issues = @($meta.issues) -join ";"
    # 失败场景（如空 CSV）不会有 rows/pages。直接点属性在严格模式下会抛异常
    # 并中断整轮回归，所以统一走 PSObject.Properties 取不到就给 "-"。
    $pick = {
      param($o, $n)
      $p = $o.PSObject.Properties[$n]
      if ($null -eq $p -or $null -eq $p.Value) { "-" } else { $p.Value }
    }
    $detail = "doc_type=$(& $pick $meta 'doc_type') verdict=$(& $pick $meta 'verdict') status=$(& $pick $meta 'status') rows=$(& $pick $meta 'rows') method=$(& $pick $meta 'method') pages=$(& $pick $meta 'pages')"
    if ($issues) { $detail += " issue=[$issues]" }
  } else {
    $detail = "job=$($job.status)/$($job.message)"
  }
  Write-Host "[$($job.status)] $($c.n): $detail"
  $results += [pscustomobject]@{场景=$c.n;结果=$job.status;说明=$c.sc;详情=$detail;CID=$cid}
}

Write-Host "`n========== 汇总 =========="
$results | Format-Table -AutoSize -Wrap
$results | ConvertTo-Json -Depth 6 | Out-File (Join-Path $Root ".local\qa-full-results.json") -Encoding UTF8
Write-Host "`n结果已存 .local\qa-full-results.json"
