<#
.SYNOPSIS
    Second, independent recovery path for the Sovereign host-prober service.

.DESCRIPTION
    A service that never starts at boot has no chance of being restarted by the
    things that only apply to a service that DID start: NSSM's AppExit policy
    needs a running process, and the SCM Recovery actions are only armed by a
    start attempt. So the two mechanisms already in place are not independent of
    the failure they are meant to cover.

    This is the independent path. It is deliberately the least intrusive option
    that does not fight the service:

      * It NEVER kills or restarts a service that is already Running. A Running
        service is left strictly alone, even if it is unhealthy, because
        killing a working instrument to "make it healthy again" is how a second
        defect gets introduced. An unhealthy Running service is reported as
        such and the script exits non-zero so the operator is told.
      * It only ever calls Start-Service, which is exactly what the SCM would
        have done at boot.
      * It is idempotent by construction: the first thing it does is read the
        service state, and a healthy Running service produces a NO-OP record and
        zero side effects. Running it twice changes nothing the second time.
      * Its result is written into the same readiness file the service wrapper
        writes, under the `recovery` key, so one file answers both "was the
        instrument healthy when it started" and "did anything rescue it".

    WHY A LOGON-TRIGGERED SCHEDULED TASK, and not the alternatives
    -------------------------------------------------------------
      * SCM Recovery actions - rejected: not independent. They only fire for a
        service that was started and then failed. A service that never starts at
        boot gets no recovery action at all.
      * A second watchdog service - rejected: it adds another process that can
        fail at exactly the same moment (a slow boot), and it would be watching
        the service, which is what the brief says not to do.
      * A WMI permanent event subscription - rejected: heavier to install, and
        much harder to reverse cleanly than Unregister-ScheduledTask.
      * ONBOOT trigger - rejected in favour of ONLOGON: at ONBOOT the machine is
        in exactly the state these hazards describe (Docker engine down, E:
        volume possibly not yet mounted, user profile not loaded). Recovering
        there re-runs the same failure with less information. At logon the
        machine has settled, and the console can be read, so a recovery attempt
        made then is both more likely to succeed and more likely to be correct.
        The acknowledged cost is that a machine nobody ever signs into gets no
        second chance - and on this host the whole measurement chain is
        per-user anyway, because Docker Desktop runs in the user session.

.EXAMPLE
    .\recover-prober.ps1                  # what the task runs
    .\recover-prober.ps1 -DryRun          # report only, touch nothing
    .\recover-prober.ps1 -NoTaskRecord    # do not write to the readiness file

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [string]$ServiceName,
    [int]$Port = 39711,
    [string]$Bind = '127.0.0.1',
    [int]$HealthTimeoutSec = 90,
    [switch]$DryRun,
    [switch]$NoTaskRecord,
    [string]$Trigger,
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
if ($ServiceName) { $Script:ServiceName = $ServiceName }

# Starting a service is an administrative act, so an interactive invocation must
# elevate. The scheduled task already runs as SYSTEM, so the task itself never
# reaches this branch.
if ($Trigger -ne 'scheduled-task' -and -not (Test-IsAdmin)) {
    Write-Step 'Not elevated - relaunching recover-prober.ps1 elevated (Start-Service requires it)'
    $tpath = Join-Path $env:TEMP ("opencode\recover-elevated-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $tpath) | Out-Null
    Remove-Item $tpath -Force -ErrorAction SilentlyContinue
    $sw = @()
    if ($DryRun) { $sw += '-DryRun' }
    if ($NoTaskRecord) { $sw += '-NoTaskRecord' }
    $cmdLine = New-RelaunchCommandLine -ScriptPath $PSCommandPath -Named @{
        'TranscriptPath' = $tpath; 'Port' = "$Port"; 'Bind' = $Bind
        'HealthTimeoutSec' = "$HealthTimeoutSec"; 'ServiceName' = $ServiceName
    } -Switches $sw
    $p = Start-Process -FilePath (Get-ElevationShell) -Verb RunAs -ArgumentList $cmdLine -PassThru
    Write-Host "    elevated shell pid=$($p.Id); polling for its transcript (non-blocking)"
    $deadline = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $deadline) {
        if ($p.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    Write-Host ''
    Write-Host '---------------- elevated recover-prober.ps1 stdout ----------------' -ForegroundColor DarkGray
    if (Test-Path $tpath) { Get-Content $tpath | ForEach-Object { Write-Protected $_ } }
    else { Write-Warn "no transcript at $tpath" }
    Write-Host '------------------------------------------------------------------' -ForegroundColor DarkGray
    if ($p.HasExited) { Write-Host "elevated recover-prober.ps1 exited with code $($p.ExitCode)"; exit $p.ExitCode }
    Write-Fail 'the elevated run did not finish in time'
    exit 1
}

if ($TranscriptPath) { try { Start-Transcript -Path $TranscriptPath -Force | Out-Null } catch { } }

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN HOST PROBER - INDEPENDENT RECOVERY ATTEMPT' -ForegroundColor White
Write-Host " trigger         : $(if ($Trigger) { $Trigger } else { 'manual invocation' })"
Write-Host " account         : $env:USERDOMAIN\$env:USERNAME"
Write-Host '================================================================' -ForegroundColor DarkGray

$boot = Get-BootIdentity
Write-Info "machine uptime at this moment: $($boot.UptimeSec)s (boot $($boot.BootTimeUtc), BootId=$($boot.BootId))"

$result = [ordered]@{
    schema           = 'sovereign.prober.recovery/1'
    chainKeyId       = '360ea36c28e66d9d'
    atUtc            = (Get-Date).ToUniversalTime().ToString('o')
    trigger          = $(if ($Trigger) { $Trigger } else { 'manual' })
    account          = "$env:USERDOMAIN\$env:USERNAME"
    serviceName      = $Script:ServiceName
    dryRun           = [bool]$DryRun
    uptimeSecAtRun   = $boot.UptimeSec
    bootIdAtRun      = $boot.BootId
    action           = 'NONE'
    verdict          = 'FAIL'
    idempotentNoOp   = $false
    detail           = ''
}

function Complete {
    param([string]$Action, [string]$Verdict, [string]$Detail, [bool]$NoOp = $false, $Extra = $null)
    $result.action = $Action
    $result.verdict = $Verdict
    $result.detail = $Detail
    $result.idempotentNoOp = $NoOp
    if ($Extra) { foreach ($k in $Extra.Keys) { $result[$k] = $Extra[$k] } }
    Write-Host ''
    switch ($Action) {
        'NOOP_SERVICE_RUNNING'             { Write-Ok  "NO-OP: '$Script:ServiceName' is Running and /probe/health is ok. Nothing was changed." }
        'NOOP_SERVICE_RUNNING_UNHEALTHY'   { Write-Warn "NO-OP: '$Script:ServiceName' reports Running but /probe/health is not ok. Deliberately NOT killed or restarted - see the readiness record for why." }
        'WOULD_START_SERVICE'              { Write-Info "[DryRun] would call Start-Service '$Script:ServiceName' and wait up to ${HealthTimeoutSec}s for /probe/health." }
        'STARTED_SERVICE'                 { Write-Ok  "Start-Service issued; /probe/health ok after $($result['healthWaitMs'])ms." }
        'FAILED_TO_START'                 { Write-Fail $Detail }
        'SERVICE_ABSENT'                  { Write-Fail $Detail }
        default                           { Write-Warn $Detail }
    }
}

$svc = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Complete -Action 'SERVICE_ABSENT' -Verdict 'FAIL' `
        -Detail "service '$Script:ServiceName' is not registered. Recovery cannot act. Run scripts/prober-service/install.ps1."
} else {
    Write-Info "service state on entry: $($svc.Status)"

    if ($svc.Status -eq 'Running') {
        $h = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 10
        if ($h.Reachable -and $h.Ok) {
            Complete -Action 'NOOP_SERVICE_RUNNING' -Verdict 'OK' `
                -Detail "service was already Running and healthy; the recovery path has nothing to do" -NoOp $true `
                -Extra @{ healthOk = $true }
        } else {
            Complete -Action 'NOOP_SERVICE_RUNNING_UNHEALTHY' -Verdict 'FAIL' `
                -Detail "service is Running but /probe/health answered: $(if ($h.Reachable) { "ok=$($h.Raw.ok)" } else { $h.Error }). Left untouched on purpose: this path must not fight the service." `
                -Extra @{ healthOk = $false; healthError = $(if ($h.Reachable) { $null } else { $h.Error }) }
        }
    } else {
        if ($DryRun) {
            Complete -Action 'WOULD_START_SERVICE' -Verdict 'OK' -Detail "service is $($svc.Status); would start it" -NoOp $false
        } else {
            Write-Step "Calling Start-Service '$Script:ServiceName' (exactly what the SCM does at boot)"
            $t0 = Get-Date
            $startError = $null
            try {
                Start-Service -Name $Script:ServiceName -ErrorAction Stop
            } catch {
                $startError = $_.Exception.Message
            }
            if ($startError) {
                Complete -Action 'FAILED_TO_START' -Verdict 'FAIL' -Detail "Start-Service threw: $startError"
            } else {
                $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
                $health = $null
                while ((Get-Date) -lt $deadline) {
                    $health = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 3
                    if ($health.Reachable -and $health.Ok) { break }
                    Start-Sleep -Milliseconds 750
                }
                $waitMs = [int]((Get-Date) - $t0).TotalMilliseconds
                if ($health -and $health.Reachable -and $health.Ok) {
                    Complete -Action 'STARTED_SERVICE' -Verdict 'OK' `
                        -Detail "service started by the recovery path and became healthy" `
                        -Extra @{ healthWaitMs = $waitMs; healthOk = $true; stateAfter = (Get-Service -Name $Script:ServiceName).Status }
                } else {
                    Complete -Action 'FAILED_TO_START' -Verdict 'FAIL' `
                        -Detail "Start-Service was accepted but /probe/health did not answer ok=true within ${HealthTimeoutSec}s (waited ${waitMs}ms). Read the service log and the readiness record." `
                        -Extra @{ healthWaitMs = $waitMs; healthOk = $false }
                }
            }
        }
    }
}

# --- write the result into the readiness file ------------------------------
# boot-guard.mjs owns the `service` key; this script owns `recovery`. The guard
# does the merge itself with the same short exclusive lock, so the two writers
# cannot interleave and neither can clobber the other.
$readiness = $Script:ReadinessFile
$result.readinessFile = $readiness
if ($NoTaskRecord) {
    Write-Info '-NoTaskRecord: not writing to the readiness file'
    Write-Info ("would record: " + (($result.GetEnumerator() | Where-Object { $_.Key -notin @('schema','chainKeyId') } | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '))
} elseif ($DryRun) {
    Write-Info "[DryRun] would write this record into $readiness under the 'recovery' key"
} else {
    $svc1 = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
    $result.serviceStateAfter = if ($svc1) { $svc1.Status.ToString() } else { 'Absent' }
    New-Item -ItemType Directory -Force -Path $Script:MachineRoot -ErrorAction SilentlyContinue | Out-Null
    $merged = Merge-ReadinessRecord -Path $readiness -Key 'recovery' -Value ([pscustomobject]$result)
    if ($merged.Ok) {
        Write-Ok "recovery result written into $readiness under the 'recovery' key"
    } else {
        Write-Fail "could NOT write the recovery result into ${readiness}: $($merged.Error). The operator will not see this attempt in the readiness record."
    }
}

Write-Host ''
if ($result.verdict -eq 'OK') { Write-Host ' RECOVERY: OK' -ForegroundColor Green; exit 0 }
Write-Host ' RECOVERY: FAILED' -ForegroundColor Red
exit 1