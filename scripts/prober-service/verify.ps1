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
function Check {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][bool]$Pass, [Parameter(Mandatory)][string]$Detail)
    if ($Pass) { Write-Host "    [PASS] $Name - $Detail" -ForegroundColor Green }
    else       { Write-Host "    [FAIL] $Name - $Detail" -ForegroundColor Red; $script:Failures++ }
    return $Pass
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

# --- optional destructive self-heal proof -----------------------------------
if ($SelfHealTest) {
    Write-Step 'SELF-HEAL TEST (destructive but bounded)'
    $procId = $cim.ProcessId
    Write-Info "NSSM service pid = $procId"
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$procId" -ErrorAction SilentlyContinue
    $victim = $children | Where-Object { $_.CommandLine -like '*host_prober.ts*' } | Select-Object -First 1
    if (-not $victim) {
        Check 'found prober child of nssm' $false "no child of pid $procId references host_prober.ts"
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
if ($script:Failures -eq 0) {
    Write-Host ' RESULT: ALL CHECKS PASSED' -ForegroundColor Green
    exit 0
} else {
    Write-Host " RESULT: FAIL - $script:Failures failed check(s)" -ForegroundColor Red
    exit 1
}