# SPDX-FileCopyrightText: 2026 Soft Axiom contributors
# SPDX-License-Identifier: Apache-2.0
param(
    [string]$Revision = '',
    [string]$Sha256 = ''
)
& {
    param([string]$Revision, [string]$Sha256)
    $ErrorActionPreference = 'Stop'
    if ($Revision -cnotmatch '^[a-f0-9]{40}$' -or $Sha256 -cnotmatch '^[a-f0-9]{64}$') {
        throw 'An exact reviewed Revision and Sha256 pair is required.'
    }
    $Wsl = Get-Command wsl.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $Wsl) {
        throw 'This preview requires WSL2. Install WSL2 and a Linux distribution first, then rerun this command. Native Windows is not supported yet.'
    }
    # The immutable script and the source archive use the same reviewed revision.
    $Url = "https://raw.githubusercontent.com/oojuro/softaxiom/$Revision/install.sh"
    $Installer = Invoke-RestMethod -Uri $Url -TimeoutSec 60
    if ($Installer -isnot [string] -or $Installer.Length -gt 65536) {
        throw 'Invalid installer response.'
    }
    Write-Host 'Installing Soft Axiom inside your default WSL2 distribution as its normal user.'
    Write-Host 'Node 22.19+, npm, curl, tar, sha256sum and flock must be installed inside WSL2.'
    $Start = New-Object System.Diagnostics.ProcessStartInfo
    $Start.FileName = $Wsl.Source
    $Start.Arguments = "--exec bash -s -- --version $Revision --sha256 $Sha256"
    $Start.UseShellExecute = $false
    $Start.RedirectStandardInput = $true
    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $Start
    try {
        if (-not $Process.Start()) { throw 'Could not start WSL2.' }
        $Process.StandardInput.Write($Installer.Replace("`r`n", "`n"))
        $Process.StandardInput.Close()
        $Process.WaitForExit()
        if ($Process.ExitCode -ne 0) { throw "WSL2 installation failed (exit $($Process.ExitCode))." }
        Write-Host 'Run softaxiom from your WSL2 shell. Windows files, profiles and credentials were not copied.'
    } finally {
        $Process.Dispose()
    }
} $Revision $Sha256
