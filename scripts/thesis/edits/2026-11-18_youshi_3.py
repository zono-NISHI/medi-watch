# -*- coding: utf-8 -*-
# 卒業論文要旨：表題部分の学籍番号の位置と書き方を、要旨集（2025youshi.pdf の218ページ）の見本に合わせた修正内容（記録）
# 元にしたファイル: docs/卒論(参考資料)/卒業論文発表当日に提出したもの_11月18日(大学の掲示板)/卒業論文発表後に提出したもの/2370354_西薗正彦_卒業論文要旨.docx
# 使い方: python scripts/thesis/apply_edits.py <元.docx> <このファイル> <出力.docx>
# 変更点:
#   ・「指導教員：高井　那美」と同じ行（左の中央）にあった学籍番号を、その下の行（「西薗　正彦」の上・中央）へ移す
#   ・学籍番号「２ ３ ７ ０ ３ ５ ４」は全角のまま、数字の間のスペースを無くして「２３７０３５４」にする
# ※ set_text では段落のタブが消えるため、段落の XML を直接組み立てる
import re

RUN_ALL = re.compile(r'<w:r[ >].*?</w:r>', re.S)

i = d.find('２ ３ ７ ０ ３ ５ ４指導教員：高井　那美')
p = d.blocks[i]
runs = list(RUN_ALL.finditer(p))
lead_tab = runs[0].group(0)      # 中央のタブ位置へ進むタブ
num_run = runs[1].group(0)       # 学籍番号の書式（ＭＳ 明朝・8.5pt）の見本
teacher = runs[-1].group(0)      # タブ ＋「指導教員：高井　那美」
assert '指導教員' in teacher and '<w:tab/>' in lead_tab and '２' in num_run

head = p[:runs[0].start()]
tail = p[runs[-1].end():]

# 1行目: 「鹿児島教育センター」の行と同じく、タブ2つで右側に「指導教員：高井　那美」
teacher_p = head + lead_tab + teacher + tail
# 2行目: 中央のタブ位置に学籍番号（スペースなし）
num_p = strip_ids(head + lead_tab + set_text(num_run, '２３７０３５４') + tail)

d.blocks[i:i + 1] = [teacher_p, num_p]
