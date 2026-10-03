<#
.SYNOPSIS
    Fully removes the Sovereign host-prober Windows service.

.DESCRIPTION
    A service that cannot be removed is a liability. This script reverses
    install.ps1 completely:

      * stops the service through NSSM, not Task Manager, so the prober's SIGINT
        handler runs handle.close() and reaps its live MCP/Chromium children
        (HOST_PROBER.md section 12: a forced kill strands Chromium grandchildren),
      * removes the SCM registration, which also removes the AppEnvironmentExtra
        block holding the token from the registry,
      * removes the SCM Recovery action entries (they live under the service key,
        so they die with it - this step only asserts that),
      * optionally deletes the NSSM tool directory and the rotated service logs,
      * NEVER touches the token file. Rotating the bearer token is a deliberate
        operator act, not a side effect of uninstalling a service.

    Everything it removes it names first. Nothing outside
    %LOCALAPPDATA%\sovereign-commander-console\tools\nssm and
    %APPDATA%\sovereign-commander-console is deleted, and only with an explicit
    switch.

.EXAMPLE
    .\uninstall.ps1
    .\uninstall.ps1 -PurgeNssm -PurgeLogs

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param(
    [switch]$PurgeNssm,
    [switch]$PurgeLogs,
    [switch]$WhatIfOnly,
    [string]$TranscriptPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# ---------------------------------------------------------------------------
# Self-elevation
# ---------------------------------------------------------------------------
if (-not (Test-IsAdmin)) {
    Write-Step 'Not elevated - relaunching this script elevated (UAC)'
    $tpath = Join-Path $env:TEMP ("opencode\uninstall-elevated-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Force -Path (Split-Path $tpath) | Out-Null
    Remove-Item $tpath -Force -ErrorAction SilentlyContinue
    $switches = @()
    if ($PurgeNssm) { $switches += '-PurgeNssm' }
    if ($PurgeLogs)  { $switches += '-PurgeLogs' }
    if ($WhatIfOnly) { $switches += '-WhatIfOnly' }
    $cmdLine = New-RelaunchCommandLine -ScriptPath $PSCommandPath -Named @{ 'TranscriptPath' = $tpath } -Switches $switches
    $p = Start-Process -FilePath (Get-ElevationShell) -Verb RunAs -ArgumentList $cmdLine -Wait -PassThru
    Write-Host "    elevated shell pid=$($p.Id); waiting"
    $p.WaitForExit()
    Write-Host ''
    Write-Host '---------------- elevated uninstall.ps1 stdout ----------------' -ForegroundColor DarkGray
    if (Test-Path $tpath) { Get-Content $tpath | ForEach-Object { Write-Protected $_ } }
    else { Write-Warn "no transcript at $tpath (exit $($p.ExitCode))" }
    Write-Host '---------------------------------------------------------------' -ForegroundColor DarkGray
    exit $p.ExitCode
}

if ($TranscriptPath) {
    try { Start-Transcript -Path $TranscriptPath -Force | Out-Null } catch { }
}

Write-Host ''
Write-Host '================================================================' -ForegroundColor DarkGray
Write-Host ' SOVEREIGN HOST PROBER - SERVICE REMOVAL' -ForegroundColor White
Write-Host '================================================================' -ForegroundColor DarkGray

$nssm = Get-NssmExe
$svc  = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue

if (-not $svc) {
    Write-Warn "service '$Script:ServiceName' is not registered - nothing to remove"
} else {
    Write-Step "Service present: state=$($svc.Status)"
    if ($svc.Status -eq 'Running') {
        if ($WhatIfOnly) {
            Write-Info '[WhatIf] would run: nssm stop (graceful, console control event)'
        } else {
            Write-Info 'stopping gracefully via nssm (NOT taskkill /F)'
            [void](Invoke-Nssm -NssmPath $nssm -Arguments @('stop', $Script:ServiceName))
            $deadline = (Get-Date).AddSeconds(30)
            while ((Get-Date) -lt $deadline -and (Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue).Status -eq 'Running') {
                Start-Sleep -Milliseconds 500
            }
            $st = (Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue).Status
            if ($st -eq 'Running') {
                Write-Fail 'service is still Running after 30s of graceful stop'
                throw 'Refusing to force-terminate. Use `nssm stop` from an elevated prompt, or investigate the hang.'
            }
            Write-Ok 'service stopped'
        }
    } else {
        Write-Ok "service already $($svc.Status)"
    }

    if ($WhatIfOnly) {
        Write-Info "[WhatIf] would run: nssm remove $Script:ServiceName confirm"
    } else {
        [void](Invoke-Nssm -NssmPath $nssm -Arguments @('remove', $Script:ServiceName, 'confirm'))
        Start-Sleep -Seconds 1
        $still = Get-Service -Name $Script:ServiceName -ErrorAction SilentlyContinue
        if ($still) {
            Write-Fail 'service registration still present after nssm remove'
            throw 'Removal failed.'
        }
        Write-Ok "service '$Script:ServiceName' removed"

        # Assert the secret is gone from the registry with the registration.
        $key = "HKLM:\SYSTEM\CurrentControlSet\Services\$Script:ServiceName"
        if (Test-Path $key) {
            Write-Warn "registry key $key still exists"
        } else {
            Write-Ok 'registry key gone, so AppEnvironmentExtra (and the token) is gone with it'
        }
    }
}

# ---------------------------------------------------------------------------
# Optional reversals of the support files
# ---------------------------------------------------------------------------
$tokenFile = Get-TokenFilePath
Write-Ok "token file left intact: $tokenFile (exists=$(Test-Path $tokenFile))"

if ($PurgeNssm) {
    $toolsDir = Join-Path $Script:ToolsRoot $Script:NssmVersion
    Write-Step "Removing NSSM tool directory $toolsDir"
    if ($WhatIfOnly) {
        Write-Info "[WhatIf] would Remove-Item -Recurse -Force '$toolsDir'"
    } elseif (Test-Path $toolsDir) {
        Remove-Item $toolsDir -Recurse -Force
        Write-Ok 'removed'
    } else {
        Write-Info 'not present'
    }
}

if ($PurgeLogs) {
    $logs = @(
        (Join-Path $Script:LogRoot 'host-prober.service.log'),
        (Join-Path $Script:LogRoot 'host-prober.service.err.log')
    )
    Write-Step 'Removing rotated service logs'
    foreach ($l in $logs) {
        if ($WhatIfOnly) {
            Write-Info "[WhatIf] would remove $l"
        } elseif (Test-Path $l) {
            Remove-Item $l -Force
            Write-Ok "removed $l"
        }
    }
}

$listener = Get-PortListener -Port $Script:DefaultPort
Write-Host ''
if ($listener) {
    Write-Warn "port $($listener.Port) is STILL listening (pid $($listener.OwningPid), $($listener.OwningProcess)) - something else now holds it"
} else {
    Write-Ok "nothing is listening on $($Script:DefaultPort) - the instrument is now OFF"
}

Write-Host ''
Write-Host '  The console will now report its CONTAINER_FILESYSTEM_PROBE fallback until the'
Write-Host '  prober is running again. That fallback is a lost instrument, not a regression.'
Write-Host '  Restore the transient process with HOST_PROBER.md section 2.2, or reinstall'
Write-Host '  with: .\install.ps1'
Write-Host ''
exit 0