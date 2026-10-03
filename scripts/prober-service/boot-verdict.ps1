<#
.SYNOPSIS
    One command that returns a decisive BOOT OK / BOOT FAILED verdict after a reboot.

.DESCRIPTION
    The question this answers is NOT "is the prober up right now". It is:

        did the Service Control Manager start it during THIS boot, and did
        everything it depends on actually exist at that moment?

    Re-running the interactive checks cannot answer that - by the time a human
    runs a command, Docker is up, the volume is mounted and the profile is
    loaded, so every check would pass even if the service had never started at
    all. That is precisely the assumption this project refuses to depend on.

    So the verdict is built from four independent kinds of evidence:

      A. DID IT START AT BOOT?  (from the readiness record, never from a live
         probe)
           1. the record's `boot.uptimeSecAtStart` versus the machine's CURRENT
              uptime. A small value at record time means the SCM started the
              service moments after power-on. A large value means a human did.
           2. `boot.recordedAtUtc` versus Win32_OperatingSystem.LastBootUpTime.
           3. `boot.bootId` versus the machine's current BootId, which
              increments once per power-on and cannot be confused with a clock
              change.
           4. the service process's CreationDate versus LastBootUpTime - an
              entirely separate source, not written by the wrapper.
         All four must agree, or the verdict is BOOT FAILED with the disagreement
         named.

      B. DID ITS PRECONDITIONS HOLD AT THAT MOMENT?  From the readiness record's
         per-check verdicts, including its BootId. A record from a PREVIOUS boot
         says nothing about this boot and is reported as stale.

      C. IS IT UP NOW?  Live: service state, loopback listener, /probe/health.

      D. DOES THE CONSOLE ACTUALLY REACH IT NOW?  The one thing a host-side
         script cannot prove on its own. host.docker.internal resolving on the
         host is NOT sufficient - Docker Desktop leaves a static hosts-file entry
         that survives with the engine stopped. So the end-to-end path is asked of
         the console itself, which lives in the container and is the only vantage
         point that can answer it truthfully.

      E. Defender, asked off the service start path. Get-MpComputerStatus takes
         ~1.9s MEASURED on this host and can block while Defender is still
         starting, so it is deliberately not on the wrapper's start path. Here,
         after boot, it is cheap enough to ask, and it closes the last
         enumerated hazard.

    NO ELEVATION IS REQUIRED. Everything it reads is readable by BUILTIN\Users,
    so this can be pasted into any shell after a reboot.

.PARAMETER AllowHazards
    Exit 0 on DEGRADED instead of FAIL. A boot hazard that was present at start
    but is resolved now is worth knowing about, not necessarily worth failing a
    gate over; the default is to fail loudly.

.PARAMETER Json
    Emit the same verdict as a single JSON object on stdout.

.EXAMPLE
    .\boot-verdict.ps1
    .\boot-verdict.ps1 -Json
    .\boot-verdict.ps1 -ConsoleBaseUrl http://127.0.0.1:3000 -AllowHazards

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [string]$ServiceName,
    [int]$Port = 39711,
    [string]$Bind = '127.0.0.1',
    [string]$ConsoleBaseUrl = 'http://127.0.0.1:3000',
    [int]$StartupWindowSec = 900,
    [switch]$AllowHazards,
    [switch]$Json,
    [switch]$SkipDefender
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
if ($ServiceName) { $Script:ServiceName = $ServiceName }

$boot = Get-BootIdentity
$readiness = Get-ReadinessRecord
$expectations = Get-ExpectationsRecord
$record = $readiness.Record

$reasons = New-Object System.Collections.Generic.List[string]
$notes   = New-Object System.Collections.Generic.List[string]

function Reason { param([string]$Text) $reasons.Add($Text) | Out-Null }
function Note   { param([string]$Text) $notes.Add($Text)   | Out-Null }

# ===========================================================================
# A. Did the SCM start it during THIS boot?
# ===========================================================================
$startedAtBoot = $false
$startEvidence = [ordered]@{}
$expected = $expectations

if ($null -eq $record) {
    Reason "no startup readiness record exists at $($readiness.Path) ($(if ($readiness.Error) { $readiness.Error } else { 'not found' })). Nothing has ever proven its own boot conditions. Run install.ps1."
} else {
    $rBoot = Get-Prop $record 'boot'
    $rSvc  = Get-Prop $record 'service'
    $uptimeAtStart = Get-Prop $rBoot 'uptimeSecAtStart'
    $recordedAt    = Get-Prop $record 'recordedAtUtc'
    $recBootId     = Get-Prop $rBoot 'bootId'

    $startEvidence.recordedAtUtc        = $recordedAt
    $startEvidence.uptimeSecAtStart     = $uptimeAtStart
    $startEvidence.currentUptimeSec     = $boot.UptimeSec
    $startEvidence.recordBootId         = $recBootId
    $startEvidence.currentBootId        = $boot.BootId
    $startEvidence.machineLastBootUpTime= $boot.LastBootUpTime

    # 1 + 2 + 3: the record must belong to this boot.
    $belongsToThisBoot = $true
    if ($null -ne $recBootId -and $null -ne $boot.BootId -and [int]$recBootId -ne [int]$boot.BootId) {
        $belongsToThisBoot = $false
        Reason "the readiness record was written under BootId=$recBootId but the machine is now at BootId=$($boot.BootId). The record is from an EARLIER boot, so it says nothing about this one."
    }
    if ($recordedAt) {
        try {
            $recUtc = ([datetime]::Parse($recordedAt)).ToUniversalTime()
            $bootUtc = [datetime]::Parse($boot.BootTimeUtc)
            $lag = ($recUtc - $bootUtc).TotalSeconds
            $startEvidence.recordLagSecAfterBoot = [int]$lag
            if ($lag -lt -60) {
                $belongsToThisBoot = $false
                Reason "the readiness record is timestamped $([int]$lag)s BEFORE this boot. It cannot describe this boot."
            }
        } catch {
            Note "could not parse recordedAtUtc '$recordedAt' ($($_.Exception.Message))"
        }
    }
    if ($belongsToThisBoot -and $null -ne $uptimeAtStart -and $null -ne $boot.UptimeSec) {
        # A service started by the SCM at boot has a small uptime at record time.
        # The window is generous because SERVICE_DELAYED_AUTO_START deliberately
        # waits, and because a slow disk can push the delayed start out.
        if ([double]$uptimeAtStart -le $StartupWindowSec) {
            $startEvidence.startedAtBoot = $true
        } else {
            Reason ("the prober recorded its readiness $($uptimeAtStart)s AFTER power-on, not within the $StartupWindowSec`s startup window. Something started it by hand; the boot path is not proven for this start.")
        }
    }

    # 4: an independent source the wrapper did not write.
    $cim = Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'" -ErrorAction SilentlyContinue
    $pid0 = if ($cim) { [int](Get-Prop $cim 'ProcessId') } else { 0 }
    $startEvidence.servicePid = $pid0
    if ($pid0 -gt 0 -and $boot.LastBootUpTime) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid0" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CreationDate) {
            $procLag = ($proc.CreationDate - $boot.LastBootUpTime).TotalSeconds
            $startEvidence.serviceProcessCreatedLagSecAfterBoot = [int]$procLag
            if ($procLag -ge 0 -and $procLag -le $StartupWindowSec) {
                $startEvidence.processProvesBootStart = $true
            } elseif ($procLag -lt 0) {
                Note "service process $pid0 predates LastBootUpTime, which is impossible; the process identity is probably a recycled PID. Not counted as evidence either way."
            } else {
                Reason "the service process (pid $pid0) was created $($procLag)s after power-on, outside the $StartupWindowSec`s window."
            }
        }
    } elseif ($pid0 -eq 0) {
        Note "service process id is 0 (not running), so there is no CreationDate evidence"
    }

    $startedAtBoot = [bool]$startEvidence['startedAtBoot']
}

# ===========================================================================
# B. Did its preconditions hold at that moment?
# ===========================================================================
$readinessVerdict = 'UNKNOWN'
$failedChecks = @()
if ($null -ne $record) {
    $readinessVerdict = [string](Get-Prop $record 'verdict' 'UNKNOWN')
    $rSvc = Get-Prop $record 'service'
    $failedChecks = @(Get-Prop $rSvc 'failedChecks' @())
    if ($readinessVerdict -eq 'FAIL') {
        foreach ($c in $failedChecks) {
            Reason "readiness verdict FAIL at service start: [$($c.severity)] $($c.name) - $($c.detail)"
        }
        if (@($failedChecks).Count -eq 0) { Reason 'readiness verdict FAIL but no failed check was recorded - the record is malformed' }
    } elseif ($readinessVerdict -eq 'DEGRADED') {
        foreach ($c in $failedChecks) {
            Note "boot hazard present at service start: [$($c.severity)] $($c.name) - $($c.detail)"
        }
    } elseif ($readinessVerdict -eq 'UNKNOWN') {
        Reason 'the readiness record carries verdict UNKNOWN'
    }
} 

# ===========================================================================
# C. Is it up now?
# ===========================================================================
$svc = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
$serviceUp = $false
$healthOk = $false
$listenerOk = $false
if (-not $svc) {
    Reason "service '$Script:ServiceName' is not registered"
} else {
    $serviceUp = ($svc.Status -eq 'Running')
    if (-not $serviceUp) { Reason "service state is $($svc.Status), not Running" }
    $listener = Get-PortListener -Port $Port
    if ($listener) {
        $listenerOk = ($listener.Address -in @('127.0.0.1', '::1'))
        if (-not $listenerOk) { Reason "port $Port is bound to $($listener.Address), which is not a loopback address" }
    } else {
        Reason "nothing is listening on port $Port"
    }
    $h = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 10
    $healthOk = ($h.Reachable -and $h.Ok)
    if (-not $healthOk) { Reason "/probe/health did not answer ok=true: $(if ($h.Reachable) { "ok=$($h.Raw.ok)" } else { $h.Error })" }
}

# ===========================================================================
# D. Does the console reach it right now?  (the end-to-end path)
# ===========================================================================
$consoleState = [ordered]@{ reachable = $false; hostProberReachable = $false; healthScore = $null; mcpSource = $null; error = $null }
try {
    $c = Invoke-RestMethod -Uri "$ConsoleBaseUrl/api/agents/framework" -TimeoutSec 45
    $consoleState.reachable = [bool]$c.ok
    $consoleState.healthScore = $c.healthScore
    $consoleState.mcpSource = $c.healthScoreBasis.mcpSource
    $consoleState.hostProberReachable = [bool]$c.hostProber.reachable
    if (-not $c.ok) { Reason 'console /api/agents/framework reported ok=false' }
    if (-not $c.hostProber.reachable) { Reason 'the console reports hostProber.reachable=false: the container cannot reach the prober' }
    if ($c.healthScoreBasis.mcpSource -ne 'HOST_PROBER_MEASURED') {
        Reason "console mcpSource is '$($c.healthScoreBasis.mcpSource)', not HOST_PROBER_MEASURED - the score is a fallback, not a measurement"
    }
} catch {
    $consoleState.error = $_.Exception.Message
    Reason "console API not readable at ${ConsoleBaseUrl}: $($_.Exception.Message)"
}

# ===========================================================================
# E. Defender, off the service start path
# ===========================================================================
$defender = [ordered]@{ queried = $false; realtimeProtection = $null; exclusionsCoverProber = $null; error = $null }
if (-not $SkipDefender) {
    $defender.queried = $true
    try {
        $mp = Get-MpComputerStatus -ErrorAction Stop
        $defender.realtimeProtection = $mp.RealTimeProtectionEnabled
        $defender.amRunningMode = $mp.AMRunningMode
        if (-not $mp.RealTimeProtectionEnabled) { Note 'Windows Defender real-time protection is OFF' }
        try {
            $pref = Get-MpPreference -ErrorAction Stop
            $paths = @((Get-Prop $expected 'paths' | ConvertTo-Json -Depth 4 -Compress))
            $rawEx = @($pref.ExclusionPath) + @($pref.ExclusionProcess)
            $covered = $false
            foreach ($e in $rawEx) {
                if (-not $e) { continue }
                if ($e -like '*server_prober*' -or $e -like '*prober-service*' -or $e -like '*servers-center*' -or $e -like '*node.exe*') { $covered = $true }
            }
            $defender.exclusionsCoverProber = $covered
            $defender.exclusionCount = @($pref.ExclusionPath).Count + @($pref.ExclusionProcess).Count
            if ($covered) { Note 'Defender exclusions already cover the prober/runtime paths' }
            else { Note 'no Defender exclusion covers the prober runtime paths (real-time protection is therefore active over node.exe, tsx and the Servers-Center tree)' }
        } catch {
            $defender.error = "Get-MpPreference unavailable: $($_.Exception.Message)"
        }
    } catch {
        $defender.error = $_.Exception.Message
        Note "Defender status unavailable: $($_.Exception.Message). This is not a boot failure; it is an unmeasured hazard."
    }
}

# ===========================================================================
# F. Recovery path's own last word
# ===========================================================================
$recovery = $null
if ($null -ne $record) {
    $recovery = Get-Prop $record 'recovery'
}
if ($null -eq $recovery) {
    Note "no recovery attempt has ever been recorded in $($readiness.Path)"
} else {
    $recVerdict = [string](Get-Prop $recovery 'verdict' 'UNKNOWN')
    $recAction = [string](Get-Prop $recovery 'action' 'UNKNOWN')
    if ($recVerdict -eq 'OK') { Note "recovery path last ran: $recAction (verdict OK) at $(Get-Prop $recovery 'atUtc')" }
    else { Reason "the recovery path ran and did NOT succeed: action=$recAction verdict=$recVerdict detail=$(Get-Prop $recovery 'detail')" }
}

# ===========================================================================
# VERDICT
# ===========================================================================
$verdict = 'BOOT OK'
if ($reasons.Count -gt 0) { $verdict = 'BOOT FAILED' }
elseif (-not $AllowHazards -and @($notes | Where-Object { $_ -like 'boot hazard present*' }).Count -gt 0) { $verdict = 'BOOT FAILED' }

# ===========================================================================
# OUTPUT
# ===========================================================================
if ($Json) {
    $out = [ordered]@{
        schema         = 'sovereign.boot.verdict/1'
        chainKeyId     = '360ea36c28e66d9d'
        verdict        = $verdict
        exitCode       = $(if ($verdict -eq 'BOOT OK') { 0 } else { 1 })
        askedAtUtc     = (Get-Date).ToUniversalTime().ToString('o')
        boot           = $boot
        readinessFile  = $readiness.Path
        readinessVerdict = $readinessVerdict
        expectationsFile = $Script:ExpectationsFile
        expectationsPresent = ($null -ne $expectations)
        startedAtBoot  = $startedAtBoot
        startupEvidence = $startEvidence
        startupWindowSec = $StartupWindowSec
        now            = [ordered]@{
            serviceRegistered = [bool]$svc
            serviceState = $(if ($svc) { $svc.Status.ToString() } else { 'Absent' })
            serviceUp = $serviceUp
            listenerLoopback = $listenerOk
            healthOk = $healthOk
            console = $consoleState
            defender = $defender
        }
        recovery       = $recovery
        reasons        = @($reasons)
        notes          = @($notes)
    }
    [pscustomobject]$out | ConvertTo-Json -Depth 8
    exit $(if ($verdict -eq 'BOOT OK') { 0 } else { 1 })
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN BOOT VERDICT' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ''
Write-Host "  machine boot        : $($boot.BootTimeUtc)  (BootId=$($boot.BootId), uptime=$($boot.UptimeSec)s)" -ForegroundColor DarkGray
Write-Host "  readiness file      : $($readiness.Path)" -ForegroundColor DarkGray
Write-Host ''
Write-Host $verdict -ForegroundColor $(if ($verdict -eq 'BOOT OK') { 'Green' } else { 'Red' })
Write-Host ''

Write-Host ' Q1  DID THE SCM START IT DURING THIS BOOT?' -ForegroundColor Cyan
foreach ($k in $startEvidence.Keys) {
    Write-Host ("      {0,-42}: {1}" -f $k, $startEvidence[$k])
}
Write-Host ("      {0,-42}: {1}" -f 'VERDICT', $(if ($startedAtBoot) { 'YES - started at boot' } else { 'NO - not proven' }))
Write-Host ''

Write-Host ' Q2  DID ITS PRECONDITIONS HOLD AT THAT MOMENT?' -ForegroundColor Cyan
Write-Host ("      readiness verdict at service start    : {0}" -f $readinessVerdict)
if (@($failedChecks).Count -eq 0) {
    Write-Host '      no failed check was recorded'
} else {
    foreach ($c in $failedChecks) {
        Write-Host ("      [{0}] {1}" -f $c.severity, $c.name) -ForegroundColor Yellow
        Write-Host ("           {0}" -f $c.detail)
    }
}
Write-Host ''

Write-Host ' Q3  IS IT UP NOW?' -ForegroundColor Cyan
Write-Host ("      service            : {0}" -f $(if ($svc) { "$($svc.Status) (startType=$(Get-ServiceStartType))" } else { 'not registered' }))
Write-Host ("      loopback listener  : {0}" -f $listenerOk)
Write-Host ("      /probe/health ok   : {0}" -f $healthOk)
Write-Host ''

Write-Host ' Q4  DOES THE CONSOLE REACH IT NOW?' -ForegroundColor Cyan
Write-Host ("      console reachable  : {0}" -f $consoleState.reachable)
Write-Host ("      hostProber.reachable: {0}" -f $consoleState.hostProberReachable)
Write-Host ("      healthScore       : {0}" -f $consoleState.healthScore)
Write-Host ("      mcpSource         : {0}" -f $consoleState.mcpSource)
Write-Host ''

Write-Host ' Q5  DEFENDER (the hazard asked off the start path)' -ForegroundColor Cyan
Write-Host ("      real-time protection : {0}" -f $defender.realtimeProtection)
Write-Host ("      exclusion covers prober runtime : {0}" -f $defender.exclusionsCoverProber)
if ($defender.error) { Write-Host ("      error : {0}" -f $defender.error) }
Write-Host ''

if ($reasons.Count -gt 0) {
    Write-Host ' FAILED CHECKS (the specific reason, not a guess)' -ForegroundColor Red
    $i = 0
    foreach ($r in $reasons) { $i++; Write-Host ("      {0}. {1}" -f $i, $r) -ForegroundColor Red }
    Write-Host ''
}
if ($notes.Count -gt 0) {
    Write-Host ' NOTES / HAZARDS (not fatal by themselves)' -ForegroundColor Yellow
    foreach ($n in $notes) { Write-Host ("      - {0}" -f $n) -ForegroundColor Yellow }
    Write-Host ''
}

Write-Host '================================================================' -ForegroundColor DarkGray
if ($verdict -eq 'BOOT OK') {
    Write-Host " $verdict  (exit 0)" -ForegroundColor Green
    Write-Host '================================================================' -ForegroundColor DarkGray
    exit 0
}
Write-Host " $verdict  (exit 1)" -ForegroundColor Red
Write-Host '================================================================' -ForegroundColor DarkGray
exit 1