$ErrorActionPreference = 'Stop'
$base = if ($env:QL_BASE) { $env:QL_BASE } else { 'https://qingliu.bujiaban.top' }
$user = if ($env:QL_USER) { $env:QL_USER } else { 'admin@qingliu.local' }
# 口令不进仓库：运行时从环境变量读。用法示例：
#   $env:QL_PASSWORD = '...'; .\verify-login.ps1
$password = $env:QL_PASSWORD
if (-not $password) {
  throw '请先设置环境变量 QL_PASSWORD（不要把口令写进本文件或提交记录）'
}

$cap = Invoke-RestMethod -Uri "$base/api/auth/captcha?type=click" -TimeoutSec 15
$id = $cap.captcha_id
$prompt = $cap.prompt
$objs = $cap.objects
$code = ''
switch ($prompt) {
  'click_icon' {
    $code = ($objs | Where-Object { $_.kind -eq $cap.icon_target } | Select-Object -First 1).id
  }
  'click_sequence' {
    $ids = foreach ($k in $cap.sequence) { ($objs | Where-Object { $_.kind -eq $k } | Select-Object -First 1).id }
    $code = $ids -join ','
  }
  'click_size_asc' {
    $code = (($objs | Sort-Object { $_.w * $_.h } | ForEach-Object { $_.id }) -join ',')
  }
  'click_size_desc' {
    $code = (($objs | Sort-Object -Descending { $_.w * $_.h } | ForEach-Object { $_.id }) -join ',')
  }
  'click_largest' {
    $code = ($objs | Sort-Object -Descending { $_.w * $_.h } | Select-Object -First 1).id
  }
  'click_smallest' {
    $code = ($objs | Sort-Object { $_.w * $_.h } | Select-Object -First 1).id
  }
  'click_second_smallest' {
    $code = ($objs | Sort-Object { $_.w * $_.h } | Select-Object -Index 1).id
  }
  default { throw "unknown prompt: $prompt" }
}
Write-Output "prompt=$prompt code=$code"
$body = @{
  username = $user
  password = $password
  login_mode = 2
  captcha_id = $id
  captcha_code = $code
} | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "$base/api/login" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15 -SessionVariable sess | ConvertTo-Json -Compress
