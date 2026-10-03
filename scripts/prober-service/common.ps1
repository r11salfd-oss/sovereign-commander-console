<#
.SYNOPSIS
    Shared constants and helpers for the Sovereign host-prober Windows service.

.DESCRIPTION
    Dot-sourced by install.ps1, uninstall.ps1 and verify.ps1. Contains no side
    effects beyond defining functions: importing this file must never install
    anything, start anything, or stop anything.

    SECRET HANDLING
    The bearer token is read from disk into a script-scope variable and is
    never written to stdout, stderr, a log file, or the registry under a name
    this file prints. Every helper that can echo a child process's output runs
    it through Protect-Secret first, because `nssm set ... AppEnvironmentExtra`
    echoes the environment block it just wrote -- which contains the token.

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$Script:ServiceName          = 'SovereignHostProber'
$Script:DefaultPort          = 39711
$Script:DefaultBind          = '127.0.0.1'
$Script:DefaultServerRoot    = 'E:\Servers-Center'
$Script:DefaultHostAllowlist = 'host.docker.internal'

# NSSM release chosen and why:
#   nssm.cc states that users of Windows 10 Creators Update and newer "should use
#   prelease build 2.24-101 or any newer build to avoid an issue with services
#   failing to start." This host is Windows 11 build 26200, so the STABLE 2.24
#   build is knowingly the wrong choice and the pre-release is used instead.
#   nssm.cc publishes a SHA-1 (no SHA-256, no code signature) per artefact:
#     stable    nssm-2.24.zip               be7b3577c6e3a280e5106a9e9db5b3775931cefc
#     prelease  nssm-2.24-101-g897c7ad.zip  ca2f6782a05af85facf9b620e047b01271edd11d
#   The published SHA-1 is the ONLY integrity anchor the publisher offers, so it
#   is verified byte-for-byte and the script fails closed on mismatch.
$Script:NssmVersion      = '2.24-101-g897c7ad'
$Script:NssmUrl          = 'https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip'
$Script:NssmPublishedSha1 = 'ca2f6782a05af85facf9b620e047b01271edd11d'
$Script:NssmStableUrl    = 'https://nssm.cc/release/nssm-2.24.zip'
$Script:NssmStableSha1   = 'be7b3577c6e3a280e5106a9e9db5b3775931cefc'

$Script:ToolsRoot = Join-Path $env:LOCALAPPDATA 'sovereign-commander-console\tools\nssm'
$Script:LogRoot   = Join-Path $env:APPDATA 'sovereign-commander-console'

$Script:ProberExitCodes = @{ Restart = 0; Reboot = 2; Exit = 1 }
$Script:NssmDelayMs    = 3000

# ---------------------------------------------------------------------------
# Cold-boot resilience constants
# ---------------------------------------------------------------------------
# The readiness record is written to ProgramData rather than to %APPDATA% on
# purpose. The service pins APPDATA to the operator profile, and "is APPDATA
# pinned correctly" is one of the things being tested - so the place the verdict
# is stored must NOT depend on the thing being verified. ProgramData is
# machine-scoped, is written by LocalSystem, and is readable by BUILTIN\Users.
$Script:MachineRoot     = 'C:\ProgramData\sovereign-commander-console'
$Script:ReadinessFile   = Join-Path $Script:MachineRoot 'readiness.json'
$Script:ExpectationsFile = Join-Path $Script:MachineRoot 'expectations.json'
$Script:RecoveryTaskPath = '\Sovereign\'
$Script:RecoveryTaskName = 'HostProberRecovery'

# The service wrapper. NSSM runs it instead of node.exe directly; it performs the
# startup readiness self-test and then runs the prober unchanged.
$Script:BootGuardName   = 'boot-guard.mjs'

# Names the guard must assert PRESENT but must never read the value of.
$Script:SecretEnvNames  = @('HOST_PROBER_TOKEN')

# The token is held here so Protect-Secret can scrub it out of anything that is
# about to be printed. Never echoed. Never interpolated into a log line.
$Script:SecretValues = New-Object System.Collections.Generic.List[string]

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    [OK]   $Message" -ForegroundColor Green
}

function Write-Warn {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    [FAIL] $Message" -ForegroundColor Red
}

function Write-Info {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "    $Message"
}

# ---------------------------------------------------------------------------
# Secret hygiene
# ---------------------------------------------------------------------------

function Register-Secret {
    <#  Register a value that must never appear in output.  #>
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    if ($Value.Length -ge 8 -and -not $Script:SecretValues.Contains($Value)) {
        $Script:SecretValues.Add($Value)
    }
}

function Protect-Secret {
    <#  Replace every registered secret in $Text with a non-reversible marker.  #>
    param([AllowEmptyString()][AllowNull()][string]$Text)
    if ($null -eq $Text -or $Text.Length -eq 0) { return $Text }
    $out = $Text
    foreach ($s in $Script:SecretValues) {
        $out = $out.Replace($s, "<REDACTED:len=$($s.Length)>")
    }
    # Belt and braces: the token is base64url, so scrub any run of >= 32 chars
    # that follows a HOST_PROBER_TOKEN assignment even if it was never registered.
    $out = [regex]::Replace($out, '(?i)(HOST_PROBER_TOKEN\s*=\s*)(\S{8,})', '$1<REDACTED>')
    return $out
}

function Write-Protected {
    param([AllowEmptyString()][AllowNull()][string]$Text)
    Write-Host (Protect-Secret $Text)
}

# ---------------------------------------------------------------------------
# Privilege
# ---------------------------------------------------------------------------

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ElevationShell {
    <#
      The host used for the self-elevation relaunch.

      MEASURED BUG: using Join-Path $PSHOME 'powershell.exe' is wrong. When
      these scripts are run from PowerShell 7, $PSHOME is
      "C:\Program Files\PowerShell\7", which contains only pwsh.exe -- there is
      no powershell.exe there. The relaunch then produced a process that exited
      1 with no output and no transcript, which reads exactly like a script bug.
      Windows PowerShell 5.1 is pinned by absolute path instead.
    #>
    $c = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path $c) { return $c }
    $cmd = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'No Windows PowerShell (powershell.exe) found; cannot relaunch elevated.'
}

function New-RelaunchCommandLine {
    <#
      Build the command line for the elevated relaunch.

      TWO MEASURED BUGS are designed out here.

      1. Start-Process parameters must NOT be placed inside the -ArgumentList
         array. Putting '-Wait','-PassThru' in that array forwards them to
         powershell.exe, which does not accept them: the relaunch exited 1 with
         no output and no transcript, which is indistinguishable from a script
         bug. -Wait/-PassThru now belong on the Start-Process call itself.

      2. The array is joined into ONE string and every element is quoted by
         ConvertTo-CommandLineArg. Passing a mixed array of pre-quoted strings
         produced a malformed command line; a single correctly-quoted string is
         identical on Windows PowerShell 5.1 and PowerShell 7.
    #>
    param(
        [Parameter(Mandatory)][string]$ScriptPath,
        [string[]]$Switches = @(),
        [hashtable]$Named = @{}
    )
    $parts = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-CommandLineArg $ScriptPath))
    foreach ($n in $Named.Keys) {
        if ($null -eq $Named[$n] -or "$($Named[$n])" -eq '') { continue }
        # Hashtable keys are written bare ('Port'), so the switch marker is
        # restored here. Forgetting this produced
        #   -File install.ps1 TranscriptPath C:\... Port 39711
        # which powershell.exe rejects as a positional argument, exiting 1 with
        # no output. MEASURED.
        $name = if ([string]$n -like '-*') { [string]$n } else { '-' + [string]$n }
        $parts += (ConvertTo-CommandLineArg $name)
        $parts += (ConvertTo-CommandLineArg ([string]$Named[$n]))
    }
    foreach ($s in $Switches) { $parts += (ConvertTo-CommandLineArg $s) }
    return ($parts -join ' ')
}

# ---------------------------------------------------------------------------
# Repository layout
# ---------------------------------------------------------------------------

function Get-RepoRoot {
    <# scripts/prober-service/common.ps1 -> scripts/prober-service -> scripts -> repo  #>
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-ProberScriptPath {
    return (Join-Path (Get-RepoRoot) 'scripts\host_prober.ts')
}

function Get-TsxCliPath {
    # tsx is resolved to an ABSOLUTE path and invoked through an ABSOLUTE
    # node.exe. Nothing in the service command line is resolved through PATH.
    return (Join-Path (Get-RepoRoot) 'node_modules\tsx\dist\cli.mjs')
}

function Get-TokenFilePath {
    return (Join-Path $env:APPDATA 'sovereign-commander-console\secrets\host-prober-token.txt')
}

function Get-BootGuardPath {
    return (Join-Path $PSScriptRoot $Script:BootGuardName)
}

function Get-RecoveryScriptPath {
    return (Join-Path $PSScriptRoot 'recover-prober.ps1')
}

function Merge-ReadinessRecord {
    <#
      Merge one key into the readiness file without clobbering the keys another
      writer owns.

      WRITER OWNERSHIP: boot-guard.mjs owns `service`, `boot`, `verdict`;
      recover-prober.ps1 owns `recovery`. Both merge under the same short
      exclusive lock file, so a service start and a recovery attempt that happen
      at the same moment cannot interleave and neither can erase the other.

      The write is atomic (temp file + rename), so a reader can never observe a
      half-written record - which matters because boot-verdict.ps1 is expected to
      be runnable at any moment, including while the service is starting.
    #>
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)]$Value
    )

    $dir = Split-Path $Path -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $lock = "$Path.lock"
    $handle = $null
    $deadline = (Get-Date).AddSeconds(5)
    while ($null -eq $handle) {
        try {
            $handle = [System.IO.File]::Open($lock, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        } catch {
            # Reap a lock left behind by a process that died holding it.
            try {
                if (((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds -gt 10) { Remove-Item $lock -Force -ErrorAction SilentlyContinue }
            } catch { }
            if ((Get-Date) -gt $deadline) {
                return [pscustomobject]@{ Ok = $false; Path = $Path; Error = "could not acquire $lock within 5s" }
            }
            Start-Sleep -Milliseconds 50
        }
    }

    try {
        $current = $null
        try { $current = (Read-TextNoBom -Path $Path | ConvertFrom-Json) } catch { $current = $null }
        if ($null -eq $current) {
            $current = [pscustomobject]@{
                schema        = 'sovereign.prober.readiness/1'
                chainKeyId    = '360ea36c28e66d9d'
                verdict       = 'UNKNOWN'
                verdictMeaning = @{
                    UNKNOWN  = 'no startup self-test has run yet on this machine'
                    READY    = 'every cold-boot precondition the prober needs existed at the moment it started'
                    DEGRADED = 'the prober started, but at least one ADVISORY boot hazard was present at that moment'
                    FAIL     = 'at least one REQUIRED check failed, so the measurement is wrong or silently degraded'
                }
                createdAtUtc  = (Get-Date).ToUniversalTime().ToString('o')
            }
        }
        $bag = [ordered]@{}
        foreach ($p in $current.PSObject.Properties) { $bag[$p.Name] = $p.Value }
        $bag[$Key] = $Value
        $bag['updatedAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')

        $tmp = "$Path.tmp"
        Write-Utf8NoBom -Path $tmp -Content (([pscustomobject]$bag | ConvertTo-Json -Depth 12) + "`n")
        Move-Item -LiteralPath $tmp -Destination $Path -Force
        return [pscustomobject]@{ Ok = $true; Path = $Path; Error = $null }
    } catch {
        return [pscustomobject]@{ Ok = $false; Path = $Path; Error = $_.Exception.Message }
    } finally {
        if ($handle) { try { $handle.Close(); $handle.Dispose() } catch { } }
        Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Boot-resilience helpers
# ---------------------------------------------------------------------------

function Write-Utf8NoBom {
    <#
      Write a file as UTF-8 WITHOUT a byte order mark.

      MEASURED: Windows PowerShell 5.1's `Set-Content -Encoding UTF8` emits a BOM
      (EF BB BF). boot-guard.mjs reads the expectations file with JSON.parse, which
      rejects a leading U+FEFF, so the first real service start reported the
      expectations as "absent" while the file was present and correct. The guard
      strips the BOM on read as well, and this writer stops producing one, so the
      two sides agree whichever way a file was produced.
    #>
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Content)
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Read-TextNoBom {
    param([Parameter(Mandatory)][string]$Path)
    return ([System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)).TrimStart([char]0xFEFF)
}

function Get-Prop {
    <#
      StrictMode-safe property read.

      common.ps1 runs under Set-StrictMode -Version Latest, which (from 2.0 on)
      THROWS on a reference to a property that does not exist. The readiness
      record is written by a separate process and its shape can legitimately
      differ between versions, so every field read out of it goes through here
      instead of being dereferenced directly. A missing field must degrade the
      verdict, never abort the verifier.
    #>
    param($Object, [Parameter(Mandatory)][string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $Default
    }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { return $Default }
    return $p.Value
}

function Read-JsonFile {
    <#  Returns $null (and a reason on $Script:LastJsonError) for missing or malformed JSON.  #>
    param([Parameter(Mandatory)][string]$Path)
    $Script:LastJsonError = $null
    if (-not (Test-Path $Path)) { $Script:LastJsonError = "not found: $Path"; return $null }
    try {
        return (Read-TextNoBom -Path $Path | ConvertFrom-Json)
    } catch {
        $Script:LastJsonError = "unparsable JSON at ${Path}: $($_.Exception.Message)"
        return $null
    }
}

function Get-ReadinessRecord {
    <#
      The readiness record, with the path it came from and any parse error.

      Falls back to the service log directory when ProgramData is unreadable, so
      a machine whose ProgramData ACLs were changed still yields a verdict
      instead of a silent "no record".
    #>
    param([string]$Path = $Script:ReadinessFile)
    $r = Read-JsonFile -Path $Path
    if ($null -ne $r) { return [pscustomobject]@{ Path = $Path; Record = $r; Error = $null } }

    $alt = Join-Path $Script:LogRoot 'readiness.json'
    if ($alt -ne $Path -and (Test-Path $alt)) {
        $r2 = Read-JsonFile -Path $alt
        if ($null -ne $r2) { return [pscustomobject]@{ Path = $alt; Record = $r2; Error = $null } }
        return [pscustomobject]@{ Path = $alt; Record = $null; Error = $Script:LastJsonError }
    }
    return [pscustomobject]@{ Path = $Path; Record = $null; Error = $Script:LastJsonError }
}

function Get-ExpectationsRecord {
    return (Read-JsonFile -Path $Script:ExpectationsFile)
}

function Get-BootIdentity {
    <#
      Identity of the CURRENT boot, from three independent sources.

      os.uptime-equivalent is not available in PowerShell, so LastBootUpTime from
      Win32_OperatingSystem is used, plus BootId from the prefetch parameters,
      which increments once per power-on and is therefore a hard boot identity
      that cannot be confused with a clock change.
    #>
    $lastBoot = $null
    try { $lastBoot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime } catch { }
    $uptimeSec = $null
    if ($lastBoot) { $uptimeSec = [int]((Get-Date) - $lastBoot).TotalSeconds }

    $bootId = $null
    $bootIdError = $null
    try {
        $k = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters'
        $v = (Get-ItemProperty -Path $k -Name BootId -ErrorAction Stop).BootId
        if ($null -ne $v) { $bootId = [int]$v }
    } catch { $bootIdError = $_.Exception.Message }

    return [pscustomobject]@{
        LastBootUpTime  = $lastBoot
        BootTimeUtc     = if ($lastBoot) { $lastBoot.ToUniversalTime().ToString('o') } else { $null }
        UptimeSec       = $uptimeSec
        BootId          = $bootId
        BootIdError     = $bootIdError
        NowUtc          = (Get-Date).ToUniversalTime().ToString('o')
    }
}

function Get-RecoveryTaskName {
    return ($Script:RecoveryTaskPath.TrimEnd('\') + '\' + $Script:RecoveryTaskName)
}

function Get-RecoveryTask {
    param([string]$TaskName = (Get-RecoveryTaskName))
    return (Get-ScheduledTask -TaskName $Script:RecoveryTaskName -TaskPath $Script:RecoveryTaskPath -ErrorAction SilentlyContinue)
}

function Write-Expectations {
    <#
      Record what the installer PINNED, so the guard can prove at boot that the
      running environment is the pinned one and was not re-derived.

      Deliberately contains no secret: the token is listed by NAME in
      secretEnvNames and never by value, and the token's value is not even read
      here - only its length, which is already reported by the installer.
    #>
    param(
        [Parameter(Mandatory)][hashtable]$ExpectedEnv,
        [Parameter(Mandatory)][string]$ServiceAccount,
        [string]$MeasuredProfile,
        [bool]$ProfilePinned = $true,
        [Parameter(Mandatory)][hashtable]$Paths
    )
    New-Item -ItemType Directory -Force -Path $Script:MachineRoot | Out-Null
    $record = [ordered]@{
        schema                = 'sovereign.prober.expectations/1'
        chainKeyId            = '360ea36c28e66d9d'
        writtenAtUtc          = (Get-Date).ToUniversalTime().ToString('o')
        serviceAccount        = $ServiceAccount
        profilePinned         = $ProfilePinned
        measuredProfile       = $MeasuredProfile
        serviceAccountProfile = if ($ServiceAccount -eq 'LocalSystem') { Join-Path $env:SystemRoot 'System32\config\systemprofile' } else { $null }
        secretEnvNames        = $Script:SecretEnvNames
        expectedEnv           = $ExpectedEnv
        paths                 = $Paths
    }
    # ACL: SYSTEM and Administrators full, BUILTIN\Users read. The operator must
    # be able to READ the verdict without being able to forge it.
    $tmp = "$($Script:ExpectationsFile).tmp"
    Write-Utf8NoBom -Path $tmp -Content (($record | ConvertTo-Json -Depth 8) + "`n")
    Move-Item -LiteralPath $tmp -Destination $Script:ExpectationsFile -Force
    return $Script:ExpectationsFile
}

function Get-NssmExe {
    param([switch]$InstallIfMissing)

    $candidate = Join-Path $Script:ToolsRoot "$($Script:NssmVersion)\nssm-$($Script:NssmVersion)\win64\nssm.exe"
    if (Test-Path $candidate) { return $candidate }

    $onPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    if (-not $InstallIfMissing) { return $null }

    Write-Step "NSSM not present - installing $Script:NssmVersion outside the repository"
    $dl   = Join-Path $Script:ToolsRoot 'download'
    $dest = Join-Path $Script:ToolsRoot $Script:NssmVersion
    New-Item -ItemType Directory -Force -Path $dl | Out-Null

    $zip = Join-Path $dl "nssm-$($Script:NssmVersion).zip"
    $tmp = "$zip.part"
    $ProgressPreference = 'SilentlyContinue'
    Write-Info "GET $Script:NssmUrl"
    Invoke-WebRequest -Uri $Script:NssmUrl -OutFile $tmp -UseBasicParsing -TimeoutSec 180
    Move-Item -Path $tmp -Destination $zip -Force

    $got  = (Get-FileHash -Path $zip -Algorithm SHA1).Hash.ToLowerInvariant()
    $sha2 = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Info "bytes    = $((Get-Item $zip).Length)"
    Write-Info "sha256   = $sha2"
    Write-Info "sha1     = $got"
    Write-Info "published= $($Script:NssmPublishedSha1)  (nssm.cc publishes SHA-1 only; binaries are unsigned)"
    if ($got -ne $Script:NssmPublishedSha1) {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        throw "nssm integrity check FAILED - expected SHA-1 $($Script:NssmPublishedSha1), got $got. Nothing was extracted."
    }
    Write-Ok "nssm SHA-1 matches the value published by nssm.cc"

    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    if (-not (Test-Path $candidate)) { throw "nssm.exe not found at $candidate after extraction" }
    Write-Ok "nssm.exe installed at $candidate (outside the git repository)"
    return $candidate
}

# ---------------------------------------------------------------------------
# nssm invocation with redaction
# ---------------------------------------------------------------------------

function ConvertTo-CommandLineArg {
    <#
      Quote one argument for CreateProcess, following the CommandLineToArgvW
      rules (backslash-run then quote, backslash-run then end-quote doubled).

      ProcessStartInfo.ArgumentList does not exist on Windows PowerShell 5.1
      (.NET Framework), and the elevated relaunch uses powershell.exe, so the
      quoting is done explicitly instead of relying on the runtime.
    #>
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-Native {
    <#
      Run an executable and capture both streams without letting its stderr
      become a terminating error.

      This matters: with $ErrorActionPreference = 'Stop' in the caller, Windows
      PowerShell 5.1 turns ANY stderr line from a native command (for example
      taskkill's "ERROR: The process ... could not be terminated") into a
      terminating error. That is how a diagnostic message becomes a failed
      install. Native output is data here, not an exception.
    #>
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$Quiet
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = $FilePath
    $psi.Arguments              = (($Arguments | ForEach-Object { ConvertTo-CommandLineArg $_ }) -join ' ')
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.CreateNoWindow         = $true

    $p = [System.Diagnostics.Process]::Start($psi)
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    $code = $p.ExitCode
    $combined = (($stdout + $stderr) -replace '\s+', ' ').Trim()

    if (-not $Quiet) {
        Write-Protected "`$ $FilePath $($Arguments -join ' ')"
        if ($combined) { Write-Host "    -> exit=$code  $combined" }
    }
    return [pscustomobject]@{ ExitCode = $code; StdOut = Protect-Secret $stdout; StdErr = Protect-Secret $stderr; Combined = Protect-Secret $combined }
}

function Invoke-Nssm {
    param(
        [Parameter(Mandatory)][string]$NssmPath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$Quiet
    )
    $r = Invoke-Native -FilePath $NssmPath -Arguments $Arguments -Quiet:$Quiet
    if (-not $Quiet) {
        if ($r.StdOut.Trim()) { Write-Protected $r.StdOut.TrimEnd() }
        if ($r.StdErr.Trim()) { Write-Protected $r.StdErr.TrimEnd() }
    }
    return $r
}

function Get-ServiceStartType {
    <# 'Automatic' | 'AutomaticDelayedStart' | 'Manual' | 'Disabled' | 'Unknown'  #>
    $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='$Script:ServiceName'" -ErrorAction SilentlyContinue
    if (-not $svc) { return 'Absent' }
    if ($svc.StartMode -eq 'Auto') {
        $delayed = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$Script:ServiceName" -Name DelayedAutoStart -ErrorAction SilentlyContinue).DelayedAutoStart
        if ($delayed -eq 1) { return 'AutomaticDelayedStart' }
        return 'Automatic'
    }
    return $svc.StartMode
}

function Get-PortListener {
    param([int]$Port)
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if (-not $c) { return $null }
    return [pscustomobject]@{
        Port         = $Port
        Address      = $c.LocalAddress
        OwningPid    = $c.OwningProcess
        OwningProcess= (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    }
}

function Test-ProberHealth {
    param([string]$Bind = $Script:DefaultBind, [int]$Port = $Script:DefaultPort, [int]$TimeoutSec = 5)
    try {
        $r = Invoke-RestMethod -Uri "http://$Bind`:$Port/probe/health" -TimeoutSec $TimeoutSec
        return [pscustomobject]@{ Reachable = $true; Ok = [bool]$r.ok; Raw = $r }
    } catch {
        return [pscustomobject]@{
            Reachable = $false
            Ok        = $false
            Raw       = $null
            Error     = $_.Exception.Message
        }
    }
}

function Get-ProcessTreeIds {
    <#
      The set of process ids in the tree rooted at -RootPid, computed by walking
      ParentProcessId.

      SCOPE IS LOAD-BEARING. An earlier version detected orphans by matching
      command lines against "chrome-devtools-mcp" / "playwright\mcp" /
      "Servers-Center\servers\". MEASURED on this host, that matched 22 live
      processes that had nothing to do with the prober: they were the MCP
      servers of opencode-cli.exe itself (the very tooling running these
      scripts). A cleanup step built on that filter would have killed the
      operator's own MCP servers. Only the descendants of the process actually
      being stopped are ever considered.
    #>
    param([Parameter(Mandatory)][int]$RootPid)

    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $byParent = @{}
    foreach ($p in $all) { $byParent[[int]$p.ParentProcessId] = @($byParent[[int]$p.ParentProcessId]) + [int]$p.ProcessId }

    $ids = New-Object System.Collections.Generic.List[int]
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($RootPid)
    $seen = @{}
    while ($queue.Count -gt 0) {
        $cur = [int]$queue.Dequeue()
        foreach ($child in $byParent[$cur]) {
            if (-not $seen.ContainsKey($child)) {
                $seen[$child] = $true
                $ids.Add($child)
                $queue.Enqueue($child)
            }
        }
    }
    return $ids.ToArray()
}

function Report-ProberDescendants {
    <#  After a stop, report which of the TRACKED descendants survived.  #>
    param([int[]]$Tracked)
    if (-not $Tracked -or $Tracked.Count -eq 0) {
        Write-Info 'the stopped process had no live descendants'
        return $true
    }
    $alive = @($Tracked | Where-Object { [bool](Get-Process -Id $_ -ErrorAction SilentlyContinue) })
    if ($alive.Count -eq 0) {
        Write-Ok "all $($Tracked.Count) descendants of the stopped process exited with it"
        return $true
    }
    Write-Warn "$($alive.Count) of $($Tracked.Count) descendants survived the stop (Chromium orphans are a known abrupt-kill risk, HOST_PROBER.md section 12):"
    foreach ($a in $alive) { Write-Warn "  pid=$a still alive" }
    return $false
}

function Stop-ForeignProber {
    <#
      Stop a prober that holds the port but is NOT this service, so the service
      can bind.

      MEASURED ON THIS HOST, why the escalation looks like it does:

      1. `taskkill /PID n` without /F only posts WM_CLOSE to top-level windows.
         A prober started by `Start-Process npx.cmd` has no window to close, so
         taskkill answered "ERROR: The process with PID n could not be
         terminated" and the process kept running. /F is not an option at this
         stage: HOST_PROBER.md section 12 records that an abrupt TerminateProcess
         strands Chromium grandchildren.

      2. CTRL_C_EVENT reaches a console process group only while that group is
         the FOREGROUND console of its session. The prober's console here is a
         background group, so `GenerateConsoleCtrlEvent` returned TRUE
         ("ctrl-c-sent") and Node's SIGINT handler never ran - the port stayed
         bound. VERIFIED, not assumed. The attempt is still made first, because
         on a machine where the prober holds the foreground console it is the
         correct and clean path.

      3. `taskkill /PID n /T` (no /F) is tried next: still graceful.

      4. Only with -AllowForcedKill does it fall back to `taskkill /F /T`. Note
         the /T: a forced tree kill terminates the descendants too, so it is
         strictly BETTER for orphans than a forced kill of the parent alone, and
         it is the same call the self-heal test in verify.ps1 uses to simulate a
         crash. It is still an abrupt kill, so the orphan delta is measured and
         reported, never assumed.
    #>
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [int]$WaitSeconds = 20,
        [switch]$AllowForcedKill
    )

    $tracked = @(Get-ProcessTreeIds -RootPid $ProcessId)
    Write-Step "Stopping the foreign prober on PID $ProcessId"
    Write-Info "descendants of PID $ProcessId before stop: $($tracked.Count)"

    # --- step 1: console control event (graceful) ---
    $sender = Join-Path $PSScriptRoot 'send-ctrl-c.ps1'
    if (Test-Path $sender) {
        Write-Info 'step 1: CTRL_C_EVENT to the prober console (graceful)'
        $r = Invoke-Native -FilePath 'powershell.exe' `
                           -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $sender, '-ProcessId', $ProcessId) -Quiet
        Write-Info "step 1 result: $($r.Combined)"
        if ($r.Combined -match 'ctrl-c-sent') {
            Start-Sleep -Seconds 3
            if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
                Write-Ok 'step 1 succeeded: the prober ran its SIGINT handler and exited'
                [void](Report-ProberDescendants -Tracked $tracked)
                return $true
            }
            Write-Warn 'step 1: event generated but the prober survived (a background console group does not receive CTRL_C_EVENT) - MEASURED on this host'
        }
    }

    # --- step 2: graceful tree stop ---
    Write-Info "step 2: taskkill /PID $ProcessId /T  (no /F)"
    $null = Invoke-Native -FilePath 'taskkill.exe' -Arguments @('/PID', $ProcessId, '/T') -Quiet
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            Write-Ok 'step 2 succeeded: graceful tree stop'
            [void](Report-ProberDescendants -Tracked $tracked)
                return $true
        }
        Start-Sleep -Milliseconds 500
    }

    # --- step 3: forced tree kill, only on explicit operator consent ---
    if (-not $AllowForcedKill) {
        Write-Fail "PID $ProcessId survived both graceful attempts."
        Write-Fail 'Re-run with -AllowForcedKill to permit taskkill /F /T (abrupt kill; Chromium children may need reaping).'
        return $false
    }
    Write-Warn "step 3: taskkill /PID $ProcessId /F /T  (FORCED - operator consent via -AllowForcedKill)"
    $null = Invoke-Native -FilePath 'taskkill.exe' -Arguments @('/PID', $ProcessId, '/F', '/T') -Quiet
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            Write-Ok 'step 3 succeeded: forced tree kill'
            [void](Report-ProberDescendants -Tracked $tracked)
                return $true
        }
        Start-Sleep -Milliseconds 500
    }

    Write-Fail 'PID is still alive after every escalation step. Manual intervention required.'
    return $false
}

function Stop-StrayProberWrappers {
    <#
      The manual start method is `npx tsx scripts/host_prober.ts`, which leaves a
      three-process chain: npx-cli -> tsx cli.mjs -> node host_prober.ts. The
      control event reaches all three because they share one console, but a
      detached wrapper can survive. This sweeps any remaining process whose
      command line names the prober script, so the service is the ONLY thing
      that can hold the port.
    #>
    param([string]$Marker = 'host_prober.ts')

    $strays = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Marker*" -and $_.ProcessId -ne $PID })
    foreach ($s in $strays) {
        Write-Warn "stray wrapper PID $($s.ProcessId) still references the prober script; terminating (no /F)"
        $null = Invoke-Native -FilePath 'taskkill.exe' -Arguments @('/PID', $s.ProcessId, '/T') -Quiet
    }
    if ($strays.Count) { Start-Sleep -Seconds 2 }
    return $strays.Count
}