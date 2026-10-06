# Install SimplySign Desktop and log it in to Certum's cloud, so the code signing
# certificate appears in the user's certificate store, then hand its thumbprint
# and the x64 signtool to the steps that follow, through GITHUB_ENV.
# usage: pwsh packaging/windows/simplysign-login.ps1
# Reads SIMPLYSIGN_EMAIL and SIMPLYSIGN_OTPAUTH_URI. The seed and the one-time
# code are never written out.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Version = '9.4.4.92'
$Installer = "https://files.certum.eu/software/SimplySignDesktop/Windows/$Version/SimplySignDesktop-$Version-64-bit-en.msi"
$App = 'C:\Program Files\Certum\SimplySign Desktop\SimplySignDesktop.exe'
$CodeSigning = '1.3.6.1.5.5.7.3.3'

function Say([string]$Message) {
    Write-Host ''
    Write-Host "== $Message =="
}

function Fail([string]$Message) {
    Write-Host "FAIL: $Message"
    exit 1
}

function ConvertFrom-Base32([string]$Text) {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    $bytes = [System.Collections.Generic.List[byte]]::new()
    $buffer = 0
    $bits = 0
    foreach ($char in $Text.ToUpperInvariant().TrimEnd('=').ToCharArray()) {
        $index = $alphabet.IndexOf($char)
        if ($index -lt 0) { Fail 'the seed is not Base32.' }
        $buffer = ($buffer -shl 5) -bor $index
        $bits += 5
        if ($bits -ge 8) {
            $bits -= 8
            $bytes.Add([byte](($buffer -shr $bits) -band 0xFF))
            $buffer = $buffer -band ((1 -shl $bits) - 1)
        }
    }
    return , $bytes.ToArray()
}

# The one-time code of RFC 6238 for one moment, given in Unix seconds.
function Get-Totp([byte[]]$Key, [string]$Algorithm, [int]$Digits, [int]$Period, [long]$UnixTime) {
    $counter = [BitConverter]::GetBytes([long][Math]::Floor($UnixTime / $Period))
    [Array]::Reverse($counter)
    $hmac = switch ($Algorithm) {
        'SHA1' { [System.Security.Cryptography.HMACSHA1]::new($Key) }
        'SHA256' { [System.Security.Cryptography.HMACSHA256]::new($Key) }
        'SHA512' { [System.Security.Cryptography.HMACSHA512]::new($Key) }
        default { Fail "the seed names the algorithm '$Algorithm'." }
    }
    $hash = $hmac.ComputeHash($counter)
    $offset = [int]$hash[$hash.Length - 1] -band 0x0F
    $binary = (([int]$hash[$offset] -band 0x7F) -shl 24) -bor ([int]$hash[$offset + 1] -shl 16) -bor ([int]$hash[$offset + 2] -shl 8) -bor [int]$hash[$offset + 3]
    return ($binary % [long][Math]::Pow(10, $Digits)).ToString().PadLeft($Digits, '0')
}

# One field of the otpauth:// URI's query, or the default when it has none.
function Get-SeedField([string]$Name, [string]$Default) {
    if ($env:SIMPLYSIGN_OTPAUTH_URI -match "[?&]$Name=([^&]+)") { return [Uri]::UnescapeDataString($Matches[1]) }
    return $Default
}

function Get-LoginWindow {
    Get-Process | Where-Object { $_.MainWindowTitle -like '*SimplySign*' } | Select-Object -First 1
}

function Get-SigningCertificate {
    $usage = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
    Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Issuer -like '*Certum*' -and ($_.Extensions | Where-Object { $_ -is $usage }).EnhancedKeyUsages.Value -contains $CodeSigning } |
        Select-Object -First 1
}

# A wrong code is a refused login, and Certum counts those, so the arithmetic
# is checked against the published vectors of RFC 4648 and RFC 6238 first.
$ascii = [System.Text.Encoding]::ASCII
if ($ascii.GetString((ConvertFrom-Base32 'MZXW6YTBOI======')) -ne 'foobar' -or
    (Get-Totp $ascii.GetBytes('12345678901234567890') 'SHA1' 8 30 59) -ne '94287082' -or
    (Get-Totp $ascii.GetBytes('12345678901234567890123456789012') 'SHA256' 8 30 59) -ne '46119246') {
    Fail 'the one-time code arithmetic does not reproduce the RFC test vectors.'
}

if (-not $env:SIMPLYSIGN_EMAIL) { Fail 'SIMPLYSIGN_EMAIL is not set.' }
if ($env:SIMPLYSIGN_OTPAUTH_URI -notlike 'otpauth://totp/*') { Fail 'SIMPLYSIGN_OTPAUTH_URI is not an otpauth://totp/ URI.' }
$seed = (Get-SeedField 'secret' '') -replace '[\s-]', ''
if (-not $seed) { Fail 'SIMPLYSIGN_OTPAUTH_URI carries no secret.' }
Write-Host "::add-mask::$seed"
$key = ConvertFrom-Base32 $seed
$algorithm = (Get-SeedField 'algorithm' 'SHA1').ToUpperInvariant() -replace '-', ''
$digits = [int](Get-SeedField 'digits' '6')
$period = [int](Get-SeedField 'period' '30')

Say '[1/4] install SimplySign Desktop'
if (-not (Test-Path -LiteralPath $App)) {
    $msi = Join-Path $env:RUNNER_TEMP 'SimplySignDesktop.msi'
    Invoke-WebRequest -Uri $Installer -OutFile $msi
    $install = Start-Process -FilePath msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait -PassThru
    if ($install.ExitCode -notin 0, 3010) { Fail "msiexec exited with $($install.ExitCode)." }
    if (-not (Test-Path -LiteralPath $App)) { Fail "the installer left no $App." }
}
Write-Host "  $App"

Say '[2/4] open the login window'
(New-Object -ComObject Shell.Application).MinimizeAll()
# The first launch starts the tray program, and a later one raises its login
# window.
$window = $null
foreach ($launch in 1..10) {
    Start-Process -FilePath $App
    Start-Sleep -Seconds 3
    $window = Get-LoginWindow
    if ($window) { break }
}
if (-not $window) { Fail 'the SimplySign Desktop login window did not appear.' }
Write-Host "  $($window.MainWindowTitle)"

Say '[3/4] log in'
# A code is typed only with 15 seconds or more left in its period, so it is
# still good when Certum reads it.
$left = $period - ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % $period)
if ($left -lt 15) { Start-Sleep -Seconds ($left + 1) }
$code = Get-Totp $key $algorithm $digits $period ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
# The window opens with the cursor in the email field, and the code field is
# one Tab on. SendKeys reads + ^ % ~ ( ) { } [ ] as commands, so the email's
# own are braced.
$keys = New-Object -ComObject WScript.Shell
$keys.AppActivate($window.Id) | Out-Null
Start-Sleep -Milliseconds 500
foreach ($stroke in '^a', ($env:SIMPLYSIGN_EMAIL -replace '([+^%~(){}\[\]])', '{$1}'), '{TAB}', '^a', $code, '{ENTER}') {
    $keys.SendKeys($stroke)
    Start-Sleep -Milliseconds 200
}
Write-Host '  submitted'

Say '[4/4] certificate'
$certificate = $null
foreach ($poll in 1..30) {
    $certificate = Get-SigningCertificate
    if ($certificate) { break }
    Start-Sleep -Seconds 3
}
if (-not $certificate) {
    if (Get-LoginWindow) { Fail 'no certificate, and the login window is still open: SimplySign refused the email or the code.' }
    Fail 'no certificate, though the login window closed: the SimplySign account offers no code signing certificate.'
}
# The x64 signtool on every machine: the SimplySign driver is x64.
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' | Sort-Object FullName | Select-Object -Last 1
if (-not $signtool) { Fail 'no x64 signtool.exe in the Windows SDK.' }
Add-Content -LiteralPath $env:GITHUB_ENV -Value "HQPTUNER_SIGN_THUMBPRINT=$($certificate.Thumbprint)"
Add-Content -LiteralPath $env:GITHUB_ENV -Value "HQPTUNER_SIGNTOOL=$($signtool.FullName)"
Write-Host "  $($certificate.Subject), valid to $($certificate.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "  $($signtool.FullName)"
