# SPDX-FileCopyrightText: 2026 Soft Axiom contributors
# SPDX-License-Identifier: Apache-2.0
param([string]$Installer)
$ErrorActionPreference = 'Stop'
function Invoke-RestMethod {
    param([string]$Uri, [int]$TimeoutSec)
    $Expected = 'https://raw.githubusercontent.com/oojuro/softaxiom/' + ('a' * 40) + '/install.sh'
    if ($Uri -ne $Expected -or $TimeoutSec -ne 60) { throw 'Unpinned installer request.' }
    return "echo synthetic-wsl-transport`n"
}
& $Installer -Revision ('a' * 40) -Sha256 ('b' * 64)
