param(
    [switch]$Probe
)

# Pure PowerShell SMTC album-art grabber. No C#, no csc, no Add-Type:
# PowerShell 5.1 can reach WinRT through reflection on System.Runtime.WindowsRuntime,
# and the raw RCW is turned into a plain System.IO.Stream via WindowsRuntimeStreamExtensions.
# NOTE: this file MUST stay UTF-8 WITH BOM - Windows PowerShell 5.1 decodes BOM-less
# UTF-8 as ANSI and silently eats newlines after multi-byte sequences.

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$diag = New-Object System.Collections.ArrayList
function Note($text) { [void]$diag.Add([string]$text) }

function Fail($reason) {
    Note "reason=$reason"
    foreach ($line in $diag) { [Console]::Error.WriteLine($line) }
    if ($Probe) { [Console]::Out.WriteLine('PROBE_FAIL') }
    exit 1
}

$rtAsm = $null
try { $rtAsm = [System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime') } catch { }
if ($null -eq $rtAsm) { Fail 'system_runtime_windowsruntime_missing' }
Note "rt_asm=ok"

$extType = $rtAsm.GetType('System.WindowsRuntimeSystemExtensions')
if ($null -eq $extType) { Fail 'extensions_type_missing' }
$asTask = ($extType.GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1)
if ($null -eq $asTask) { Fail 'astask_missing' }

$streamExt = $rtAsm.GetType('System.IO.WindowsRuntimeStreamExtensions')
if ($null -eq $streamExt) { Fail 'stream_extensions_missing' }
$asStream = ($streamExt.GetMethods() | Where-Object {
    $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1)
if ($null -eq $asStream) { Fail 'asstream_missing' }

$mgrType = $null
$propType = $null
$streamType = $null
try {
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]
} catch {
    Fail ('winrt_type_fail=' + $_.Exception.Message)
}
if ($null -eq $mgrType -or $null -eq $propType -or $null -eq $streamType) { Fail 'winrt_type_null' }

function Await-WinRT($op, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(8000)) { throw 'winrt_timeout' }
    return $task.GetType().GetProperty('Result').GetGetMethod().Invoke($task, @())
}

$mgr = $null
for ($i = 0; $i -lt 15; $i++) {
    try { $mgr = Await-WinRT ($mgrType::RequestAsync()) $mgrType } catch { }
    if ($null -ne $mgr) { break }
    Start-Sleep -Milliseconds 250
}
if ($null -eq $mgr) { Fail 'manager_unavailable' }

# Pick the session that actually carries metadata: shell overlays such as
# Xbox Game Bar register an empty session and would otherwise win GetCurrentSession().
$session = $null
$chosenApp = ''
try {
    $sessions = $mgr.GetSessions()
    Note ("session_count=" + $sessions.Count)
    foreach ($candidate in $sessions) {
        try {
            $probeProps = Await-WinRT ($candidate.TryGetMediaPropertiesAsync()) $propType
            if ($null -ne $probeProps -and $probeProps.Title.Length -gt 0) {
                $session = $candidate
                $chosenApp = [string]$candidate.SourceAppUserModelId
                break
            }
        } catch { }
    }
    if ($null -eq $session) {
        $session = $mgr.GetCurrentSession()
        if ($null -ne $session) { $chosenApp = [string]$session.SourceAppUserModelId }
    }
} catch {
    Fail ('session_enum_fail=' + $_.Exception.Message)
}
if ($null -eq $session) { Fail 'no_session' }
Note ("chosen=" + $chosenApp)

$props = $null
try { $props = Await-WinRT ($session.TryGetMediaPropertiesAsync()) $propType } catch { Fail ('props_fail=' + $_.Exception.Message) }
if ($null -eq $props) { Fail 'props_null' }
Note ("title=" + $props.Title)

if ($null -eq $props.Thumbnail) {
    # Capability confirmed (we reached WinRT and read properties) - just no artwork right now.
    if ($Probe) {
        Note 'thumbnail_absent_but_pipeline_ok'
        [Console]::Out.WriteLine('PROBE_OK')
        exit 0
    }
    Fail 'thumbnail_null'
}

$stream = $null
try {
    $op = $props.Thumbnail.OpenReadAsync()
    $stream = Await-WinRT $op $streamType
} catch {
    Fail ('open_fail=' + $_.Exception.Message)
}
if ($null -eq $stream) { Fail 'stream_null' }

$netStream = $null
try { $netStream = $asStream.Invoke($null, @($stream)) } catch { Fail ('asstream_fail=' + $_.Exception.Message) }
if ($null -eq $netStream) { Fail 'asstream_null' }

$bytes = $null
try {
    $limit = 4194304
    $length = 0
    try { $length = [int64]$netStream.Length } catch { $length = 0 }
    Note ("stream_length=" + $length)
    if ($length -gt $limit) { Fail 'artwork_too_large' }
    $ms = New-Object System.IO.MemoryStream
    $netStream.CopyTo($ms)
    $bytes = $ms.ToArray()
    $ms.Dispose()
} catch {
    Fail ('read_fail=' + $_.Exception.Message)
}
if ($null -eq $bytes -or $bytes.Length -eq 0) { Fail 'empty_artwork' }

$b64 = [Convert]::ToBase64String($bytes)
Note ("bytes=" + $bytes.Length)

if ($Probe) {
    [Console]::Out.WriteLine('PROBE_OK')
    exit 0
}

[Console]::Out.WriteLine($b64)
exit 0
