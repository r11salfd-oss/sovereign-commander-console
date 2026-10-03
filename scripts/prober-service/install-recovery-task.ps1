<#
.SYNOPSIS
    Registers the SECOND, independent recovery path for the host-prober service.

.DESCRIPTION
    Creates one scheduled task, `\Sovereign\HostProberRecovery`, triggered at the
    logon of the profile the instrument measures, running as SYSTEM with the
    highest run level, whose only action is recover-prober.ps1.

    WHY THIS EXISTS
      The service has three restart layers, and all three of them require the
      service to have been STARTED at least once:

        * NSSM AppExit        - needs a running child process to have exited
        * SCM Recovery actions - armed by a start attempt, fire on a later failure
        * SERVICE_DELAYED_AUTO_START - the start itself

      So "the service never started at boot" is the one failure none of them can
      cover. This task covers exactly that gap and nothing else.

    PROPERTIES THAT MATTER
      * Idempotent by construction: the task is unregistered and recreated, so
        running this twice leaves exactly one task with the current definition.
      * Least privilege for the action: recover-prober.ps1 does nothing at all
        when the service is already Running and healthy.
      * Fully reversible: remove-recovery-task.ps1 undoes this exactly, and
        uninstall.ps1 calls it.
      * The action is a file inside the repository by absolute path, and the
        principal is SYSTEM, so it does not depend on the user's PATH, profile
        or an interactive shell.

    NOTHING TO DO WITH THE SERVICE ITSELF: this script never stops, restarts or
    reconfigures the service. It only registers a task that MAY call
    Start-Service, and only when the service is not already Running.

.EXAMPLE
    .\install-recovery-task.ps1
    .\install-recovery-task.ps1 -LogonUser 'DESKTOP-7FSRQ0H\AA5II' -WhatIfOnly

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [string]$ServiceName,
    [int]$Port = 39711,
    [string]$Bind = '127.0.0.1',
    [string]$LogonUser,
    [int]$HealthTimeoutSec = 90,
    [switch]$WhatIfOnly,
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
if ($ServiceName) { $Script:ServiceName = $ServiceName }

if (-not (Test-IsAdmin)) {
    Write-Step 'Not elevated - relaunching install-recovery-task.ps1 elevated (a SYSTEM-principal task requires it)'
    $tpath = Join-Path $env:TEMP ("opencode\recoverytask-elevated-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $tpath) | Out-Null
    Remove-Item $tpath -Force -ErrorAction SilentlyContinue
    $sw = @()
    if ($WhatIfOnly) { $sw += '-WhatIfOnly' }
    $cmdLine = New-RelaunchCommandLine -ScriptPath $PSCommandPath -Named @{
        'TranscriptPath' = $tpath; 'Port' = "$Port"; 'Bind' = $Bind
        'HealthTimeoutSec' = "$HealthTimeoutSec"; 'ServiceName' = $ServiceName; 'LogonUser' = $LogonUser
    } -Switches $sw
    $p = Start-Process -FilePath (Get-ElevationShell) -Verb RunAs -ArgumentList $cmdLine -PassThru
    Write-Host "    elevated shell pid=$($p.Id); polling for its transcript (non-blocking)"
    $deadline = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $deadline -and -not $p.HasExited) { Start-Sleep -Milliseconds 500 }
    Write-Host ''
    Write-Host '-------- elevated install-recovery-task.ps1 stdout --------' -ForegroundColor DarkGray
    if (Test-Path $tpath) { Get-Content $tpath | ForEach-Object { Write-Protected $_ } }
    else { Write-Warn "no transcript at $tpath" }
    Write-Host '-------------------------------------------------------------' -ForegroundColor DarkGray
    if ($p.HasExited) { Write-Host "elevated install-recovery-task.ps1 exited with code $($p.ExitCode)"; exit $p.ExitCode }
    Write-Fail 'the elevated run did not finish in time'
    exit 1
}

if ($TranscriptPath) { try { Start-Transcript -Path $TranscriptPath -Force | Out-Null } catch { } }

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN HOST PROBER - RECOVERY TASK REGISTRATION' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray

# --- what exactly am I registering ----------------------------------------
$action = Get-RecoveryScriptPath
if (-not (Test-Path $action)) { throw "recover-prober.ps1 not found at $action" }
$action = (Resolve-Path $action).Path
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $psExe)) { $psExe = 'powershell.exe' }

# The trigger user defaults to the profile the instrument measures, because the
# whole measurement chain on this host is per-user (Docker Desktop runs in the
# user session). Triggering on any user's logon would be broader than needed.
if (-not $LogonUser) {
    $LogonUser = "$env:USERDOMAIN\$env:USERNAME"
    if (-not (Test-Path $LogonUser)) { $LogonUser = $env:USERNAME }
}
$logonUserName = ($LogonUser -split '\\')[-1]

Write-Info "task name       : $(Get-RecoveryTaskName)"
Write-Info "trigger         : at logon of $LogonUser"
Write-Info "principal       : NT AUTHORITY\SYSTEM (highest run level, ServiceAccount logon type)"
Write-Info "action          : $psExe"
Write-Info "                 -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$action`""
Write-Info "                 -ServiceName $Script:ServiceName -Port $Port -Bind $Bind -HealthTimeoutSec $HealthTimeoutSec -Trigger scheduled-task"
Write-Info 'why SYSTEM      : it must be able to Start-Service without a password and without a profile.'

# --- prove the target exists before wiring a task to it --------------------
foreach ($must in @(
    (Join-Path (Get-RepoRoot) 'scripts\host_prober.ts'),
    (Get-TsxCliPath),
    (Get-BootGuardPath)
)) {
    if (-not (Test-Path $must)) { throw "the recovery path would point at a missing file: $must" }
}
Write-Ok 'every file the recovery path depends on exists'

$svc = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Warn "service '$Script:ServiceName' is not registered. The task will be created anyway; it will record SERVICE_ABSENT if it ever fires. Run install.ps1 first."
} else {
    Write-Ok "target service '$Script:ServiceName' is registered and currently $($svc.Status)"
}

$existing = Get-RecoveryTask
Write-Host ''
if ($existing) {
    Write-Info "an existing registration is present (state=$($existing.State)); it will be replaced so re-running is idempotent"
} else {
    Write-Info 'no existing registration; this is a first install'
}

if ($WhatIfOnly) {
    Write-Host ''
    Write-Host '[WhatIf] would:' -ForegroundColor Yellow
    Write-Host "  1. ensure the task folder $($Script:RecoveryTaskPath) exists"
    Write-Host "  2. unregister $($Script:RecoveryTaskName) if present"
    Write-Host "  3. register $($Script:RecoveryTaskName) with the trigger/principal/action printed above"
    Write-Host ''
    Write-Host 'RESULT: OK (nothing changed)' -ForegroundColor Green
    exit 0
}

# --- create ---------------------------------------------------------------
# New-ScheduledTask / Register-ScheduledTask will NOT create a missing task
# folder, so it is created explicitly through the Task Scheduler COM API.
#
# MEASURED BUG, fixed here: `IFolder.GetFolder(name)` does NOT return $null for a
# missing folder. It THROWS System.IO.FileNotFoundException (HRESULT 0x80070002).
# Written as `if ($null -eq $rootFolder.GetFolder($f)) { create }`, the throw was
# terminating under $ErrorActionPreference='Stop', so install-recovery-task.ps1
# died silently right after printing "no existing registration", install.ps1 died
# with it, and no task was ever created. The probe is now wrapped, and the create
# is idempotent because a second CreateFolder on an existing folder is skipped.
Write-Step 'Ensuring the task folder exists'
$folderName = $Script:RecoveryTaskPath.Trim('\')
$sched = New-Object -ComObject 'Schedule.Service'
$sched.Connect()
$rootFolder = $sched.GetFolder('\')
$folderExists = $false
try {
    $null = $rootFolder.GetFolder($folderName)
    $folderExists = $true
} catch [System.IO.FileNotFoundException] {
    $folderExists = $false
} catch {
    $folderExists = $false
    Write-Info "GetFolder('$folderName') reported: $($_.Exception.Message)"
}
if ($folderExists) {
    Write-Ok "task folder '\$folderName' already exists"
} else {
    Write-Step "Creating task folder '\$folderName'"
    $null = $rootFolder.CreateFolder($folderName)
    Start-Sleep -Milliseconds 300
    $verify = $false
    try { $null = $rootFolder.GetFolder($folderName); $verify = $true } catch { $verify = $false }
    if (-not $verify) { throw "CreateFolder('\$folderName') returned but the folder still does not exist" }
    Write-Ok "task folder '\$folderName' created"
}
$null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($rootFolder)
$null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($sched)

if ($existing) {
    Write-Step "Unregistering the previous $($Script:RecoveryTaskName)"
    Unregister-ScheduledTask -TaskName $Script:RecoveryTaskName -TaskPath $Script:RecoveryTaskPath -Confirm:$false
    Start-Sleep -Milliseconds 500
    Write-Ok 'previous registration removed'
}

Write-Step 'Registering the task'
$taskArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', $action,
    '-ServiceName', $Script:ServiceName,
    '-Port', "$Port",
    '-Bind', $Bind,
    '-HealthTimeoutSec', "$HealthTimeoutSec",
    '-Trigger', 'scheduled-task'
)
$quoted = ($taskArgs | ForEach-Object { ConvertTo-CommandLineArg $_ }) -join ' '

$taskAction  = New-ScheduledTaskAction -Execute $psExe -Argument $quoted -WorkingDirectory (Get-RepoRoot)
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $LogonUser
$taskMain    = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)

$null = Register-ScheduledTask -TaskName $Script:RecoveryTaskName -TaskPath $Script:RecoveryTaskPath `
    -Action $taskAction -Trigger $taskTrigger -Principal $taskMain -Settings $taskSettings `
    -Description 'Second, independent recovery path for the Sovereign host-prober service. Fires at logon; does nothing at all when the service is already Running and healthy. Result is merged into C:\ProgramData\sovereign-commander-console\readiness.json under the recovery key. Remove with scripts/prober-service/remove-recovery-task.ps1'

# --- prove it is really registered, not just reported registered -----------
Write-Step 'Reading the task back from the scheduler'
$read = Get-RecoveryTask
if (-not $read) { throw 'Register-ScheduledTask returned but the task is not present. Refusing to claim success.' }
$info = Get-ScheduledTaskInfo -TaskName $Script:RecoveryTaskName -TaskPath $Script:RecoveryTaskPath

Write-Host ''
Write-Info "name          : $($read.TaskName)"
Write-Info "path          : $($read.TaskPath)"
Write-Info "state         : $($read.State)"
Write-Info "principal     : $($read.Principal.UserId) / logonType=$($read.Principal.LogonType) / runLevel=$($read.Principal.RunLevel)"
Write-Info "triggers      : $(($read.Triggers | ForEach-Object { "$($_.CimClass.CimClassName) user=$($_.UserId)" }) -join ', ')"
Write-Info "last run      : $($info.LastRunTime)  result=$($info.LastTaskResult)  next=$($info.NextRunTime)"
Write-Info "action        : $($read.Actions.Execute)"
Write-Info "arguments     : $($read.Actions.Arguments)"

# Assert the definition rather than trusting the cmdlet's exit code. A task that
# exists but is wired to the wrong script is worse than no task, because it looks
# like recovery.
$argText = "$($read.Actions.Arguments)"
$assertions = @(
    @{ name = 'action points at recover-prober.ps1'; pass = $argText -like "*recover-prober.ps1*"; detail = $argText }
    @{ name = 'action carries -Trigger scheduled-task'; pass = $argText -like '*-Trigger scheduled-task*'; detail = $argText }
    @{ name = 'principal is SYSTEM'; pass = "$($read.Principal.UserId)" -match 'SYSTEM'; detail = "$($read.Principal.UserId)" }
    @{ name = 'run level is Highest'; pass = "$($read.Principal.RunLevel)" -eq 'Highest'; detail = "$($read.Principal.RunLevel)" }
    @{ name = 'trigger is AtLogOn'; pass = @($read.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -gt 0; detail = (($read.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ',') }
)
$failed = 0
foreach ($a in $assertions) {
    if ($a.pass) { Write-Ok $a.name } else { Write-Fail "$($a.name) (observed: $($a.detail))"; $failed++ }
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
if ($failed -eq 0) {
    Write-Host ' RECOVERY TASK: INSTALLED AND VERIFIED' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Prove it does nothing when the service is healthy:'
    Write-Host "    & `"$action`" -ServiceName $Script:ServiceName -Port $Port -Bind $Bind -Trigger manual-test"
    Write-Host '  Remove it again:'
    Write-Host '    .\remove-recovery-task.ps1'
    Write-Host '================================================================' -ForegroundColor DarkGray
    exit 0
}
Write-Host " RECOVERY TASK: INSTALLED BUT $failed ASSERTION(S) FAILED" -ForegroundColor Red
Write-Host '================================================================' -ForegroundColor DarkGray
exit 1