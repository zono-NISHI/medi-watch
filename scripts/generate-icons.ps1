# ============================================================
#  アプリアイコンの生成スクリプト
#  図柄: 藍色の地に、紙色の時計の文字盤（服薬時刻・見守り）と
#        テラコッタ／藍のカプセル（お薬）を重ねたもの
#  使い方（リポジトリのルートで）:
#    powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
#  出力:
#    public/assets/        Web 版（PWA・ファビコン・通知）のアイコン
#    mobile/android/.../res/mipmap-*/  Android 版のランチャーアイコン
#  Node や画像編集ソフトがなくても動くよう、Windows 標準の System.Drawing で描く
# ============================================================

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

# 配色（public/css/base.css と合わせる）
$INDIGO     = [System.Drawing.ColorTranslator]::FromHtml('#2c4a52')
$PAPER      = [System.Drawing.ColorTranslator]::FromHtml('#fbf7f0')
$TERRACOTTA = [System.Drawing.ColorTranslator]::FromHtml('#d97d54')

# 角丸四角形のパス
function New-RoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# 1枚描いて保存する
#   $bg    : 'square'（全面）/ 'rounded'（角丸）/ 'circle'（円）/ 'none'（透明）
#   $scale : 図柄の大きさ（1.0 で文字盤の半径がキャンバスの 0.36）
#   $mono  : $true なら白一色のカプセルだけ（通知のバッジ用）
function Save-Icon([string]$path, [int]$size, [string]$bg, [float]$scale, [bool]$mono = $false) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $S = [float]$size
  $c = $S / 2
  $indigoBrush = New-Object System.Drawing.SolidBrush($INDIGO)

  switch ($bg) {
    'square'  { $g.FillRectangle($indigoBrush, 0, 0, $S, $S) }
    'rounded' { $p = New-RoundRectPath 0 0 $S $S ($S * 0.22); $g.FillPath($indigoBrush, $p); $p.Dispose() }
    'circle'  { $g.FillEllipse($indigoBrush, 0, 0, $S, $S) }
  }

  $u = $S * $scale   # 図柄の基準の長さ

  if (-not $mono) {
    # 文字盤
    $dialR = 0.36 * $u
    $paperBrush = New-Object System.Drawing.SolidBrush($PAPER)
    $g.FillEllipse($paperBrush, $c - $dialR, $c - $dialR, $dialR * 2, $dialR * 2)
    $paperBrush.Dispose()

    # 12・3・6・9 時の目盛り
    $tickPen = New-Object System.Drawing.Pen($INDIGO, [float](0.035 * $u))
    $tickPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tickPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $r1 = 0.275 * $u; $r2 = 0.315 * $u
    foreach ($deg in 0, 90, 180, 270) {
      $rad = $deg * [Math]::PI / 180
      $dx = [Math]::Cos($rad); $dy = [Math]::Sin($rad)
      $g.DrawLine($tickPen, [float]($c + $dx * $r1), [float]($c + $dy * $r1), [float]($c + $dx * $r2), [float]($c + $dy * $r2))
    }
    $tickPen.Dispose()
  }

  # カプセル（右上がり 45 度）
  if ($mono) { $len = 0.80 * $S; $wid = 0.34 * $S } else { $len = 0.46 * $u; $wid = 0.19 * $u }
  $state = $g.Save()
  $g.TranslateTransform($c, $c)
  $g.RotateTransform(-45)
  $half = $len / 2
  $rad = $wid / 2
  $capsule = New-RoundRectPath (-$half) (-$rad) $len $wid $rad

  if ($mono) {
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPath($white, $capsule)
    # 継ぎ目を透明に抜く
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $clear = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
    $g.FillRectangle($clear, [float](-0.025 * $S), [float](-$rad - 1), [float](0.05 * $S), [float]($wid + 2))
    $clear.Dispose(); $white.Dispose()
  } else {
    # 左下半分（藍）と右上半分（テラコッタ）
    $g.SetClip((New-Object System.Drawing.RectangleF((-$half - 1), (-$rad - 1), ($half + 1), ($wid + 2))))
    $g.FillPath($indigoBrush, $capsule)
    $g.SetClip((New-Object System.Drawing.RectangleF(0, (-$rad - 1), ($half + 1), ($wid + 2))))
    $tBrush = New-Object System.Drawing.SolidBrush($TERRACOTTA)
    $g.FillPath($tBrush, $capsule)
    $tBrush.Dispose()
    $g.ResetClip()
    # 継ぎ目
    $seamPen = New-Object System.Drawing.Pen($PAPER, [float](0.018 * $u))
    $g.DrawLine($seamPen, [float]0, [float](-$rad), [float]0, [float]$rad)
    $seamPen.Dispose()
    # つやの線
    $hlPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 255, 255, 255), [float](0.022 * $u))
    $hlPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $hlPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($hlPen, [float](0.05 * $u), [float](-$rad * 0.5), [float]($half - $rad * 0.9), [float](-$rad * 0.5))
    $hlPen.Dispose()
  }
  $capsule.Dispose()
  $g.Restore($state)

  $indigoBrush.Dispose()
  $g.Dispose()
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "作成: $path"
}

# ---------- Web 版 ----------
$web = Join-Path $root 'public/assets'
Save-Icon (Join-Path $web 'icon-192.png') 192 'rounded' 1.0
Save-Icon (Join-Path $web 'icon-512.png') 512 'rounded' 1.0
# maskable: 端末側で丸や角丸に切り抜かれるので、全面を塗り、図柄は安全領域（中央 80%）に収める
Save-Icon (Join-Path $web 'icon-maskable-512.png') 512 'square' 0.95
Save-Icon (Join-Path $web 'apple-touch-icon.png') 180 'square' 1.0
Save-Icon (Join-Path $web 'favicon-32.png') 32 'rounded' 1.05
# 通知のバッジ（Android のステータスバー用。白一色＋透明）
Save-Icon (Join-Path $web 'badge-96.png') 96 'none' 1.0 $true

# ---------- Android 版 ----------
$res = Join-Path $root 'mobile/android/app/src/main/res'
$densities = @{ 'mdpi' = 1.0; 'hdpi' = 1.5; 'xhdpi' = 2.0; 'xxhdpi' = 3.0; 'xxxhdpi' = 4.0 }
foreach ($d in $densities.Keys) {
  $m = $densities[$d]
  $dir = Join-Path $res "mipmap-$d"
  # Android 7.1 以前用（48dp）
  Save-Icon (Join-Path $dir 'ic_launcher.png') ([int](48 * $m)) 'rounded' 0.95
  Save-Icon (Join-Path $dir 'ic_launcher_round.png') ([int](48 * $m)) 'circle' 0.9
  # Android 8 以降のアダプティブアイコンの前景（108dp。背景色は values/ic_launcher_background.xml）
  # 切り抜かれても欠けないよう、図柄は中央 66dp の安全領域に収める
  Save-Icon (Join-Path $dir 'ic_launcher_foreground.png') ([int](108 * $m)) 'none' 0.8
}
