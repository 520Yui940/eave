# Eave GPU sampler. Emits JSON lines: {"ok":true,"type":"gpu","value":<0-100>}
# Started on demand by the game-mode mini bar, killed when it deactivates.
# Keep this file ASCII only (PowerShell 5.1 reads BOM-less UTF-8 as GBK).
$ErrorActionPreference = 'SilentlyContinue'

function Emit($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
}

Emit @{ ok = $true; type = 'gpu'; event = 'ready' }

$cat = $null
try {
    $cat = New-Object System.Diagnostics.PerformanceCounterCategory('GPU Engine')
} catch {
    Emit @{ ok = $false; type = 'gpu'; error = 'no_gpu_category' }
    exit 1
}

# First NextValue() after creation returns 0 (no baseline) - warm up once.
$instanceKey = ''
$counters = @()
while ($true) {
    try {
        $instances = $cat.GetInstanceNames()
        $key = ($instances | Sort-Object) -join '|'
        if ($key -ne $instanceKey) {
            # Engine instances churn as processes start/stop; rebuild only on change.
            $instanceKey = $key
            $counters = @()
            foreach ($inst in $instances) {
                try {
                    $c = New-Object System.Diagnostics.PerformanceCounter('GPU Engine', 'Utilization Percentage', $inst, $true)
                    $c.NextValue() | Out-Null
                    $counters += $c
                } catch { }
            }
            Start-Sleep -Milliseconds 400
        }
        $sum = 0.0
        foreach ($c in $counters) {
            try {
                $v = $c.NextValue()
                if ($v -gt 0) { $sum += $v }
            } catch { }
        }
        Emit @{ ok = $true; type = 'gpu'; value = [math]::Round([math]::Min(100.0, $sum), 1) }
    } catch { }
    Start-Sleep -Milliseconds 1000
}
