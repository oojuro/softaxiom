# SPDX-FileCopyrightText: 2026 Soft Axiom contributors
# SPDX-License-Identifier: Apache-2.0
param([string]$Installer, [switch]$Tamper)
$ErrorActionPreference = 'Stop'
function Invoke-RestMethod {
    param([string]$Uri, [int]$TimeoutSec)
    $Expected = 'https://raw.githubusercontent.com/oojuro/softaxiom/' + ('a' * 40) + '/install.sh'
    if ($Uri -ne $Expected -or $TimeoutSec -ne 60) { throw 'Unpinned installer request.' }
    if ($Tamper) { return 'unverified replacement' }
    return "echo synthetic-wsl-transport`n"
}
$Hasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $Hash = -join ($Hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("echo synthetic-wsl-transport`n")) | ForEach-Object { $_.ToString('x2') })
} finally { $Hasher.Dispose() }
& $Installer -Revision ('a' * 40) -Sha256 ('b' * 64) -ScriptSha256 $Hash
