param([string]$AssetDirectory = (Join-Path $PSScriptRoot 'public\assets'))

Add-Type -AssemblyName System.Drawing

foreach ($file in Get-ChildItem -LiteralPath $AssetDirectory -Filter '*-cover.png' -File) {
    $source = [System.Drawing.Bitmap]::FromFile($file.FullName)
    try {
        $bitmap = New-Object System.Drawing.Bitmap $source.Width, $source.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.DrawImageUnscaled($source, 0, 0) } finally { $graphics.Dispose() }
    } finally { $source.Dispose() }

    $background = $bitmap.GetPixel(0, 0)
    $seen = New-Object 'bool[]' ($bitmap.Width * $bitmap.Height)
    $queue = New-Object 'System.Collections.Generic.Queue[int]'
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
        $queue.Enqueue($x)
        $queue.Enqueue((($bitmap.Height - 1) * $bitmap.Width) + $x)
    }
    for ($y = 1; $y -lt ($bitmap.Height - 1); $y++) {
        $queue.Enqueue($y * $bitmap.Width)
        $queue.Enqueue(($y * $bitmap.Width) + $bitmap.Width - 1)
    }

    while ($queue.Count) {
        $index = $queue.Dequeue()
        if ($seen[$index]) { continue }
        $seen[$index] = $true
        $x = $index % $bitmap.Width
        $y = [math]::Floor($index / $bitmap.Width)
        $pixel = $bitmap.GetPixel($x, $y)
        $distance = [math]::Sqrt(
            [math]::Pow($pixel.R - $background.R, 2) +
            [math]::Pow($pixel.G - $background.G, 2) +
            [math]::Pow($pixel.B - $background.B, 2)
        )
        if ($distance -gt 22) { continue }
        $alpha = if ($distance -le 10) { 0 } else { [int](255 * (($distance - 10) / 12)) }
        $bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $pixel.R, $pixel.G, $pixel.B))
        if ($x -gt 0) { $queue.Enqueue($index - 1) }
        if ($x + 1 -lt $bitmap.Width) { $queue.Enqueue($index + 1) }
        if ($y -gt 0) { $queue.Enqueue($index - $bitmap.Width) }
        if ($y + 1 -lt $bitmap.Height) { $queue.Enqueue($index + $bitmap.Width) }
    }

    try { $bitmap.Save($file.FullName, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
    Write-Output $file.Name
}
