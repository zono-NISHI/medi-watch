# -*- coding: utf-8 -*-
# 修正内容ファイルを Word ファイル（.docx）に適用して、新しい .docx を作る
# 使い方: python scripts/thesis/apply_edits.py <元.docx> <修正内容.py> <出力.docx>
#
# 修正内容ファイルの中では、次の書き方が使える（d は元の文書）。
#   d.set('元の文章', '新しい文章')            … 段落の文章を差し替える（書式はそのまま）
#   d.set('元の文章の先頭…', '新しい文章')     … 末尾を「…」にすると、先頭が一致する段落を探す
#   d.set('　４.６　古い見出し', '　４.６　新しい見出し', toc=True)  … 目次の行を直す
#   d.after('この段落の後ろに', '書式の見本にする段落', ['足す文章1', '足す文章2'])
#   d.delete('消す段落')
#   d.heading_after('この段落の後ろに', '見本の見出し', '４.１０　新しい見出し', '　目次でこの行の後ろに', '　目次の見本の行')
#   d.table(k, [['セル1', 'セル2', ...], ...])  … k 番目（0 から）の表の、見出し行より下を作り直す
#   文章の中で ⟦…⟧ と囲んだ部分は、黄色の蛍光ペンになる（あとで確認したい箇所の目印）
# 段落は「文章が完全に一致する1つ」で探す。見つからない・2つ以上あるときはエラーで止まる。
import sys

from docedit import Doc, ptext, set_text, strip_ids

if len(sys.argv) != 4:
    sys.exit('使い方: python apply_edits.py <元.docx> <修正内容.py> <出力.docx>')
src, edits, dst = sys.argv[1:]
d = Doc(src)
code = open(edits, encoding='utf-8').read()
try:
    exec(compile(code, edits, 'exec'), {'d': d, 'ptext': ptext, 'set_text': set_text, 'strip_ids': strip_ids})
except AssertionError as e:
    sys.exit(f'修正を適用できませんでした（段落が見つからないか、2つ以上あります）: {e}\n'
             f'python scripts/thesis/dump_docx.py で元の文章を確かめてください。')
d.save(dst)
print('saved', dst)
