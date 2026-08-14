# setup-windows.ps1 — automate what we CAN automate on the operator's machine.
#
# Run from a regular PowerShell (no admin needed for most steps; install of MSVC
# Build Tools needs admin and is NOT included here — that's a GUI step).
#
# What this script does:
#   1. Verifies rustup + cargo are installed and on PATH.
#   2. Ensures ~/.cargo/config.toml has the rsproxy mirror (or creates it).
#   3. Confirms the Cargo.toml alloc_no_stdlib pin is in place.
#   4. Runs `cargo fetch` to download all deps via the mirror.
#
# What this script does NOT do (operator must do manually):
#   - Install Visual Studio Build Tools with "Desktop development with C++"
#     (https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
#   - Run `cargo build` itself — must be from VS Developer Command Prompt.

$ErrorActionPreference = "Stop"

Write-Host "=== eraTW Mod Studio -- Windows setup helper ===" -ForegroundColor Cyan

# --- 1. Rust toolchain ---
Write-Host "`n[1/4] Checking Rust toolchain..." -ForegroundColor Yellow
$rustVersion = (& rustc --version 2>&1) | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Host "rustc not found. Install via https://rustup.rs/" -ForegroundColor Red
    exit 1
}
Write-Host "  $rustVersion" -ForegroundColor Green

# --- 2. Cargo registry mirror ---
Write-Host "`n[2/4] Ensuring ~/.cargo/config.toml has rsproxy mirror..." -ForegroundColor Yellow
$cargoConfig = Join-Path $env:USERPROFILE ".cargo\config.toml"
$desiredMirror = @'

[source.crates-io]
replace-with = 'rsproxy'

[source.rsproxy]
registry = "https://rsproxy.cn/git/crates.io-index"

[registries.rsproxy]
index = "https://rsproxy.cn/git/crates.io-index"

[net]
git-fetch-with-cli = true

[http]
timeout = 120
'@

if (Test-Path $cargoConfig) {
    Write-Host "  config.toml exists at $cargoConfig"
    $existing = Get-Content $cargoConfig -Raw
    if ($existing -notmatch "rsproxy\.cn") {
        Write-Host "  -> Appending rsproxy mirror (existing config preserved)" -ForegroundColor Yellow
        Add-Content -Path $cargoConfig -Value $desiredMirror
    } else {
        Write-Host "  -> rsproxy mirror already configured" -ForegroundColor Green
    }
} else {
    New-Item -Path (Split-Path $cargoConfig) -ItemType Directory -Force | Out-Null
    Set-Content -Path $cargoConfig -Value $desiredMirror
    Write-Host "  -> Created $cargoConfig with rsproxy mirror" -ForegroundColor Green
}

# --- 3. Cargo.toml alloc_no_stdlib pin ---
Write-Host "`n[3/4] Checking Cargo.toml alloc_no_stdlib pin..." -ForegroundColor Yellow
$cargoToml = Join-Path (Get-Location) "Cargo.toml"
if (-not (Test-Path $cargoToml)) {
    Write-Host "  Cargo.toml not found at $cargoToml. Run from web/src-tauri/." -ForegroundColor Red
    exit 1
}
$cargoContent = Get-Content $cargoToml -Raw
if ($cargoContent -notmatch 'alloc_no_stdlib\s*=\s*"=2\.0\.4"') {
    Write-Host "  -> alloc_no_stdlib pin MISSING. Add this line to [dependencies]:" -ForegroundColor Red
    Write-Host '     alloc_no_stdlib = "=2.0.4"' -ForegroundColor Red
} else {
    Write-Host "  -> alloc_no_stdlib pin present" -ForegroundColor Green
}

# --- 4. cargo fetch ---
Write-Host "`n[4/4] Running cargo fetch (downloads all deps via rsproxy)..." -ForegroundColor Yellow
& cargo fetch 2>&1 | Select-Object -First 30
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n  cargo fetch failed. Check network or registry mirror." -ForegroundColor Red
    exit 1
}
Write-Host "`n  cargo fetch succeeded." -ForegroundColor Green

Write-Host "`n=== Setup script done ===" -ForegroundColor Cyan
Write-Host "Next manual steps:" -ForegroundColor Yellow
Write-Host "  1. Install Visual Studio Build Tools (Desktop development with C++ workload)"
Write-Host "     https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022"
Write-Host "  2. Open 'Developer Command Prompt for VS 2022' from Start Menu"
Write-Host "  3. cd to web/src-tauri and run: cargo build"
Write-Host ""
Write-Host "If cargo build still hits 'extra operand' / link errors, you're not in the"
Write-Host "VS Developer Command Prompt -- close cmd and re-open via Start Menu."