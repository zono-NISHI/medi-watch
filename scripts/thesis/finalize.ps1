# Word ファイルの仕上げ：目次のページ番号を更新して保存し、ページ数を表示する
# 使い方: powershell -ExecutionPolicy Bypass -File scripts/thesis/finalize.ps1 -Docx <ファイル.docx>[,<ファイル2.docx>] [-Pdf]
#   -Pdf を付けると、同じフォルダに PDF も書き出す
# 注意: 対象のファイルを Word で開いたままだと保存できない。先に閉じておくこと。
param([Parameter(Mandatory = $true)][string[]]$Docx, [switch]$Pdf)

$paths = @()
# 「-File」で呼ぶと「a.docx,b.docx」が1つの文字列で届くので、カンマで分ける
foreach ($f in ($Docx | ForEach-Object { $_ -split ',' } | Where-Object { $_ })) {
  if (-not (Test-Path -LiteralPath $f)) { Write-Output "ファイルがありません: $f"; exit 1 }
  $p = (Resolve-Path -LiteralPath $f).Path
  try { $fs = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $fs.Close() }
  catch { Write-Output "開けません（Word で開いたままではありませんか）: $p"; exit 1 }
  $paths += $p
}

$word = New-Object -ComObject Word.Application
# 開発者がすでに Word で別の文書を開いているときは、その Word を終了させない
$mine = ($word.Documents.Count -eq 0)
if ($mine) { $word.Visible = $false; $word.DisplayAlerts = 0 }
try {
  foreach ($p in $paths) {
    $d = $word.Documents.Open($p)
    # ページ割りが落ち着くまで2回更新する（目次の行数が変わると、ページ番号がずれるため）
    $d.Repaginate(); [void]$d.Fields.Update(); $d.Repaginate(); [void]$d.Fields.Update()
    Write-Output ("{0}  ページ数={1}" -f (Split-Path $p -Leaf), $d.ComputeStatistics(2))
    $d.Save()
    if ($Pdf) { $d.ExportAsFixedFormat([IO.Path]::ChangeExtension($p, '.pdf'), 17) }
    $d.Close($false)
  }
} finally { if ($mine) { $word.Quit() } }
