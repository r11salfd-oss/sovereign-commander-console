<#
.SYNOPSIS
    Installs scripts/host_prober.ts as a permanent, self-healing Windows service
    using NSSM.

.DESCRIPTION
    Replaces the operational defect where the prober is a transient process that
    somebody has to remember to start. After this script the prober is:

      * started by the Service Control Manager at boot (no user logon required),
      * restarted by NSSM when it exits with a "restart" exit code,
      * restarted by the SCM Recovery policy when NSSM itself dies, and
      * reversible with uninstall.ps1.

    Design rules, and why each one exists:

      1. ABSOLUTE PATHS ONLY. The service command line is
         "<abs node.exe>" "<abs node_modules\tsx\dist\cli.mjs>" "<abs
         scripts\host_prober.ts>". Nothing is resolved through PATH. A service
         whose PATH comes from an interactive shell's environment is exactly the
         failure this task exists to prevent, because session 0 has no
         interactive shell and no user environment.

      2. DETERMINISTIC ENVIRONMENT. The service's environment is pinned via
         NSSM AppEnvironmentExtra: PATH is rebuilt from the MACHINE + USER PATH
         in the registry (not from whatever the installing shell happened to
         have), and every HOST_PROBER_* the prober needs is written explicitly.

      3. THE TOKEN IS READ, NEVER TYPED. It is read from the token file at
         install time and handed straight to nssm. It is never echoed, never
         written to a repo file, and never printed. Only its length is reported.
         `nssm get <svc> AppEnvironmentExtra` is NEVER called, because that
         command prints the value.

      4. FAIL CLOSED. Missing tsx, missing node, a short token, or an nssm
         whose SHA-1 does not match the value published by nssm.cc all abort
         the install rather than producing a service that starts and lies.

.PARAMETER AdoptExistingProber
    Required if something that is not this service already holds the port.
    The occupant is stopped GRACEFULLY (no taskkill /F - see HOST_PROBER.md
    section 12: a forced kill strands Chromium grandchildren).

.PARAMETER RunAs
    CurrentUser | LocalSystem | Auto (default Auto).
    Auto tries the interactive user first and falls back to LocalSystem if the
    SCM cannot log the service on without a stored password.

.EXAMPLE
    .\install.ps1 -AdoptExistingProber

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [string]$ServiceName,
    [string]$NodeExe,
    [string]$ServerRoot = 'E:\Servers-Center',
    [string]$HostAllowlist = 'host.docker.internal',
    [int]$Port = 39711,
    [string]$Bind = '127.0.0.1',
    [string]$TokenFile,
    [string]$RunAs = 'Auto',
    [string]$NssmPath,
    # Profile whose Python user-site / Chromium profile the instrument measures.
    # Defaults to the installing user's profile. See the note below: this is not
    # cosmetic, it changes the measured result.
    [string]$MeasuredProfile = $env:USERPROFILE,
    [switch]$NoProfileMapping,
    [switch]$AdoptExistingProber,
    [switch]$AllowForcedKill,
    [switch]$NoStart,
    # Internal: the elevated child receives this so its output can be quoted by
    # the non-elevated caller. An elevated window's stdout is otherwise
    # unattributable, and this task requires quoting real stdout.
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# ---------------------------------------------------------------------------
# Self-elevation
# ---------------------------------------------------------------------------
if (-not (Test-IsAdmin)) {
    Write-Step 'Not elevated - relaunching this script elevated (UAC)'
    $tpath = Join-Path $env:TEMP ("opencode\install-elevated-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $tpath) | Out-Null
    Remove-Item $tpath -Force -ErrorAction SilentlyContinue
    $named = [ordered]@{
        'TranscriptPath'  = $tpath
        'ServerRoot'      = $ServerRoot
        'HostAllowlist'   = $HostAllowlist
        'Port'            = "$Port"
        'Bind'            = $Bind
        'RunAs'           = $RunAs
        'TokenFile'       = $TokenFile
        'NssmPath'        = $NssmPath
        'NodeExe'         = $NodeExe
        'ServiceName'     = $ServiceName
        'MeasuredProfile' = $MeasuredProfile
    }
    $switches = @()
    if ($AdoptExistingProber) { $switches += '-AdoptExistingProber' }
    if ($AllowForcedKill)     { $switches += '-AllowForcedKill' }
    if ($NoStart)             { $switches += '-NoStart' }
    if ($NoProfileMapping)     { $switches += '-NoProfileMapping' }

    $cmdLine = New-RelaunchCommandLine -ScriptPath $PSCommandPath -Named $named -Switches $switches
    Write-Info "elevated command line: $cmdLine"

    $p = Start-Process -FilePath (Get-ElevationShell) `
                       -Verb RunAs -ArgumentList $cmdLine -Wait -PassThru
    Write-Host "    elevated shell pid=$($p.Id); waiting for it to finish"
    $p.WaitForExit()
    Write-Host ''
    Write-Host '---------------- elevated install.ps1 stdout ----------------' -ForegroundColor DarkGray
    if (Test-Path $tpath) {
        Get-Content $tpath | ForEach-Object { Write-Protected $_ }
    } else {
        Write-Warn "no transcript at $tpath - the elevated run produced no capturable output (exit $($p.ExitCode))"
    }
    Write-Host '-------------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host "    elevated install.ps1 exited with code $($p.ExitCode)"
    exit $p.ExitCode
}

if ($TranscriptPath) {
    try { Start-Transcript -Path $TranscriptPath -Force | Out-Null } catch { }
}

if ($ServiceName) { $Script:ServiceName = $ServiceName }

$summary = [ordered]@{}

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN HOST PROBER - SERVICE INSTALL' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# 1. Resolve the runtime - absolutely, never through PATH
# ---------------------------------------------------------------------------
Write-Step '1/8 Resolving an absolute Node runtime and tsx entry point'

if (-not $NodeExe) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { $NodeExe = $cmd.Source }
}
if (-not $NodeExe) {
    $reg = (Get-ItemProperty 'HKLM:\SOFTWARE\Node.js' -ErrorAction SilentlyContinue).InstallPath
    if ($reg -and (Test-Path (Join-Path $reg 'node.exe'))) { $NodeExe = Join-Path $reg 'node.exe' }
}
if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
    throw "No usable node.exe found. Pass -NodeExe '<abs path to node.exe>'. The service command line must never depend on PATH."
}
$NodeExe = (Resolve-Path $NodeExe).Path
Write-Ok "node.exe  : $NodeExe ($(& $NodeExe --version))"

$tsxCli = Get-TsxCliPath
if (-not (Test-Path $tsxCli)) {
    throw "tsx is not installed at $tsxCli. Run 'npm ci' (or 'npm install') in the repository first. Refusing to install a service that would fail at boot."
}
Write-Ok "tsx cli   : $tsxCli"

$prober = Get-ProberScriptPath
if (-not (Test-Path $prober)) { throw "prober script not found at $prober" }
$prober = (Resolve-Path $prober).Path
Write-Ok "prober    : $prober"

$repoRoot = Get-RepoRoot
Write-Ok "repo root : $repoRoot"

if ($Bind -ne $Script:DefaultBind) {
    throw "Bind '$Bind' refused. HOST_PROBER.md section 9 control 1: the prober enforces loopback-only and so does this installer."
}

# ---------------------------------------------------------------------------
# 2. Resolve NSSM (download + integrity check if absent)
# ---------------------------------------------------------------------------
Write-Step '2/8 Resolving NSSM'
if (-not $NssmPath) { $NssmPath = Get-NssmExe -InstallIfMissing }
if (-not $NssmPath -or -not (Test-Path $NssmPath)) { throw 'nssm.exe could not be resolved or installed' }
$NssmPath = (Resolve-Path $NssmPath).Path
Write-Ok "nssm.exe  : $NssmPath"

if ($NssmPath -like "$repoRoot*") {
    throw "nssm.exe resolved inside the git repository ($NssmPath). It must live outside the repo so it cannot be committed accidentally."
}

# ---------------------------------------------------------------------------
# 3. Read the token - length only is ever reported
# ---------------------------------------------------------------------------
Write-Step '3/8 Resolving the bearer token'
if (-not $TokenFile) { $TokenFile = Get-TokenFilePath }
if (-not (Test-Path $TokenFile)) {
    throw "Token file not found at $TokenFile. See HOST_PROBER.md section 3. Refusing to install a service without a token: the prober fails closed without one, and an unauthenticated prober is not an option."
}
$token = (Get-Content $TokenFile -Raw).Trim()
if ($token.Length -lt 32) {
    throw "Token at $TokenFile is $($token.Length) characters; the prober requires >= 32. Refusing to install."
}
Register-Secret $token
Write-Ok "token file : $TokenFile"
Write-Ok "token      : RESOLVED, length=$($token.Length) chars, value never printed"

# ---------------------------------------------------------------------------
# 4. Build a deterministic environment for session 0
# ---------------------------------------------------------------------------
Write-Step '4/8 Building the service environment (no dependence on an interactive shell)'

$machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
$userPath    = [Environment]::GetEnvironmentVariable('PATH', 'User')
$pathParts = @()
foreach ($chunk in @($machinePath, $userPath)) {
    if (-not $chunk) { continue }
    foreach ($dir in ($chunk -split ';')) {
        $d = $dir.Trim().TrimEnd('\')
        if ($d -and -not ($pathParts -contains $d)) { $pathParts += $d }
    }
}
if (-not ($pathParts -contains (Split-Path $NodeExe -Parent))) {
    $pathParts += (Split-Path $NodeExe -Parent)
}
$servicePath = $pathParts -join ';'
Write-Ok "service PATH: $($pathParts.Count) entries, rebuilt from HKLM+HKCU registry values"
foreach ($must in @((Split-Path $NodeExe -Parent), (Split-Path $ServerRoot -Parent))) {
    if (-not ($pathParts -contains $must.TrimEnd('\'))) {
        Write-Warn "PATH entry '$must' is missing; it was not present in the machine or user PATH"
    }
}

$envPairs = [ordered]@{
    # Deterministic PATH first: this is the fix for "tsx on PATH for a
    # non-interactive service". Nothing downstream consults an interactive
    # shell's PATH any more.
    'PATH'                     = $servicePath
    'HOST_PROBER_TOKEN'        = $token
    'HOST_PROBER_ALLOWED_HOSTS'= $HostAllowlist
    'HOST_PROBER_ROOT'         = $ServerRoot
    'HOST_PROBER_PORT'         = "$Port"
    'HOST_PROBER_BIND'         = $Bind
    # Pin the repo root so the manifest at config/servers_center_manifest.json is
    # found by absolute path instead of by walking up from cwd.
    'HOST_PROBER_REPO_ROOT'    = $repoRoot
    'NODE_OPTIONS'             = ''
}

# ---------------------------------------------------------------------------
# Measurement identity
# ---------------------------------------------------------------------------
# MEASURED, and the single most important finding of this work: a service running
# as LocalSystem does NOT measure the same machine the operator sees.
#
# config/servers_center_manifest.json declares, for pyright:
#     command.env.passThrough = ["APPDATA"]
# with the note that the `pyright` package lives in the PER-USER site-packages
# at C:\Users\<user>\AppData\Roaming\Python\Python314\site-packages, and that
# "a child process started without APPDATA therefore cannot import the package
# at all" -> exit 1, ModuleNotFoundError: No module named 'pyright'.
#
# A LocalSystem service has APPDATA = C:\Windows\System32\config\systemprofile\
# AppData\Roaming, where no pyright is installed. Measured consequence: pyright
# flipped ONLINE -> OFFLINE / EXIT_NONZERO_BEFORE_HANDSHAKE and the console
# health score fell 70/100 -> 60/100, while hostProber.reachable stayed true and
# mcpSource stayed HOST_PROBER_MEASURED. That is the exact shape of the honesty
# defect this task exists to remove: a number that looks like a service
# regression but is really a change of instrument.
#
# The fix is to make the identity EXPLICIT rather than incidental: the profile
# the instrument is supposed to measure is pinned in the service environment.
# These are paths, not secrets.
if (-not $NoProfileMapping -and $MeasuredProfile) {
    if (-not (Test-Path $MeasuredProfile)) { throw "MeasuredProfile '$MeasuredProfile' does not exist." }
    $prof = (Resolve-Path $MeasuredProfile).Path.TrimEnd('\')
    $envPairs['USERPROFILE'] = $prof
    $envPairs['APPDATA']     = Join-Path $prof 'AppData\Roaming'
    $envPairs['LOCALAPPDATA'] = Join-Path $prof 'AppData\Local'
    $envPairs['HOMEDRIVE']   = $prof.Substring(0, 2)
    $envPairs['HOMEPATH']    = $prof.Substring(2)
    $envPairs['TEMP']        = Join-Path $prof 'AppData\Local\Temp'
    $envPairs['TMP']         = $envPairs['TEMP']
    Write-Ok "measurement identity pinned to $prof (APPDATA drives the pyright user-site lookup declared in the manifest)"
} elseif ($NoProfileMapping) {
    Write-Warn '-NoProfileMapping: the instrument will run under the LocalSystem profile. Expect pyright to measure OFFLINE and the score to drop; that is a real measurement of the SYSTEM profile, not of the operator machine.'
}

Write-Ok "HOST_PROBER_* pinned: ROOT=$ServerRoot PORT=$Port BIND=$Bind ALLOWED_HOSTS=$HostAllowlist REPO_ROOT=$repoRoot"
Write-Ok 'NODE_OPTIONS pinned empty so a stray NODE_OPTIONS in some other profile cannot break the boot start'

# ---------------------------------------------------------------------------
# 5. Remove any previous registration (idempotent re-install)
# ---------------------------------------------------------------------------
Write-Step '5/8 Clearing any previous registration of this service'
$existing = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Info "found existing '$($existing.Name)' state=$($existing.Status); removing it first"
    if ($existing.Status -eq 'Running') {
        [void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('stop', $Script:ServiceName) -Quiet)
        $deadline = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $deadline -and (Get-Service -Name $Script:ServiceName).Status -eq 'Running') {
            Start-Sleep -Milliseconds 500
        }
    }
    [void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('remove', $Script:ServiceName, 'confirm'))
    Start-Sleep -Seconds 1
    Write-Ok 'previous registration removed'
} else {
    Write-Ok 'no previous registration present'
}

# ---------------------------------------------------------------------------
# 6. Install + configure
# ---------------------------------------------------------------------------
Write-Step "6/8 Registering service '$Script:ServiceName'"
$rInstall = Invoke-Nssm -NssmPath $NssmPath -Arguments @('install', $Script:ServiceName, $NodeExe, $tsxCli, $prober)
if ($rInstall.ExitCode -ne 0) { throw "nssm install failed with exit $($rInstall.ExitCode): $($rInstall.StdErr)$($rInstall.StdOut)" }

[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppDirectory', $repoRoot))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'DisplayName', 'Sovereign Host Prober (MCP measurement instrument)'))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'Description', 'Host-side MCP/LSP measurement instrument. The console health score is a function of this process running. Auto-starts at boot and self-heals. Remove with scripts/prober-service/uninstall.ps1'))

# Start type: delayed auto start so a slow disk/Docker start-up cannot make the
# SCM declare the service failed and kill it.
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'Start', 'SERVICE_DELAYED_AUTO_START'))

# --- restart policy: three independent layers -----------------------------
# Layer 1 (prober process exits) -> NSSM restarts it.
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppExit', 'Default', 'Restart'))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppThrottle', "$($Script:NssmDelayMs)"))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppRestartDelay', "$($Script:NssmDelayMs)"))
# Layer 2 (prober hits a non-restart exit code) -> reboot the host. 2 = SERVICE_REBOOT.
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppExit', 'Default', 'Restart'))
foreach ($code in $Script:ProberExitCodes.Keys) {
    $action = $Script:ProberExitCodes[$code]
    [void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppExit', $code, $action) -Quiet)
}
Write-Ok ('AppExit policy set: ' + (($Script:ProberExitCodes.Keys | Sort-Object | ForEach-Object { "code$_=$($Script:ProberExitCodes[$_])" }) -join ', '))

# Layer 3 (nssm.exe itself dies) -> SCM Recovery actions restart it.
$rRec = Invoke-Native -FilePath 'sc.exe' -Arguments @('failure', $Script:ServiceName, 'reset=', '86400', 'actions=', 'restart/5000/restart/10000/restart/30000')
Write-Ok 'SCM Recovery actions requested: restart after 5s / 10s / 30s, counter reset 86400s'

# --- graceful stop method ------------------------------------------------
# 0 = Console: nssm delivers a console control event so the prober's SIGINT
# handler runs handle.close() and reaps its live children. This is why
# uninstall must use `nssm stop`, not Task Manager (HOST_PROBER.md section 12).
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppStopMethodConsole', '0'))

# --- rotated logs --------------------------------------------------------
New-Item -ItemType Directory -Force -Path $Script:LogRoot | Out-Null
$logOut = Join-Path $Script:LogRoot 'host-prober.service.log'
$logErr = Join-Path $Script:LogRoot 'host-prober.service.err.log'
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppStdout', $logOut))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppStderr', $logErr))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppRotateFiles', '1'))
[void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'AppRotateBytes', '10485760'))
Write-Ok "logs: $logOut / $logErr (rotated at 10 MB)"

# --- environment (SECRET: output suppressed on purpose) ------------------
$envArgList = @('set', $Script:ServiceName, 'AppEnvironmentExtra')
foreach ($k in $envPairs.Keys) { $envArgList += ("{0}={1}" -f $k, $envPairs[$k]) }
$null = Invoke-Nssm -NssmPath $NssmPath -Arguments $envArgList -Quiet
Write-Ok "AppEnvironmentExtra written ($($envPairs.Count) variables, values not echoed)"

# ---------------------------------------------------------------------------
# 7. Account
# ---------------------------------------------------------------------------
Write-Step '7/8 Selecting the service account'

# A Windows service that runs as an interactive user needs that user's PASSWORD
# stored in the LSA secret store, so it can be logged on at boot with nobody
# signed in. That password is not available here and must never be typed into a
# script or a command line. The attempt below therefore sets the account with an
# EMPTY password and is then EMPIRICALLY validated: if the SCM cannot log the
# service on, Start-Service fails or the process dies and the installer falls
# back to LocalSystem. The account is never assumed to work; it is proved or
# rejected. Section 8 does the proving.

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$attempts = @()
if ($RunAs -in @('CurrentUser', 'Auto')) { $attempts += $currentUser }
if ($RunAs -in @('LocalSystem', 'Auto')) { $attempts += 'LocalSystem' }
if ($RunAs -eq 'CurrentUser') { $attempts = @($currentUser) }   # honour an explicit request, no silent fallback
if (-not $attempts) { throw "RunAs must be CurrentUser, LocalSystem or Auto (got '$RunAs')" }

Write-Info "account candidates in order: $($attempts -join ' -> ')"

# ---------------------------------------------------------------------------
# 8. Free the port, start, verify
# ---------------------------------------------------------------------------
Write-Step '8/8 Starting the service and verifying the measurement instrument'

$listener = Get-PortListener -Port $Port
if ($listener) {
    $svcPid = (Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'" -ErrorAction SilentlyContinue).ProcessId
    if ($listener.OwningPid -and $listener.OwningPid -eq $svcPid) {
        Write-Ok "port $Port already held by the service itself (pid $($listener.OwningPid))"
    } elseif ($AdoptExistingProber) {
        Write-Info "port $Port held by $($listener.OwningProcess) pid=$($listener.OwningPid) at $($listener.Address)"
        if (-not (Stop-ForeignProber -ProcessId $listener.OwningPid -AllowForcedKill:$AllowForcedKill)) {
            throw "Could not free port $Port. Service installed but NOT started; the previously running prober was left as it was."
        }
        [void](Stop-StrayProberWrappers)
    } else {
        throw ("Port $Port is held by pid $($listener.OwningPid) ($($listener.OwningProcess)) which is not this service. " +
               'Re-run with -AdoptExistingProber to hand the port over, or stop that process yourself. Nothing was stopped.')
    }
}

if ($NoStart) {
    [void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'ObjectName', $attempts[0]) -Quiet)
    Write-Warn ('-NoStart given: service installed with start type ' + (Get-ServiceStartType) + ' but not started')
    exit 0
}

function Show-ServiceLogs {
    foreach ($f in @($logOut, $logErr)) {
        if (Test-Path $f) {
            Write-Host "--- tail $f ---" -ForegroundColor DarkGray
            Write-Protected ((Get-Content $f -Tail 25) -join "`n")
        }
    }
}

function Start-AndProve {
    param([Parameter(Mandatory)][string]$Account, [int]$WaitSec = 60)

    [void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('set', $Script:ServiceName, 'ObjectName', $Account) -Quiet)
    $configured = (Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'").StartName
    Write-Info "ObjectName set to '$Account' (SCM reports StartName='$configured')"

    # MEASURED FALSE POSITIVE, now designed out: passing the literal string
    # 'CurrentUser' to nssm set ObjectName returns exit 0, the SCM silently
    # ignores it and keeps LocalSystem, and the service starts and looks
    # perfect. The installer reported "account CurrentUser WORKS" while the
    # service was in fact LocalSystem. The requested account is therefore
    # ASSERTED against what the SCM actually reports before the attempt is
    # allowed to pass.
    if ($configured.Trim() -ne $Account.Trim()) {
        Write-Warn "the SCM did not accept '$Account' as the service account; it reports StartName='$configured'. Attempt rejected."
        return $false
    }

    # Give NSSM a moment to notice the changed identity before SCM starts it.
    Start-Sleep -Seconds 2
    try {
        Start-Service -Name $Script:ServiceName -ErrorAction Stop
    } catch {
        Write-Fail "Start-Service threw: $($_.Exception.Message)"
        return $false
    }

    $deadline = (Get-Date).AddSeconds($WaitSec)
    $health = $null
    while ((Get-Date) -lt $deadline) {
        $health = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 3
        if ($health.Reachable -and $health.Ok) { break }
        $st = (Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue)
        if (-not $st -or $st.Status -eq 'Stopped') {
            Write-Fail "service went to Stopped during startup under account '$Account'"
            Show-ServiceLogs
            return $false
        }
        Start-Sleep -Milliseconds 750
    }

    if (-not $health -or -not $health.Reachable -or -not $health.Ok) {
        Write-Fail "service is $((Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue).Status) but http://$Bind`:$Port/probe/health never returned ok=true under '$Account'"
        Show-ServiceLogs
        # A stuck service must not be left half-alive before the next attempt.
        [void](Invoke-Nssm -NssmPath $NssmPath -Arguments @('stop', $Script:ServiceName) -Quiet)
        return $false
    }

    Write-Ok "account '$Account' WORKS: service Running, /probe/health ok=true"
    return $true
}

$chosen = $null
$attemptLog = @()
foreach ($acct in $attempts) {
    Write-Info "--- attempting account: $acct ---"
    if (Start-AndProve -Account $acct) { $chosen = $acct; break }
    $attemptLog += $acct
    if ($acct -eq 'CurrentUser') {
        Write-Warn "account '$currentUser' could not be used without a stored password. This is the expected SCM limitation, not a prober fault."
    }
}
if (-not $chosen) { throw "service would not start under any candidate account: $($attemptLog -join ', '). See $logOut / $logErr." }
$summary['accountChosen'] = $chosen
Write-Ok "service will run as: $chosen"

# --- report the identity the process ACTUALLY has, not the one configured ---
$svcNow = Get-Service -Name $Script:ServiceName
$health = Test-ProberHealth -Bind $Bind -Port $Port -TimeoutSec 5
Write-Ok "service status=$($svcNow.Status) startType=$(Get-ServiceStartType) health=$($health.Ok)"

# --- security regression gate: the token check must still reject -------------
Write-Step 'Post-install security gate: unauthenticated /probe/mcp/status must be 401'
try {
    $null = Invoke-WebRequest -Uri "http://$Bind`:$Port/probe/mcp/status" -UseBasicParsing -TimeoutSec 10
    Write-Fail 'UNAUTHENTICATED REQUEST WAS ACCEPTED - this is a security regression, fix before proceeding'
    throw 'unauthenticated request succeeded'
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) {
        Write-Ok "unauthenticated /probe/mcp/status -> HTTP 401 (token enforcement intact)"
    } else {
        throw "unauthenticated /probe/mcp/status returned $status, expected 401"
    }
}
$summary['unauthStatus'] = 401

# --- authenticated measurement --------------------------------------------
Write-Step 'Authenticated measurement through the service'
$headers = @{ Authorization = "Bearer $token" }
try {
    $report = Invoke-RestMethod -Uri "http://$Bind`:$Port/probe/mcp/status?fresh=1" -Headers $headers -TimeoutSec 120
    Write-Ok "provenance=$($report.provenance)  online=$($report.summary.online)/$($report.summary.total)  unverifiable=$($report.summary.unverifiable)"
    $summary['online'] = $report.summary.online
    $summary['total']  = $report.summary.total
} catch {
    Write-Warn "measurement failed: $($_.Exception.Message)"
    $summary['online'] = 'UNKNOWN'
    $summary['total']  = 'UNKNOWN'
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' INSTALL SUMMARY' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray
$final = Get-Service -Name $Script:ServiceName
$cim   = Get-CimInstance Win32_Service -Filter "Name='$Script:ServiceName'"
"  service name   : $($final.Name)"
"  display name   : $($cim.DisplayName)"
"  status         : $($final.Status)"
"  start type     : $(Get-ServiceStartType)"
"  account        : $($cim.StartName)"
"  nssm.exe       : $NssmPath"
"  application    : $NodeExe"
"  arguments      : `"$tsxCli`" `"$prober`""
"  working dir    : $repoRoot"
"  token          : resolved from file, length=$($token.Length), value never printed"
"  logs           : $logOut"
Write-Host ''
Write-Host '  Next: .\verify.ps1          (read-only, exits non-zero on any failure)'
Write-Host '        .\verify.ps1 -SelfHealTest   (kills the prober and measures recovery)'
Write-Host '        .\uninstall.ps1        (fully reversible removal)'
Write-Host ''

$final | Format-List Name, Status, StartType | Out-String | Write-Host
exit 0