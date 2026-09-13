$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$refreshAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$projectRoot\refresh-data.mjs`" --trigger scheduled" -WorkingDirectory $projectRoot
$refreshTriggers = @(
  New-ScheduledTaskTrigger -Daily -At '12:00'
  New-ScheduledTaskTrigger -Daily -At '18:00'
)
$refreshSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'Amazon Dashboard Data Refresh' -Action $refreshAction -Trigger $refreshTriggers -Settings $refreshSettings -Description '每天12:00和18:00抓取飞书并更新Amazon数据看板' -User $currentUser -RunLevel Limited -Force | Out-Null

$serverAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$projectRoot\server.mjs`"" -WorkingDirectory $projectRoot
$serverTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$serverSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'Amazon Dashboard Web Server' -Action $serverAction -Trigger $serverTrigger -Settings $serverSettings -Description '登录后启动Amazon数据看板本地服务' -User $currentUser -RunLevel Limited -Force | Out-Null

Get-ScheduledTask -TaskName 'Amazon Dashboard Data Refresh','Amazon Dashboard Web Server' | Select-Object TaskName,State
