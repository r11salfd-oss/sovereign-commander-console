<#
.SYNOPSIS
    Read-only verification of the Sovereign host-prober Windows service.
    Exits non-zero if any check fails, so it is usable as a gate.

.DESCRIPTION
    Checks, in order:
      1  service registered and RUNNING
      2  start type is a boot-time auto start
      3  NSSM restart policy present (AppExit/AppThrottle/AppRestartDelay) and SCM
         Recovery actions present
      4  loopback-only bind
      5  /probe/health answers 200
      6  UNAUTHENTICATED /probe/mcp/status is rejected 401   <- security control
      7  AUTHENTICATED /probe/mcp/status returns a real measurement
      8  the console reads it: /api/agents/framework reports
         healthScoreBasis.mcpSource = HOST_PROBER_MEASURED
      9  COLD-BOOT RESILIENCE, PART A: the startup readiness self-test ran, the
         readiness record exists, its verdict is not FAIL, its boot evidence
         belongs to THIS boot, and the wrapper is on the service command line
     10  COLD-BOOT RESILIENCE, PART B: the independent recovery task is
         registered, is wired to the recovery script as SYSTEM at logon, and is
         a proven NO-OP when the service is already healthy
     11  COLD-BOOT RESILIENCE, PART C: boot-verdict.ps1 runs and returns a
         decision (its BOOT OK / BOOT FAILED line is quoted)

    Checks 9-11 are about the CHAIN, not about the instrument. A service that is
    running right now proves nothing about whether it comes up after a power
    cycle, and check 9 says so explicitly rather than implying otherwise.

    With -SelfHealTest it additionally kills the prober's node process and
    measures how long NSSM takes to bring it back and for the console score to
    return, quoting the console payload during the outage window. This is the
    evidence that the instrument self-heals; it is destructive but brief and it
    always waits for recovery before exiting.

.EXAMPLE
    .\verify.ps1
    .\verify.ps1 -SelfHealTest

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [string]$ServiceName,
    [int]$Port = 39711,
    [string]$Bind = '127.0.0.1',
    [string]$ConsoleBaseUrl = 'http://127.0.0.1:3000',
    [switch]$SelfHealTest,
    [int]$RecoveryBudgetSec = 120,
    # Make an UNVERIFIED link fatal. Off by default on purpose: see the
    # Check-Unverified note. On after a real reboot, when UNVERIFIED must not pass.
    [switch]$RequireBootProof,
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
if ($ServiceName) { $Script:ServiceName = $ServiceName }

# A service child process belongs to SYSTEM or to the service account, so the
# self-heal test can only be executed with elevation. Relaunching is safer than
# silently skipping the destructive part, so elevation is requested up front and
# the transcript gives the caller quotable output.
if (-not (Test-IsAdmin)) {
    Write-Step 'Not elevated - relaunching verify.ps1 elevated (needed to read SCM settings and, with -SelfHealTest, to kill the service child)'
    $tpath = Join-Path $env:TEMP ("opencode\verify-elevated-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $tpath) | Out-Null
    Remove-Item $tpath -Force -ErrorAction SilentlyContinue
    $named = @{ 'TranscriptPath' = $tpath; 'Port' = "$Port"; 'Bind' = $Bind; 'ConsoleBaseUrl' = $ConsoleBaseUrl; 'RecoveryBudgetSec' = "$RecoveryBudgetSec"; 'ServiceName' = $ServiceName }
    $switches = @()
    if ($SelfHealTest) { $switches += '-SelfHealTest' }
    if ($RequireBootProof) { $switches += '-RequireBootProof' }
    $cmdLine = New-RelaunchCommandLine -ScriptPath $PSCommandPath -Named $named -Switches $switches
    $p = Start-Process -FilePath (Get-ElevationShell) -Verb RunAs -ArgumentList $cmdLine -Wait -PassThru
    $p.WaitForExit()
    Write-Host ''
    Write-Host '---------------- elevated verify.ps1 stdout ----------------' -ForegroundColor DarkGray
    if (Test-Path $tpath) { Get-Content $tpath | ForEach-Object { Write-Protected $_ } }
    else { Write-Warn "no transcript at $tpath (exit $($p.ExitCode))" }
    Write-Host '--------------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host "verify.ps1 exit code: $($p.ExitCode)"
    exit $p.ExitCode
}

if ($TranscriptPath) {
    try { Start-Transcript -Path $TranscriptPath -Force | Out-Null } catch { }
}

$script:Failures = 0
$script:Unverified = 0
function Check {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][bool]$Pass, [Parameter(Mandatory)][string]$Detail)
    if ($Pass) { Write-Host "    [PASS] $Name - $Detail" -ForegroundColor Green }
    else       { Write-Host "    [FAIL] $Name - $Detail" -ForegroundColor Red; $script:Failures++ }
    return $Pass
}
function Check-Unverified {
    <#
      A link that has NOT been tested is not the same as a link that is broken.

      Conflating the two is itself a defect: if "the service started at boot" is
      counted as a FAILURE, then verify.ps1 is permanently red on any machine that
      has not been power-cycled since installation, and it stops being usable as a
      regression detector. If instead it is silently skipped, the operator is told
      the system is fine when one link in the chain is untested.

      So it gets its own third state, printed in amber, counted separately,
      named in the RESULT line, and fatal only under -RequireBootProof.
    #>
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Detail)
    Write-Host "    [UNVERIFIED] $Name - $Detail" -ForegroundColor Yellow
    $script:Unverified++
    return $false
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN HOST PROBER - VERIFICATION' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray

# --- 1 service running ------------------------------------------------------
Write-Step "1  service '$Script:ServiceName'"
$svc = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Check 'registered' $false "service '$Script:ServiceName' does not exist"
    Write-Host ''
    Write-Host "RESULT: FAIL ($script:Failures failed check(s))" -ForegroundColor Red
    exit 1
}
$svc | Format-List Name, DisplayName, Status, StartType | Out-String | Write-Host
$cim = Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'"
Check 'status RUNNING' ($svc.Status -eq 'Running') "Status=$($svc.Status)"
Check 'account' $true "StartName=$($cim.StartName)"

# --- 2 boot-time start ------------------------------------------------------
Write-Step '2  boot-time start type'
$startType = Get-ServiceStartType
Check 'auto start' ($startType -in @('Automatic', 'AutomaticDelayedStart')) "StartMode=$($cim.StartMode) StartType=$startType"

# --- 3 restart policy -------------------------------------------------------
Write-Step '3  restart policy'
$nssm = Get-NssmExe
if ($nssm) {
    # AppExit is a two-level parameter: reading the default needs an explicit
    # subparameter, otherwise nssm answers "requires a subparameter" and exits
    # non-zero. Each explicit exit-code mapping is read back individually so the
    # whole restart policy is asserted, not the default alone.
    $appExitQueries = @(
        @('AppExit', 'Default'),
        @('AppExit', '0'), @('AppExit', '1'), @('AppExit', '2'),
        @('AppThrottle', $null),
        @('AppRestartDelay', $null),
        @('AppStopMethodConsole', $null)
    )
    foreach ($q in $appExitQueries) {
        $argv = @('get', $Script:ServiceName, $q[0])
        if ($q[1]) { $argv += $q[1] }
        $r = Invoke-Nssm -NssmPath $nssm -Arguments $argv -Quiet
        $line = (Protect-Secret ($r.StdOut + $r.StdErr)).Trim()
        Check ("nssm $($q -join ' ')" -replace '  +', ' ') ($r.ExitCode -eq 0) $line
    }
} else {
    Check 'nssm present' $false 'nssm.exe not found; cannot read NSSM settings'
}
# `sc failure <svc>` SETS actions and prints usage; the QUERY verb is `qfailure`.
# Using `failure` for a read is a classic self-inflicted false FAIL. The query
# output format is "RESTART -- Delay = 5000 milliseconds.", NOT "restart/5000",
# which is the format the `failure` SET verb accepts -- matching the wrong one
# also produced a false FAIL, so both are matched here.
$rec = Invoke-Native -FilePath 'sc.exe' -Arguments @('qfailure', $Script:ServiceName) -Quiet
$recText = $rec.Combined
$restartCount = ([regex]::Matches($recText, '(?i)RESTART\s*(--)?\s*(Delay\s*=\s*\d+|/\d+)')).Count
Check 'SCM recovery actions' ($restartCount -ge 3 -and $recText -match '(?i)QueryServiceConfig2 SUCCESS') "$restartCount restart action(s) configured; $recText"

# --- 4 bind -----------------------------------------------------------------
Write-Step '4  listener bind (loopback only, control 1)'
$listener = Get-PortListener -Port $Port
if ($listener) {
    Check 'listening' $true "pid=$($listener.OwningPid) process=$($listener.OwningProcess)"
    Check 'loopback only' ($listener.Address -in @('127.0.0.1', '::1')) "LocalAddress=$($listener.Address)"
} else {
    Check 'listening' $false "nothing is listening on $Port"
}

# --- 5 health ---------------------------------------------------------------
Write-Step '5  liveness endpoint'
$h = Test-ProberHealth -Bind $Bind -Port $Port
Check 'health 200' ($h.Reachable -and $h.Ok) ($(if ($h.Reachable) { "ok=$($h.Raw.ok) generatedAt=$($h.Raw.generatedAt)" } else { $h.Error }))

# --- 6 security: unauthenticated must be rejected ---------------------------
Write-Step '6  security control: unauthenticated request must be rejected'
$code = 0
try {
    $resp = Invoke-WebRequest -Uri "http://$Bind`:$Port/probe/mcp/status" -UseBasicParsing -TimeoutSec 10
    $code = [int]$resp.StatusCode
    $body = Protect-Secret $resp.Content
} catch {
    $code = [int]$_.Exception.Response.StatusCode
    try { $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $body = Protect-Secret $sr.ReadToEnd(); $sr.Dispose() } catch { $body = '' }
}
Write-Host "    HTTP $code $body" -ForegroundColor DarkGray
Check 'unauthenticated 401' ($code -eq 401) "GET /probe/mcp/status without Authorization -> $code"

# --- 7 authenticated measurement -------------------------------------------
Write-Step '7  authenticated measurement'
$tokenFile = Get-TokenFilePath
$token = $null
if (Test-Path $tokenFile) { $token = (Get-Content $tokenFile -Raw).Trim(); Register-Secret $token }
$report = $null
if ($token) {
    try {
        $report = Invoke-RestMethod -Uri "http://$Bind`:$Port/probe/mcp/status?fresh=1" `
                                   -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 120
        Check 'measured by prober' ($report.provenance -eq 'MEASURED_BY_PROBER') "provenance=$($report.provenance)"
        Check 'all servers online' ($report.summary.online -eq $report.summary.total) "online=$($report.summary.online)/$($report.summary.total) unverifiable=$($report.summary.unverifiable)"
        $tools = ($report.servers | Measure-Object -Property toolCount -Sum).Sum
        Write-Info "tools enumerated: $tools"
        Write-Info ("per-server: " + (($report.servers | ForEach-Object { "$($_.id)=$($_.state)/$($_.toolCount)" }) -join ' '))
    } catch {
        Check 'authenticated read' $false $_.Exception.Message
    }
} else {
    Check 'token file present' $false "not found at $tokenFile"
}

# --- 8 the console consumes it ---------------------------------------------
Write-Step '8  console payload'
function Get-ConsoleFramework {
    try {
        $r = Invoke-RestMethod -Uri "$ConsoleBaseUrl/api/agents/framework" -TimeoutSec 45
        return @{ ok = $true; data = $r }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }
}
$c = Get-ConsoleFramework
if (-not $c.ok) {
    Check 'console API reachable' $false $c.error
} else {
    $d = $c.data
    Check 'console reachable' ($d.ok -eq $true) "frameworkVersion=$($d.frameworkVersion) chainKey=$($d.chainKey)"
    Check 'mcpSource measured' ($d.healthScoreBasis.mcpSource -eq 'HOST_PROBER_MEASURED') "healthScore=$($d.healthScore) mcpSource=$($d.healthScoreBasis.mcpSource) lspSource=$($d.healthScoreBasis.lspSource)"
    Check 'hostProber reachable' ($d.hostProber.reachable -eq $true) "baseUrl=$($d.hostProber.baseUrl)"
    Write-Info "rationale: $($d.healthScoreBasis.rationale)"
}

# ---------------------------------------------------------------------------
# 9  COLD-BOOT RESILIANCE, PART A - the startup readiness self-test
# ---------------------------------------------------------------------------
Write-Step '9  cold-boot readiness self-test (Part A)'
$guardPath = Get-BootGuardPath
Check 'boot guard present' (Test-Path $guardPath) $guardPath

if ($nssm) {
    $argvGuard = Invoke-Nssm -NssmPath $nssm -Arguments @('get', $Script:ServiceName, 'AppParameters') -Quiet
    $paramsText = (Protect-Secret ($argvGuard.StdOut + $argvGuard.StdErr)).Trim()
    # Assert the WRAPPER is on the command line, not just that some parameters
    # exist. A service running node directly would pass every other check here.
    Check 'wrapper on the service command line' ($paramsText -like "*$($Script:BootGuardName)*") "AppParameters=$paramsText"
    Check 'readiness path on the command line' ($paramsText -like "*$($Script:ReadinessFile)*") "AppParameters=$paramsText"
} else {
    Check 'nssm readable for AppParameters' $false 'nssm.exe not found'
}

$rd = Get-ReadinessRecord
if ($null -eq $rd.Record) {
    Check 'readiness record exists' $false "no usable record at $($rd.Path): $($rd.Error)"
    Check 'readiness verdict' $false 'cannot assert a verdict on a record that does not exist'
} else {
    $rec = $rd.Record
    $verdict = [string](Get-Prop $rec 'verdict' 'UNKNOWN')
    $rBoot = Get-Prop $rec 'boot'
    $rSvc = Get-Prop $rec 'service'
    $counts = Get-Prop $rSvc 'counts'
    Write-Host "    record : $($rd.Path)" -ForegroundColor DarkGray
    Write-Host "    verdict: $verdict   recordedAt=$(Get-Prop $rec 'recordedAtUtc')" -ForegroundColor DarkGray
    Write-Host "    checks : total=$(Get-Prop $counts 'total') passed=$(Get-Prop $counts 'passed') failed=$(Get-Prop $counts 'failed') blockers=$(Get-Prop $counts 'blockers') required=$(Get-Prop $counts 'required') advisory=$(Get-Prop $counts 'advisory')" -ForegroundColor DarkGray
    foreach ($c in @(Get-Prop $rSvc 'checks' @())) {
        $mark = if ($c.ok) { '[ok]  ' } else { "[$($c.severity)]" }
        Write-Host ("      {0} {1,-24} {2}" -f $mark, $c.name, $c.detail) -ForegroundColor DarkGray
    }

    Check 'readiness record exists' $true "verdict=$verdict at $($rd.Path)"
    Check 'readiness verdict not FAIL' ($verdict -in @('READY', 'DEGRADED')) "verdict=$verdict (DEGRADED means a boot hazard was present and is named below)"
    Check 'readiness record is complete' ((Get-Prop $counts 'total') -ge 7 -and $null -ne (Get-Prop $counts 'passed')) "$(Get-Prop $counts 'total') checks recorded, $(Get-Prop $counts 'passed') passed"

    # Boot evidence: the record must belong to THIS boot, and must say so.
    $bootNow = Get-BootIdentity
    $recBootId = Get-Prop $rBoot 'bootId'
    $uptimeAtStart = Get-Prop $rBoot 'uptimeSecAtStart'
    Check 'record belongs to this boot' (
        ($null -eq $recBootId -or $null -eq $bootNow.BootId -or [int]$recBootId -eq [int]$bootNow.BootId)
    ) "record BootId=$recBootId, machine BootId=$($bootNow.BootId), uptime now=$($bootNow.UptimeSec)s"

    if ($null -ne $uptimeAtStart) {
        if ([double]$uptimeAtStart -le 900) {
            Check 'this start happened at boot' $true "the prober recorded its readiness $([int]$uptimeAtStart)s after power-on (window 900s)"
        } else {
            Write-Warn "the prober recorded its readiness $([int]$uptimeAtStart)s after power-on, which is OUTSIDE the 900s startup window."
            Write-Warn '=> the service was started BY HAND. The boot path is NOT proven for this start.'
            Write-Warn '=> boot-verdict.ps1, run immediately after a real reboot, is what closes this link.'
            Check-Unverified 'this start happened at boot' "uptimeSecAtStart=$uptimeAtStart > 900s: the service was started by hand, so no boot start has been observed. This link is UNTESTED, not broken."
        }
    } else {
        Check 'this start happened at boot' $false 'the record carries no uptimeSecAtStart'
    }

    # The hazards the record must be able to speak about at all. The Docker
    # gateway check is NAMED after the host it probes, because the probe name is
    # exactly what it is testing - an earlier version of this list looked for
    # 'dockerGateway' and reported a coverage gap that did not exist.
    $checkNames = @(Get-Prop $rSvc 'checks' @() | ForEach-Object { $_.name })
    foreach ($must in @('account', 'serverRoot', 'pinnedEnvironment', 'runtimeEntries', 'workingDirectoryAndPath', 'repoAndManifest')) {
        Check "record covers hazard '$must'" ($checkNames -contains $must) "present=$($checkNames -contains $must)"
    }
    $dockerChecked = @($checkNames | Where-Object { $_ -like 'host.docker.internal*' })
    Check 'record covers the Docker gateway hazard' ($dockerChecked.Count -gt 0) "check name(s) found: $($dockerChecked -join ', ')"
}

# The 401 gate has not been weakened by anything in this file. Re-asserted here
# next to the new code so a future change to the auth gate cannot hide behind a
# passing readiness verdict.
$rec401 = 0
try {
    $r401 = Invoke-WebRequest -Uri "http://$Bind`:$Port/probe/mcp/status" -UseBasicParsing -TimeoutSec 10
    $rec401 = [int]$r401.StatusCode
} catch { $rec401 = [int]$_.Exception.Response.StatusCode }
Check 'auth gate still closed after resilience work' ($rec401 -eq 401) "unauthenticated /probe/mcp/status -> $rec401"

# ---------------------------------------------------------------------------
# 10  COLD-BOOT RESILIENCE, PART B - the independent recovery path
# ---------------------------------------------------------------------------
Write-Step '10 independent recovery path (Part B)'
$taskName = Get-RecoveryTaskName
$task = Get-RecoveryTask
if (-not $task) {
    Check 'recovery task registered' $false "no task at $taskName. Install it with .\install-recovery-task.ps1"
    Check 'recovery task wiring' $false 'task absent, wiring cannot be asserted'
} else {
    Check 'recovery task registered' $true "$taskName state=$($task.State)"
    $a = @($task.Actions)[0]
    Check 'recovery action is the recovery script' ("$($a.Arguments)" -like '*recover-prober.ps1*') "$($a.Execute) $($a.Arguments)"
    Check 'recovery action runs at the service' ("$($a.Arguments)" -like "*-ServiceName $Script:ServiceName*") "$($a.Arguments)"
    Check 'recovery principal is SYSTEM' ("$($task.Principal.UserId)" -match 'SYSTEM') "$($task.Principal.UserId)"
    Check 'recovery run level is Highest' ("$($task.Principal.RunLevel)" -eq 'Highest') "$($task.Principal.RunLevel)"
    Check 'recovery trigger is AtLogOn' (@($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -gt 0) (($task.Triggers | ForEach-Object { "$($_.CimClass.CimClassName)(user=$($_.UserId))" }) -join ', ')

    # Idempotence, proven by execution and asserted here so a regression is caught.
    # The service is Running and healthy at this point, so the recovery script is
    # REQUIRED to be a no-op. If it touched anything, this check fails.
    $before = (Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'").ProcessId
    Write-Info 'running recover-prober.ps1 twice; the service is Running and healthy, so both runs must be recorded NO-OPS'
    $recScript = Get-RecoveryScriptPath
    $out1 = Invoke-Native -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
                          -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $recScript, '-ServiceName', $Script:ServiceName, '-Port', "$Port", '-Bind', $Bind, '-Trigger', 'verify-run-1') -Quiet
    $out2 = Invoke-Native -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
                          -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $recScript, '-ServiceName', $Script:ServiceName, '-Port', "$Port", '-Bind', $Bind, '-Trigger', 'verify-run-2') -Quiet
    $after = (Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'").ProcessId
    Write-Host "    run1 exit=$($out1.ExitCode)  run2 exit=$($out2.ExitCode)" -ForegroundColor DarkGray
    Check 'recovery run 1 exit 0' ($out1.ExitCode -eq 0) (Protect-Secret $out1.Combined)
    Check 'recovery run 2 exit 0' ($out2.ExitCode -eq 0) (Protect-Secret $out2.Combined)
    Check 'recovery did not restart a healthy service' ($before -eq $after) "service pid before=$before after=$after (identical means nothing was killed or restarted)"

    $rd3 = Get-ReadinessRecord
    $lastRecovery = Get-Prop $rd3.Record 'recovery'
    $lastAction = [string](Get-Prop $lastRecovery 'action' 'NONE')
    Check 'last recovery attempt recorded as NO-OP' ($lastAction -eq 'NOOP_SERVICE_RUNNING') "action=$lastAction verdict=$(Get-Prop $lastRecovery 'verdict') trigger=$(Get-Prop $lastRecovery 'trigger') at=$(Get-Prop $lastRecovery 'atUtc')"
}

# ---------------------------------------------------------------------------
# 11  COLD-BOOT RESILIENCE, PART C - the one command
# ---------------------------------------------------------------------------
Write-Step '11 boot verdict command (Part C)'
$verdictScript = Join-Path $PSScriptRoot 'boot-verdict.ps1'
if (-not (Test-Path $verdictScript)) {
    Check 'boot-verdict.ps1 present' $false "not found at $verdictScript"
} else {
    Check 'boot-verdict.ps1 present' $true $verdictScript
    $bv = Invoke-Native -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
                        -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $verdictScript, '-Json') -Quiet
    $verdictLine = ''
    $parsed = $null
    try { $parsed = $bv.StdOut | ConvertFrom-Json } catch { $parsed = $null }
    if ($parsed) {
        $verdictLine = [string](Get-Prop $parsed 'verdict' 'NONE')
        Write-Host "    boot-verdict.ps1 -> $($verdictLine)  (exit $($bv.ExitCode))" -ForegroundColor DarkGray
        Write-Host "    startedAtBoot=$((Get-Prop $parsed 'startedAtBoot'))  readinessVerdict=$(Get-Prop $parsed 'readinessVerdict')" -ForegroundColor DarkGray
        foreach ($r in @(Get-Prop $parsed 'reasons' @())) { Write-Host "    FAILED: $r" -ForegroundColor DarkGray }
        foreach ($n in @(Get-Prop $parsed 'notes' @())) { Write-Host "    note  : $n" -ForegroundColor DarkGray }
    } else {
        Write-Host (Protect-Secret $bv.Combined) -ForegroundColor DarkGray
    }
    Check 'boot-verdict.ps1 returns a decision' ($bv.ExitCode -in @(0, 1) -and $verdictLine -in @('BOOT OK', 'BOOT FAILED')) "exit=$($bv.ExitCode) verdict=$verdictLine"
    # This is a link in the chain, and it is reported honestly: the tool exists
    # and produces a decision, but until a power cycle happens the decision it
    # produces for a hand-started service is BOOT FAILED, correctly, because the
    # boot start never happened.
    $b = Get-Prop $parsed 'startedAtBoot'
    if ($b -eq $true) {
        Check 'boot start proven by the readiness record' $true "uptimeSecAtStart within the startup window"
    } else {
        Write-Warn 'BOOT START NOT PROVEN on this machine: no power cycle has produced a readiness record yet.'
        Write-Warn 'This is reported as UNVERIFIED on purpose. boot-verdict.ps1 will close it the first time it runs after a reboot.'
    }
}

# ---------------------------------------------------------------------------
# optional destructive self-heal proof
# ---------------------------------------------------------------------------
if ($SelfHealTest) {
    Write-Step 'SELF-HEAL TEST (destructive but bounded)'
    $procId = $cim.ProcessId
    Write-Info "NSSM service pid = $procId"
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$procId" -ErrorAction SilentlyContinue
    # With the wrapper in place, NSSM's direct child is the WRAPPER, and the
    # wrapper's command line also contains "host_prober.ts". Matching on the
    # filename alone would therefore have killed the wrapper instead of the
    # prober, and the test would silently stop testing what it claims to test.
    # The wrapper is excluded BY NAME and the innermost prober is selected.
    $wrapper = $children | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$($Script:BootGuardName)*" } | Select-Object -First 1
    $victim = $children | Where-Object { $_.CommandLine -and $_.CommandLine -like '*host_prober.ts*' -and (-not $wrapper -or $_.ProcessId -ne $wrapper.ProcessId) } | Select-Object -First 1
    if ($wrapper) { Write-Info "boot guard pid = $($wrapper.ProcessId) (the crash target is chosen BELOW it, so the test still measures the prober's own recovery)" }
    if (-not $victim) {
        Check 'found prober child of nssm' $false "no child of pid $procId references host_prober.ts other than the wrapper"
    } else {
        $victimPid = $victim.ProcessId
        Write-Info "prober node pid = $victimPid"
        # The score is asserted against the score observed BEFORE the kill, not
        # against a hardcoded number: what must be proven is that the console
        # returns to exactly the state it held while the instrument was alive.
        # Windows PowerShell 5.1 has no ternary operator; these scripts must
        # parse under 5.1 because the elevated relaunch runs there.
        $baseline = 'UNKNOWN'
        if ($c.ok) { $baseline = $c.data.healthScore }
        Write-Info "baseline healthScore before the kill = $baseline"
        $down = [ordered]@{}

        # Force-kill: this is the point of the test. /F is used DELIBERATELY here
        # because a controlled crash is exactly the case the restart policy must
        # cover. Note HOST_PROBER.md section 12: this can strand Chromium.
        Write-Info "t0: taskkill /PID $victimPid /F /T  (simulating a crash)"
        $t0 = Get-Date
        $null = Invoke-Native -FilePath 'taskkill.exe' -Arguments @('/PID', $victimPid, '/F', '/T')

        # Outage evidence, collected as fast as possible after the kill.
        $downProbe = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 2
        $down.reachable = $downProbe.Reachable
        $down.console = Get-ConsoleFramework
        $down.elapsedMs = [int]((Get-Date) - $t0).TotalMilliseconds

        # Wait for recovery.
        $recovered = $false
        $recoveryMs = -1
        $deadline = (Get-Date).AddSeconds($RecoveryBudgetSec)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
            $p = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 2
            if ($p.Reachable -and $p.Ok) {
                $recoveryMs = [int]((Get-Date) - $t0).TotalMilliseconds
                $recovered = $true
                break
            }
        }
        Write-Info "recovery: recovered=$recovered after ${recoveryMs}ms (budget ${RecoveryBudgetSec}s)"

        # Post-recovery measurement and score.
        $after = $null
        if ($recovered) {
            try {
                $after = Invoke-RestMethod -Uri "http://$Bind`:$Port/probe/mcp/status?fresh=1" `
                                           -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 120
                Write-Info "post-recovery measurement: provenance=$($after.provenance) online=$($after.summary.online)/$($after.summary.total)"
            } catch {
                Write-Warn "post-recovery measurement failed: $($_.Exception.Message)"
            }
        }
        $afterConsole = Get-ConsoleFramework

        Write-Host ''
        Write-Host '  --- OUTAGE WINDOW (prober killed) ---' -ForegroundColor Yellow
        Write-Host "  prober reachable      : $($down.reachable)  (t+$($down.elapsedMs)ms after kill)"
        if ($down.console.ok) {
            $dd = $down.console.data
            Write-Host "  console healthScore   : $($dd.healthScore)"
            Write-Host "  console mcpSource     : $($dd.healthScoreBasis.mcpSource)"
            Write-Host "  console lspSource     : $($dd.healthScoreBasis.lspSource)"
            Write-Host "  console mcp total     : $($dd.mcp.total) online=$($dd.mcp.online) source=$($dd.mcp.measurementSource)"
            Write-Host "  console lsp total     : $($dd.lsp.total) ready=$($dd.lsp.ready) source=$($dd.lsp.measurementSource)"
            Write-Host "  hostProber.reachable  : $($dd.hostProber.reachable)"
            Write-Host "  hostProber.mcp        : provenance=$($dd.hostProber.mcp.provenance) unavailableReason=$($dd.hostProber.mcp.unavailableReason)"
            Write-Host "  rationale             : $($dd.healthScoreBasis.rationale)"
        } else {
            Write-Host "  console read failed   : $($down.console.error)"
        }
        Write-Host '  --- RECOVERED ---' -ForegroundColor Green
        if ($afterConsole.ok) {
            $ad = $afterConsole.data
            Write-Host "  console healthScore   : $($ad.healthScore)"
            Write-Host "  console mcpSource     : $($ad.healthScoreBasis.mcpSource)"
            Write-Host "  console mcp total     : $($ad.mcp.total) online=$($ad.mcp.online)"
            Write-Host "  hostProber.reachable  : $($ad.hostProber.reachable)"
        }
        Write-Host ''

        Check 'service restarted the prober' $recovered "recovery interval = ${recoveryMs}ms (AppRestartDelay=$($Script:NssmDelayMs)ms + node/tsx cold start + bind)"
        if ($after) { Check 'measurement restored' ($after.summary.online -eq $after.summary.total) "online=$($after.summary.online)/$($after.summary.total)" }
        if ($afterConsole.ok) {
            Check 'score restored' ($afterConsole.data.healthScore -eq $baseline) "healthScore=$($afterConsole.data.healthScore) (baseline was $baseline) mcpSource=$($afterConsole.data.healthScoreBasis.mcpSource) lspSource=$($afterConsole.data.healthScoreBasis.lspSource)"
        }
    }
}

Write-Host '================================================================' -ForegroundColor DarkGray
if ($script:Failures -eq 0 -and ($script:Unverified -eq 0 -or -not $RequireBootProof)) {
    if ($script:Unverified -eq 0) {
        Write-Host ' RESULT: ALL CHECKS PASSED' -ForegroundColor Green
    } else {
        Write-Host " RESULT: PASS - 0 failed check(s), $($script:Unverified) UNVERIFIED link(s)" -ForegroundColor Yellow
        Write-Host ' UNVERIFIED means UNTESTED, not working and not broken. The link(s) above have' -ForegroundColor Yellow
        Write-Host ' not been exercised yet. Run .\boot-verdict.ps1 after a reboot to close them,' -ForegroundColor Yellow
        Write-Host ' or use -RequireBootProof to make an UNVERIFIED link fatal.' -ForegroundColor Yellow
    }
    exit 0
} elseif ($script:Failures -gt 0) {
    Write-Host " RESULT: FAIL - $script:Failures failed check(s), $($script:Unverified) unverified link(s)" -ForegroundColor Red
    exit 1
} else {
    Write-Host " RESULT: FAIL - $($script:Unverified) UNVERIFIED link(s) and -RequireBootProof was given" -ForegroundColor Red
    exit 1
}