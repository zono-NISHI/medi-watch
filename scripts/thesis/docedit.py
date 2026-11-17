# -*- coding: utf-8 -*-
# docx の document.xml を、書式を保ったまま書き換えるための小さな道具
import re
import zipfile

RUN = re.compile(r'<w:r[ >].*?</w:r>', re.S)
WT = re.compile(r'<w:t[ >].*?</w:t>', re.S)
HL = '<w:highlight w:val="yellow"/>'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def unesc(s):
    return s.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')


def ptext(p):
    return unesc(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', p)))


def strip_ids(xml):
    xml = re.sub(r' w14:paraId="[^"]*"| w14:textId="[^"]*"', '', xml)
    xml = re.sub(r'<w:bookmarkStart [^>]*/>|<w:bookmarkEnd [^>]*/>', '', xml)
    return xml.replace('<w:lastRenderedPageBreak/>', '')


def _mkrun(tpl, seg, hl):
    first = [True]

    def rep(m):
        if first[0]:
            first[0] = False
            return '<w:t xml:space="preserve">' + esc(seg) + '</w:t>'
        return ''
    r = WT.sub(rep, tpl)
    if hl:
        if '</w:rPr>' in r:
            r = r.replace('</w:rPr>', HL + '</w:rPr>', 1)
        else:
            r = re.sub(r'(<w:r(?: [^>]*)?>)', r'\1<w:rPr>' + HL + '</w:rPr>', r, count=1)
    return r


def set_text(p, text, keep_rest=False):
    """段落の文章を差し替える。⟦…⟧ で囲んだ部分は黄色の蛍光ペンにする"""
    p = p.replace('<w:lastRenderedPageBreak/>', '')
    runs = [m for m in RUN.finditer(p) if re.search(r'<w:t[ >]', m.group(0))]
    assert runs, 'no text run: ' + p[:200]
    first = runs[0]
    segs = [s for s in re.split(r'(⟦.*?⟧)', text) if s]
    new = ''.join(_mkrun(first.group(0), s.strip('⟦⟧'), s.startswith('⟦')) for s in segs)
    rest = p[first.end():]
    if not keep_rest:
        rest = RUN.sub(lambda m: '' if re.search(r'<w:t[ >]', m.group(0)) else m.group(0), rest)
    return p[:first.start()] + new + rest


class Doc:
    def __init__(self, src_docx):
        self.src = src_docx
        with zipfile.ZipFile(src_docx) as z:
            self.xml = z.read('word/document.xml').decode('utf-8')
        bs = self.xml.find('>', self.xml.find('<w:body')) + 1
        be = self.xml.rfind('<w:sectPr')
        self.head, self.tail = self.xml[:bs], self.xml[be:]
        self.blocks = [b for b in re.split(r'(<w:tbl>.*?</w:tbl>|<w:p[ >].*?</w:p>)', self.xml[bs:be], flags=re.S) if b]
        ids = [int(i) for i in re.findall(r'bookmarkStart w:id="(\d+)"', self.xml)]
        self.next_bm = max(ids, default=-1) + 1
        self.next_toc = 900

    # ---- 探す ----
    def find(self, text, toc=False):
        hits = []
        for i, b in enumerate(self.blocks):
            if not b.startswith('<w:p'):
                continue
            is_toc = 'PAGEREF' in b
            if is_toc != toc:
                continue
            t = ptext(b)
            if toc:
                t = re.sub(r'\d+$', '', t)
            if t == text or (not toc and text.endswith('…') and t.startswith(text[:-1])):
                hits.append(i)
        assert len(hits) == 1, f'{len(hits)} hits for: {text}'
        return hits[0]

    # ---- 段落 ----
    def set(self, old, new, toc=False):
        i = self.find(old, toc)
        self.blocks[i] = set_text(self.blocks[i], new, keep_rest=toc)
        return i

    def clone(self, model, text):
        return set_text(strip_ids(self.blocks[self.find(model)]), text)

    def after(self, anchor, model, texts, toc=False):
        """anchor の段落の後ろに、model と同じ書式の段落を足す"""
        i = self.find(anchor, toc)
        m = strip_ids(self.blocks[self.find(model)])
        self.blocks[i + 1:i + 1] = [set_text(m, t) for t in texts]

    def delete(self, text):
        del self.blocks[self.find(text)]

    def heading_after(self, anchor, model_heading, title, toc_anchor, toc_model):
        """見出しを足し、目次にも1行足す（ページ番号は Word のフィールド更新で入る）"""
        name = f'_Toc_mw{self.next_toc}'
        self.next_toc += 1
        bid = self.next_bm
        self.next_bm += 1
        h = set_text(strip_ids(self.blocks[self.find(model_heading)]), title)
        h = RUN.sub(lambda m: f'<w:bookmarkStart w:id="{bid}" w:name="{name}"/>' + m.group(0) + f'<w:bookmarkEnd w:id="{bid}"/>', h, count=1)
        i = self.find(anchor)
        self.blocks.insert(i + 1, h)
        t = self.blocks[self.find(toc_model, toc=True)]
        t = re.sub(r' w14:paraId="[^"]*"| w14:textId="[^"]*"', '', t)
        t = set_text(t, '　' + title, keep_rest=True)
        t = re.sub(r'_Toc_mw\d+', name, t)
        j = self.find(toc_anchor, toc=True)
        self.blocks.insert(j + 1, t)

    # ---- 表 ----
    def table(self, k, rows):
        idx = [i for i, b in enumerate(self.blocks) if b.startswith('<w:tbl>')][k]
        t = self.blocks[idx]
        trs = list(re.finditer(r'<w:tr[ >].*?</w:tr>', t, flags=re.S))
        tpl = strip_ids(trs[1].group(0))
        cells = list(re.finditer(r'<w:tc>.*?</w:tc>', tpl, flags=re.S))
        out = []
        for row in rows:
            assert len(row) == len(cells), row
            r, pos = '', 0
            for c, txt in zip(cells, row):
                r += tpl[pos:c.start()] + re.sub(r'<w:p[ >].*?</w:p>', lambda m: set_text(m.group(0), txt), c.group(0), count=1, flags=re.S)
                pos = c.end()
            out.append(r + tpl[pos:])
        self.blocks[idx] = t[:trs[1].start()] + ''.join(out) + t[trs[-1].end():]

    # ---- 保存 ----
    def save(self, dst):
        xml = self.head + ''.join(self.blocks) + self.tail
        with zipfile.ZipFile(self.src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename.endswith('/'):
                    continue
                data = xml.encode('utf-8') if item.filename == 'word/document.xml' else zin.read(item.filename)
                zout.writestr(item.filename, data)
