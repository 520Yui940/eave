$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit($obj) {
    try {
        [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3))
        [Console]::Out.Flush()
    } catch { }
}

function Read-NetTotals {
    $rx = [double]0
    $tx = [double]0
    try {
        $ifaces = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()
        foreach ($i in $ifaces) {
            if ($i.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
            $t = $i.NetworkInterfaceType
            if ($t -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }
            if ($t -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel) { continue }
            try {
                $v4 = $i.GetIPv4Statistics()
                $rx += $v4.BytesReceived
                $tx += $v4.BytesSent
            } catch { }
            try {
                $v6 = $i.GetIPv6Statistics()
                $rx += $v6.BytesReceived
                $tx += $v6.BytesSent
            } catch { }
        }
    } catch { }
    return @{ rx = $rx; tx = $tx }
}

$rtAsm = $null
try { $rtAsm = [System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime') } catch { }

$mgrType = $null
$propType = $null
$asTask = $null
if ($null -ne $rtAsm) {
    try {
        $extType = $rtAsm.GetType('System.WindowsRuntimeSystemExtensions')
        $asTask = ($extType.GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]
        $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
        $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    } catch {
        $asTask = $null
    }
}

function Await-WinRT($op, $type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $t.Wait(6000)) { throw 'winrt_timeout' }
    return $t.GetType().GetProperty('Result').GetGetMethod().Invoke($t, @())
}

$mgr = $null
if ($null -ne $asTask) {
    for ($i = 0; $i -lt 20; $i++) {
        try { $mgr = Await-WinRT ($mgrType::RequestAsync()) $mgrType } catch { }
        if ($null -ne $mgr) { break }
        Start-Sleep -Milliseconds 300
    }
}

Emit @{ ok = $true; event = 'ready'; media = ($null -ne $mgr) }

$prevMediaKey = ''
$prevNet = $null
$prevNetTicks = [long]0
$netCounter = 0
$netEvery = 3
$mediaActive = $false

while ($true) {
    $payload = $null
    $hasSession = $false

    if ($null -ne $mgr) {
        try {
            # 优先挑真正带元数据的会话：Xbox Game Bar 这类空壳会话会长期霸占
            # GetCurrentSession()，导致标题一直是空的
            $s = $null
            foreach ($candidate in $mgr.GetSessions()) {
                try {
                    $probe = Await-WinRT ($candidate.TryGetMediaPropertiesAsync()) $propType
                    if ($null -ne $probe -and $probe.Title.Length -gt 0) { $s = $candidate; break }
                } catch { }
            }
            if ($null -eq $s) { $s = $mgr.GetCurrentSession() }
            if ($null -ne $s) {
                $hasSession = $true
                $props = Await-WinRT ($s.TryGetMediaPropertiesAsync()) $propType
                $info = $s.GetPlaybackInfo()
                $timeline = $s.GetTimelineProperties()
                $controls = $info.Controls
                $payload = @{
                    ok           = $true
                    type         = 'media'
                    available    = $true
                    sourceAppId  = [string]$s.SourceAppUserModelId
                    title        = [string]$props.Title
                    artist       = [string]$props.Artist
                    album        = [string]$props.AlbumTitle
                    status       = [string]$info.PlaybackStatus
                    position     = [math]::Round($timeline.Position.TotalSeconds, 2)
                    duration     = [math]::Round($timeline.EndTime.TotalSeconds, 2)
                    canNext      = [bool]$controls.IsNextEnabled
                    canPrev      = [bool]$controls.IsPreviousEnabled
                    canPlayPause = [bool]$controls.IsPlayPauseToggleEnabled
                }
            } else {
                $payload = @{ ok = $true; type = 'media'; available = $false }
            }
        } catch {
            $payload = @{ ok = $true; type = 'media'; available = $false }
        }
    } else {
        $payload = @{ ok = $true; type = 'media'; available = $false }
    }

    # 有些会话（典型是 Xbox Game Bar 这类壳）会注册一个「有会话但没标题」的空壳，
    # 展示出来只会变成一句没头没尾的「正在播放」，直接当作没有媒体。
    if ($payload.available -and [string]::IsNullOrWhiteSpace([string]$payload.title)) {
        $payload = @{ ok = $true; type = 'media'; available = $false }
    }

    if ($payload.available) {
        # 位置按整秒入 key，避免每 350ms 的亚秒抖动都触发一次 IPC
        $sec = [math]::Floor($payload.position)
        $key = "$($payload.title)|$($payload.artist)|$($payload.status)|$sec|$($payload.duration)|$($payload.sourceAppId)"
    } else {
        $key = '__none__'
    }

    if ($key -ne $prevMediaKey) {
        $prevMediaKey = $key
        Emit $payload
    }

    $mediaActive = ($payload.available -and ($payload.status -eq 'Playing'))

    $netCounter += 1
    if ($netCounter -ge $netEvery) {
        $netCounter = 0
        $cur = Read-NetTotals
        $nowTicks = [DateTime]::UtcNow.Ticks
        if ($null -ne $prevNet -and $prevNetTicks -gt 0) {
            $elapsed = ($nowTicks - $prevNetTicks) / 10000000.0
            if ($elapsed -gt 0) {
                $d = $cur.rx - $prevNet.rx
                $u = $cur.tx - $prevNet.tx
                if ($d -lt 0) { $d = [double]0 }
                if ($u -lt 0) { $u = [double]0 }
                Emit @{
                    ok   = $true
                    type = 'net'
                    down = [int][math]::Round($d / $elapsed)
                    up   = [int][math]::Round($u / $elapsed)
                }
            }
        }
        $prevNet = $cur
        $prevNetTicks = $nowTicks
    }

    if ($mediaActive) {
        Start-Sleep -Milliseconds 350
    } else {
        Start-Sleep -Milliseconds 900
    }
}
