[CmdletBinding()]
param(
  [string]$Stage = $(if ($env:TENCENT_SLS_STAGE) { $env:TENCENT_SLS_STAGE } else { 'prod' })
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root '.env.tencent'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "找不到 $envFile。请先复制 .env.example 为 .env.tencent 并填写部署配置。"
}

Get-Content -LiteralPath $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $pair = $line -split '=', 2
  if ($pair.Count -ne 2) { return }
  $name = $pair[0].Trim()
  $value = $pair[1].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}

$required = @('TENCENT_REGION', 'TENCENT_COS_BUCKET', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'CRON_SECRET')
foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
    throw "缺少必填配置：$name"
  }
}
if ([string]::IsNullOrWhiteSpace($env:TENCENT_COS_REGION)) { $env:TENCENT_COS_REGION = $env:TENCENT_REGION }

Push-Location $root
try {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '未找到 npm。请先安装 Node.js 20+。' }
  if (-not (Get-Command serverless -ErrorAction SilentlyContinue) -and -not (Get-Command sls -ErrorAction SilentlyContinue)) {
    throw '未找到 serverless CLI。请先执行 npm install -g serverless。'
  }
  npm install
  npm run check
  if (Get-Command serverless -ErrorAction SilentlyContinue) {
    serverless deploy --stage $Stage
  } else {
    sls deploy --stage $Stage
  }
} finally {
  Pop-Location
}