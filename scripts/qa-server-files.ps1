#Requires -Version 5.1
<#
  针对"从生产服务器抓取的文件"专项回归：
   - 三份增值税申报表 → 应走 form 模板
   - mx20260920... (19页流水) → transaction
   - 加密PDF_38页 → 应被加密探测拦下，给人话提示
  每个文件走真实上传→解析，成功后对文档调 general-parse（AI 通用解析接口）。
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Base = "http://127.0.0.1:8787"; $Origin = "http://127.0.0.1:5173"
$Root = Split-Path $PSScriptRoot -Parent
$Jar = Join-Path $Root ".local\qa-cookies.txt"
$csrfFile = Join-Path $Root ".local\qa-csrf.txt"

function Ql([string[]]$A) {
  $o=[System.IO.Path]::GetTempFileName(); $h="$o.hdr"
  & curl.exe -sS -D $h -c $Jar -b $Jar @A -o $o 2>$null
  $sl=((Get-Content $h -EA SilentlyContinue|Select-String 'HTTP/')|Select-Object -Last 1).Line
  $c=if($sl){[int](($sl -split ' ')[1])}else{0}
  $b=Get-Content $o -Raw -EA SilentlyContinue; $j=$null
  if($b -and $b.Trim().StartsWith("{")){try{$j=$b|ConvertFrom-Json}catch{}}
  Remove-Item -Force $o,$h -EA SilentlyContinue
  [pscustomobject]@{Code=$c;Body=$b;Json=$j}
}
function WF([string]$v){ $f=[System.IO.Path]::GetTempFileName();[System.IO.File]::WriteAllText($f,$v,[System.Text.UTF8Encoding]::new($false));$f }

$me=Ql "$Base/api/me"; $csrf=[string]$me.Json.csrf
Write-Host "csrf=$($csrf.Substring(0,8))...`n"

$cases=@(
  @{n='申报表2026-10';f='recovered\增值税申报表_2026-10.pdf';s='other';sc='form模板'},
  @{n='申报表2025-12';f='recovered\增值税申报表_2025-12.pdf';s='other';sc='form模板'},
  @{n='申报表2024-12';f='recovered\增值税申报表_2024-12.pdf';s='other';sc='form模板'},
  @{n='mx流水19页';f='recovered\mx20260920_19页流水.pdf';s='bank_statement';sc='19页流水'},
  @{n='加密PDF38页';f='recovered\加密PDF_38页.pdf';s='other';sc='加密→人话提示'}
)
# 若 mx 文件本地没有则从 samples 的19页替代探测；这里先检查
$results=@()
foreach($c in $cases){
  $path=Join-Path $Root $c.f
  if(-not(Test-Path $path)){Write-Host "SKIP $($c.n): 无文件 $($c.f)";continue}
  $cname="【QA-SRV-$($c.n)]"
  $cf=WF ((@{name=$cname;authorized=$true}|ConvertTo-Json -Compress))
  $cr=Ql @("-X","POST","$Base/api/clients","-H","Content-Type: application/json","-H","X-CSRF-Token: $csrf","-H","Origin: $Origin","--data-binary","@$cf");Remove-Item $cf -Force
  if($cr.Code -ne 200){Write-Host "FAIL $($c.n): 建客户 $($cr.Code)";continue}
  $cid=[string]$cr.Json.id
  $ct=switch([System.IO.Path]::GetExtension($path).ToLower()){'.pdf'{'application/pdf'}default{'application/octet-stream'}}
  $up=Ql @("-X","POST","$Base/api/clients/$cid/upload","-H","X-CSRF-Token: $csrf","-H","Origin: $Origin","-F","files=@$path;type=$ct","-F","source=$($c.s)")
  if($up.Code -ne 200){Write-Host "FAIL $($c.n): 上传 $($up.Code) $($up.Body)";$results+=[pscustomobject]@{文件=$c.n;解析="上传失败$($up.Code)";说明=$c.sc;AI="—";详情=$up.Body};continue}
  # 等任务
  $dl=(Get-Date).AddMinutes(6);$job=$null
  do{Start-Sleep -Seconds 2
    $jr=Ql "$Base/api/clients/$cid/jobs";$list=@()
    if($null -ne $jr.Json){$it=$jr.Json.PSObject.Properties['items'];$jb=$jr.Json.PSObject.Properties['jobs'];if($it){$list=@($it.Value)}elseif($jb){$list=@($jb.Value)}}
    $uj=@($list|Where-Object{$_.kind -eq 'upload'});if($uj.Count -eq 0 -and $list.Count -gt 0){$uj=$list}
    $pend=@($uj|Where-Object{$_.status -in @('queued','running')})
    if($pend.Count -eq 0 -and $uj.Count -gt 0){$job=$uj[0];break}
  }while((Get-Date) -lt $dl)
  # 快照
  $case=Ql "$Base/api/clients/$cid";$docs=@()
  if($null -ne $case.Json){$dp=$case.Json.PSObject.Properties['docs'];if($dp){$docs=@($dp.Value)}}
  $doc=$docs|Select-Object -First 1;$meta=$null
  if($doc){$mp=$doc.PSObject.Properties['meta'];if($mp){$meta=$mp.Value}}
  $pdetail=""
  if($meta){
    $issues=@($meta.issues)-join';'
    $pdetail="type=$($meta.doc_type) verdict=$($meta.verdict) st=$($meta.status) rows=$($meta.rows) method=$($meta.method) pages=$($meta.pages)"
    $explain=$meta.PSObject.Properties['explain'];if($explain -and $explain.Value.what){$pdetail+=" 提示=[$($explain.Value.what)]"}
    if($issues){$pdetail+=" issue=[$issues]"}
  }else{$pdetail="job=$($job.status)/$($job.message)"}
  Write-Host "[$($job.status)] $($c.n): $pdetail"

  # AI 通用解析接口：对非加密、有正文的文档调用
  $ai="—"
  $did=if($doc){$doc.id}else{$null}
  $hasText=$meta -and (-not [string]::IsNullOrWhiteSpace([string]$meta.extract_text))
  if($did -and $hasText){
    $ab=WF ((@{preset='key_facts';question='提取关键信息'}|ConvertTo-Json -Compress))
    $ar=Ql @("-X","POST","$Base/api/clients/$cid/documents/$did/general-parse","-H","Content-Type: application/json","-H","X-CSRF-Token: $csrf","-H","Origin: $Origin","--data-binary","@$ab");Remove-Item $ab -Force
    if($ar.Code -eq 200){$ai="OK fields=$(@($ar.Json.result.fields).Count) note=$($ar.Json.result.note)"}else{$ai="FAIL $($ar.Code) $($ar.Body.Substring(0,[Math]::Min(80,$ar.Body.Length)))"}
    Write-Host "   AI general-parse: $ai"
  }else{$ai="跳过(无正文/加密)"}
  $results+=[pscustomobject]@{文件=$c.n;解析=$pdetail;说明=$c.sc;AI=$ai;CID=$cid}
}
Write-Host "`n========== 汇总 =========="
$results|Format-Table -AutoSize -Wrap
$results|ConvertTo-Json -Depth 6|Out-File (Join-Path $Root ".local\qa-server-files-results.json") -Encoding UTF8
Write-Host "结果已存 .local\qa-server-files-results.json"