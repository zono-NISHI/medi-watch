# -*- coding: utf-8 -*-
# Word ファイル（.docx）の文章を、段落ごとに番号つきで書き出す
# 使い方: python scripts/thesis/dump_docx.py <ファイル.docx>
#   P  = 本文の段落（見出しは [見出し1] などと付く）
#   目次 = 目次の行
#   表k = k 番目（0 から）の表。行ごとにセルを「 | 」で区切って出す
# 修正内容ファイルで段落を指定するときは、ここに出た文章（の先頭）をそのまま使う
import io
import re
import sys

from docedit import Doc, ptext

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = Doc(sys.argv[1])
k = 0
for b in d.blocks:
    if b.startswith('<w:tbl>'):
        for r, tr in enumerate(re.findall(r'<w:tr[ >].*?</w:tr>', b, flags=re.S)):
            cells = [ptext(c) for c in re.findall(r'<w:tc>.*?</w:tc>', tr, flags=re.S)]
            print(f'表{k} 行{r}\t' + ' | '.join(cells))
        k += 1
    elif b.startswith('<w:p'):
        t = ptext(b)
        if not t:
            continue
        st = re.search(r'<w:pStyle w:val="([123])"', b)
        kind = '目次' if 'PAGEREF' in b else (f'[見出し{st.group(1)}]' if st else 'P')
        print(f'{kind}\t{t}')
