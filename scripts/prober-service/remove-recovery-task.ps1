<#
.SYNOPSIS
    Removes the independent recovery path registered by install-recovery-task.ps1.

.DESCRIPTION
    The exact reverse of install-recovery-task.ps1, and nothing more:

      * unregisters \Sovereign\HostProberRecovery,
      * removes the \Sovereign task folder if it is left empty,
      * asserts afterwards that the task really is gone, rather than trusting the
        cmdlet's exit code,
      * leaves the SERVICE alone. The service is not stopped, started or
        reconfigured. Removing the recovery path must never change the state of
        the instrument it was protecting, or the reversal would not be a reversal.

    It deliberately does NOT delete the readiness record. That file is evidence:
    it is what the next operator reads, and a recovery path whose removal also
    erased its own log would be worse than useless.

    The `recovery` key inside the readiness record is left in place for the same
    reason, with its original verdict, so a later boot-verdict.ps1 still shows
    what the recovery path did the last time it fired.

.EXAMPLE
    .\remove-recovery-task.ps1
    .\remove-recovery-task.ps1 -WhatIfOnly

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [switch]$WhatIfOnly,
    [switch]$PurgeReadiness,
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-IsAdmin)) {
    Write-Step 'Not elevated - relaunching remove-recovery-task.ps1 elevated (unregistering a SYSTEM task requires it)'
    $tpath = Join-Path $env:TEMP ("opencode\recoveryremove-elevated-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $tpath) | Out-Null
    Remove-Item $tpath -Force -ErrorAction SilentlyContinue
    $sw = @()
    if ($WhatIfOnly) { $sw += '-WhatIfOnly' }
    if ($PurgeReadiness) { $sw += '-PurgeReadiness' }
    $cmdLine = New-RelaunchCommandLine -ScriptPath $PSCommandPath -Named @{ 'TranscriptPath' = $tpath } -Switches $sw
    $p = Start-Process -FilePath (Get-ElevationShell) -Verb RunAs -ArgumentList $cmdLine -PassThru
    Write-Host "    elevated shell pid=$($p.Id); polling for its transcript (non-blocking)"
    $deadline = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $deadline -and -not $p.HasExited) { Start-Sleep -Milliseconds 500 }
    Write-Host ''
    Write-Host '-------- elevated remove-recovery-task.ps1 stdout --------' -ForegroundColor DarkGray
    if (Test-Path $tpath) { Get-Content $tpath | ForEach-Object { Write-Protected $_ } }
    else { Write-Warn "no transcript at $tpath" }
    Write-Host '-------------------------------------------------------------' -ForegroundColor DarkGray
    if ($p.HasExited) { Write-Host "elevated remove-recovery-task.ps1 exited with code $($p.ExitCode)"; exit $p.ExitCode }
    Write-Fail 'the elevated run did not finish in time'
    exit 1
}

if ($TranscriptPath) { try { Start-Transcript -Path $TranscriptPath -Force | Out-Null } catch { } }

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN HOST PROBER - RECOVERY TASK REMOVAL' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray

$full = Get-RecoveryTaskName
$existing = Get-RecoveryTask
$svc = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Will change exactly this, and nothing else:' -ForegroundColor Yellow
if ($existing) {
    Write-Host "  - unregister task $full (state=$($existing.State))"
    Write-Host "      action: $($existing.Actions.Execute) $($existing.Actions.Arguments)"
    Write-Host "      principal: $($existing.Principal.UserId), trigger: $(($existing.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ',')"
} else {
    Write-Host "  - nothing: task $full is not registered"
}
Write-Host "  - remove task folder $($Script:RecoveryTaskPath) if it is empty"
Write-Host "  - leave service '$Script:ServiceName' $(if ($svc) { "($($svc.Status))" } else { '(not registered)' }) untouched"
Write-Host "  - leave $Script:ReadinessFile in place as evidence$(if ($PurgeReadiness) { ' - EXCEPT: -PurgeReadiness was given, it will be deleted' })"
Write-Host ''

if ($WhatIfOnly) {
    Write-Host 'RESULT: OK (nothing changed)' -ForegroundColor Green
    exit 0
}

if ($existing) {
    Write-Step "Unregistering $full"
    Unregister-ScheduledTask -TaskName $Script:RecoveryTaskName -TaskPath $Script:RecoveryTaskPath -Confirm:$false
    Start-Sleep -Milliseconds 500

    # Assert, do not trust.
    $still = Get-RecoveryTask
    if ($still) {
        Write-Fail "task $full is STILL registered after Unregister-ScheduledTask. Removal failed."
        exit 1
    }
    Write-Ok "task $full is gone (verified by reading the scheduler back, not by the cmdlet's exit code)"
} else {
    Write-Info 'no task to unregister'
}

# Remove the folder only when it is empty, so an unrelated task in \Sovereign\
# is never destroyed as a side effect. GetFolder THROWS for a missing folder
# (MEASURED: System.IO.FileNotFoundException), so the probe is wrapped.
$folderName = $Script:RecoveryTaskPath.Trim('\')
try {
    $sched = New-Object -ComObject 'Schedule.Service'
    $sched.Connect()
    $rootFolder = $sched.GetFolder('\')
    $folder = $null
    try { $folder = $rootFolder.GetFolder($folderName) } catch { $folder = $null }
    if ($null -ne $folder) {
        if (@($folder.GetTasks(1)).Count -eq 0) {
            Write-Step "Task folder '\$folderName' is empty - removing it"
            $rootFolder.DeleteFolder($folderName)
            Start-Sleep -Milliseconds 300
            $gone = $false
            try { $null = $rootFolder.GetFolder($folderName) } catch { $gone = $true }
            if ($gone) { Write-Ok "task folder '\$folderName' removed" }
            else { Write-Warn "task folder '\$folderName' still present" }
        } else {
            Write-Info "task folder '\$folderName' still holds other task(s); left in place"
        }
    } else {
        Write-Info "task folder '\$folderName' does not exist"
    }
    $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($rootFolder)
    $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($sched)
} catch {
    Write-Warn "task folder inspection skipped: $($_.Exception.Message)"
}

if ($PurgeReadiness) {
    if (Test-Path $Script:ReadinessFile) {
        Remove-Item -LiteralPath $Script:ReadinessFile -Force
        Write-Ok "deleted $Script:ReadinessFile"
    } else {
        Write-Info "readiness file not present at $Script:ReadinessFile"
    }
} else {
    Write-Ok "readiness record left intact as evidence: $Script:ReadinessFile (exists=$(Test-Path $Script:ReadinessFile))"
}

if ($svc) {
    Write-Ok "service '$Script:ServiceName' is still $($svc.Status) and was not touched"
} else {
    Write-Info "service '$Script:ServiceName' is not registered (nothing to protect)"
}

Write-Host ''
Write-Host 'RECOVERY TASK: REMOVED' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor DarkGray
exit 0