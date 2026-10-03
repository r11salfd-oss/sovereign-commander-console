<#
.SYNOPSIS
    Sends a CTRL_C_EVENT to the console of another process group.

.DESCRIPTION
    A console application is stopped gracefully by a console control event, not
    by a window message. `taskkill /PID n` WITHOUT /F only posts WM_CLOSE to
    top-level windows, so it cannot stop a console app that has no window --
    MEASURED on this host, taskkill answered "ERROR: The process with PID n
    could not be terminated" and the prober kept running.

    Node maps CTRL_C_EVENT to SIGINT, and scripts/host_prober.ts installs a
    SIGINT handler that calls handle.close(), which reaps its live MCP and
    Chromium children through the taskkill /T settle path. That is the graceful
    path documented in HOST_PROBER.md section 12.

    This runs in its own short-lived process because FreeConsole/AttachConsole
    would otherwise detach the CALLER from its own console, which breaks any
    further console output.

    Note: CTRL_C_EVENT with process-group 0 is delivered to every process that
    shares the attached console. That is the intent: the prober chain
    (npx-cli -> tsx -> node) shares one console and all three must stop. This
    script masks Ctrl+C for itself with SetConsoleCtrlHandler(NULL, TRUE).

.NOTES
    Chain Key ID: 360ea36c28e66d9d
#>

[CmdletBinding()]
param([Parameter(Mandatory)][int]$ProcessId)

$ErrorActionPreference = 'Stop'

if (-not ('ProberConsoleCtrl' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ProberConsoleCtrl
{
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);

    const uint CTRL_C_EVENT = 0;

    public static string Send(uint pid)
    {
        FreeConsole();
        if (!AttachConsole(pid))
        {
            int e1 = Marshal.GetLastWin32Error();
            FreeConsole();
            return "attach-failed:" + e1;
        }
        // Ignore Ctrl+C in THIS process so it does not kill the sender.
        SetConsoleCtrlHandler(IntPtr.Zero, true);
        bool ok = GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0);
        int err = ok ? 0 : Marshal.GetLastWin32Error();
        // Give the receivers a moment to run their handlers before the console
        // is released.
        System.Threading.Thread.Sleep(750);
        FreeConsole();
        return ok ? "ctrl-c-sent" : ("generate-failed:" + err);
    }
}
'@
}

try {
    Write-Output ([ProberConsoleCtrl]::Send([uint32]$ProcessId))
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}