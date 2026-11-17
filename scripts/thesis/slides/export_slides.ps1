# スライドを1枚ずつ PNG に書き出す（見た目の確認用）
# 使い方: powershell -File export_slides.ps1 -Pptx <発表.pptx> -OutDir <書き出し先フォルダ>
param([Parameter(Mandatory = $true)][string]$Pptx, [Parameter(Mandatory = $true)][string]$OutDir)
$Pptx = (Resolve-Path $Pptx).Path
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
# PowerPoint は「ST2023~1」のような短い形式のパスへ書き出せないことがあるので、長い形式に直す
Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern int GetLongPathName(string s, System.Text.StringBuilder l, int n);'
$sb = New-Object System.Text.StringBuilder 1024
if ([W.P]::GetLongPathName($OutDir, $sb, 1024) -gt 0) { $OutDir = $sb.ToString() }
Get-ChildItem $OutDir -Filter 'slide-*.png' | Remove-Item -Confirm:$false
$app = New-Object -ComObject PowerPoint.Application
# 開発者がすでに PowerPoint を開いているときは、その PowerPoint を終了させない
$mine = ($app.Presentations.Count -eq 0)
try {
  $p = $app.Presentations.Open($Pptx, -1, 0, 0)   # 読み取り専用・ウィンドウなし
  foreach ($s in $p.Slides) { $s.Export((Join-Path $OutDir ('slide-{0:d2}.png' -f $s.SlideIndex)), 'PNG', 1600, 900) }
  "slides=" + $p.Slides.Count
  $p.Close()
} finally { if ($mine) { $app.Quit() } }
