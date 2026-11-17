#!/usr/bin/env python3
"""Convert the supplied Quantum Optics TeX transcription into wiki HTML.

This script is original to the site build. It does not execute files from the
uploaded archive.
"""
from __future__ import annotations

import argparse
import html as htmlmod
import json
import re
import shutil
from pathlib import Path

CIRCLED = {
    "1": "①",
    "2": "②",
    "3": "③",
    "4": "④",
    "5": "⑤",
    "6": "⑥",
    "7": "⑦",
    "8": "⑧",
    "9": "⑨",
}

MATH_TOKEN = "@@MATH{}@@"
FOOT_TOKEN = "@@FOOT{}@@"

CHAPTER_TITLES = {
    "1": "量子力学基础",
    "2": "经典电磁场与原子的相互作用",
    "3": "电磁场物理量的算符表示",
    "4": "电磁场的量子态",
    "5": "电磁场量子态在相干态表象中的表示",
    "6": "电磁场的相干性",
    "7": "量子电磁场与原子的相互作用",
    "8": "耗散和退相干的量子理论",
    "9": "量子光学实验中常用的物理系统",
    "10": "量子信息科学简介",
    "11": "冷原子物理简介",
}


class ConvertError(RuntimeError):
    pass


def strip_comments(text: str) -> str:
    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            out.append(ch)
            out.append(text[i + 1])
            i += 2
            continue
        if ch == "%":
            while i < n and text[i] != "\n":
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i].isspace():
        i += 1
    return i


def grab_group(s: str, i: int, open_ch="{", close_ch="}") -> tuple[str, int]:
    i = skip_ws(s, i)
    if i >= len(s) or s[i] != open_ch:
        raise ConvertError(f"expected {open_ch} at {i}: {s[i:i+40]!r}")
    depth = 0
    i += 1
    start = i
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            i += 2
            continue
        if s[i] == open_ch:
            depth += 1
        elif s[i] == close_ch:
            if depth == 0:
                return s[start:i], i + 1
            depth -= 1
        i += 1
    raise ConvertError("unclosed group")


def grab_optional(s: str, i: int) -> tuple[str | None, int]:
    j = skip_ws(s, i)
    if j < len(s) and s[j] == "[":
        return grab_group(s, j, "[", "]")
    return None, i


def extract_env(s: str, start: int, name: str) -> tuple[str, int]:
    open_pat = r"\\begin\{" + re.escape(name) + r"\}"
    close_pat = r"\\end\{" + re.escape(name) + r"\}"
    m = re.match(open_pat, s[start:])
    if not m:
        raise ConvertError(f"not at begin{{{name}}}")
    i = start + m.end()
    depth = 1
    while i < len(s):
        mo = re.search(open_pat + r"|" + close_pat, s[i:])
        if not mo:
            raise ConvertError(f"unclosed environment {name}")
        token = mo.group(0)
        i = i + mo.start()
        if token.startswith(r"\begin"):
            depth += 1
            i = i + mo.end() - mo.start()
            continue
        depth -= 1
        end_body = i
        i = i + mo.end() - mo.start()
        if depth == 0:
            return s[start + m.end() : end_body], i
    raise ConvertError(f"unclosed environment {name}")


def preprocess_math(tex: str) -> str:
    def rot_repl(m):
        ang = m.group(1)
        if ang in ("45", "+45"):
            cls = "rot45"
        elif ang in ("-45",):
            cls = "rot-45"
        else:
            cls = "rot-custom"
        return r"\mathrel{\htmlClass{" + cls + r"}{\leftrightarrow}}"

    tex = re.sub(
        r"\\mathrel\{\s*\\rotatebox\[origin=c\]\{(-?\d+)\}\{\$\\leftrightarrow\$\}\s*\}",
        rot_repl,
        tex,
    )
    tex = re.sub(
        r"\\rotatebox\[origin=c\]\{(-?\d+)\}\{\$\\leftrightarrow\$\}",
        rot_repl,
        tex,
    )
    tex = re.sub(r"\\textcircled\{([1-9])\}", lambda m: CIRCLED[m.group(1)], tex)
    # KaTeX uses \mathrm; keep \operatorname; map custom macros later in JS
    return tex


def extract_math_blocks(text: str) -> tuple[str, list[dict]]:
    blocks: list[dict] = []
    out: list[str] = []
    i = 0
    n = len(text)

    def add(kind: str, body: str, tag: str | None = None, display: bool = False):
        body = preprocess_math(body.strip())
        if kind == "align*":
            body = "\\begin{aligned}\n" + body + "\n\\end{aligned}"
        idx = len(blocks)
        blocks.append({"kind": kind, "tex": body, "tag": tag, "display": display})
        out.append(MATH_TOKEN.format(idx))

    while i < n:
        if text.startswith(r"\begin{equation*}", i):
            body, i = extract_env(text, i, "equation*")
            add("equation*", body, display=True)
            continue
        if text.startswith(r"\begin{equation}", i):
            body, i = extract_env(text, i, "equation")
            tag = None
            tm = re.search(r"\\tag\{([^{}]+)\}", body)
            if tm:
                tag = tm.group(1)
                body = (body[: tm.start()] + body[tm.end() :]).strip()
            add("equation", body, tag=tag, display=True)
            continue
        if text.startswith(r"\begin{align*}", i):
            body, i = extract_env(text, i, "align*")
            add("align*", body, display=True)
            continue
        if text.startswith(r"\[", i) and (i == 0 or text[i - 1] != "\\"):
            j = text.find(r"\]", i + 2)
            if j < 0:
                raise ConvertError("unclosed \\[")
            add("brackets", text[i + 2 : j], display=True)
            i = j + 2
            continue
        if text.startswith(r"\(", i):
            j = text.find(r"\)", i + 2)
            if j < 0:
                raise ConvertError("unclosed \\(")
            add("parens", text[i + 2 : j], display=False)
            i = j + 2
            continue
        if text[i] == "$" and (i == 0 or text[i - 1] != "\\"):
            if i + 1 < n and text[i + 1] == "$":
                j = text.find("$$", i + 2)
                if j < 0:
                    raise ConvertError("unclosed $$")
                add("dollars", text[i + 2 : j], display=True)
                i = j + 2
                continue
            j = i + 1
            while j < n:
                if text[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if text[j] == "$":
                    add("inline", text[i + 1 : j], display=False)
                    i = j + 1
                    break
                j += 1
            else:
                raise ConvertError("unclosed $")
            continue
        out.append(text[i])
        i += 1
    return "".join(out), blocks


def convert_arg(s: str, math: list[dict], footnotes: list[str]) -> str:
    return convert_text(s, math, footnotes, para=False)


def slug(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", "-", s.strip())
    s = re.sub(r"[^\w\u4e00-\u9fff.-]+", "", s, flags=re.A)
    return s or "section"


def convert_text(text: str, math: list[dict], footnotes: list[str], para: bool = True) -> str:
    out: list[str] = []
    i = 0
    n = len(text)

    def append(s: str):
        out.append(s)

    while i < n:
        # math placeholders
        m = re.match(r"@@MATH(\d+)@@", text[i:])
        if m:
            append(m.group(0))
            i += m.end()
            continue
        if text.startswith(r"\SourcePage", i):
            i = skip_ws(text, i + len(r"\SourcePage"))
            src, i = grab_group(text, i)
            printed, i = grab_group(text, i)
            append(
                f'<section class="source-page" id="p-{src}" data-source="{htmlmod.escape(src)}" data-printed="{htmlmod.escape(printed)}">'
                f'<div class="page-rail" aria-hidden="true">'
                f'<span class="page-src">源页 {htmlmod.escape(src)}</span>'
                f'<span class="page-print">原书第 {htmlmod.escape(printed)} 页</span>'
                f"</div>"
            )
            continue
        if text.startswith(r"\BookChapter", i):
            i = skip_ws(text, i + len(r"\BookChapter"))
            num, i = grab_group(text, i)
            title, i = grab_group(text, i)
            title_html = convert_arg(title, math, footnotes)
            append(
                f'<h1 id="ch-{htmlmod.escape(num)}">第 {htmlmod.escape(num)} 章　{title_html}</h1>'
            )
            continue
        if text.startswith(r"\BookSection", i):
            i = skip_ws(text, i + len(r"\BookSection"))
            num, i = grab_group(text, i)
            title, i = grab_group(text, i)
            title_html = convert_arg(title, math, footnotes)
            sid = num.replace(".", "-")
            label = f"{htmlmod.escape(num)}　" if num else ""
            append(f'<h2 id="s-{sid}">{label}{title_html}</h2>')
            continue
        if text.startswith(r"\BookSubsection", i):
            i = skip_ws(text, i + len(r"\BookSubsection"))
            num, i = grab_group(text, i)
            title, i = grab_group(text, i)
            title_html = convert_arg(title, math, footnotes)
            if num:
                sid = num.replace(".", "-")
                append(f'<h3 id="s-{sid}">{htmlmod.escape(num)}　{title_html}</h3>')
            else:
                sid = slug(re.sub(r"@@MATH\d+@@", "", title_html))
                append(f'<h3 id="h-{sid}">{title_html}</h3>')
            continue
        if text.startswith(r"\section*", i):
            i = skip_ws(text, i + len(r"\section*"))
            title, i = grab_group(text, i)
            title_html = convert_arg(title, math, footnotes)
            plain = re.sub(r"<[^>]+>", "", title_html)
            sid = "app"
            if "附录 A" in plain or "附录A" in plain:
                sid = "app-a"
            elif "附录 B" in plain or "附录B" in plain:
                sid = "app-b"
            elif "附录 C" in plain or "附录C" in plain:
                sid = "app-c"
            elif "附录 D" in plain or "附录D" in plain:
                sid = "app-d"
            elif plain.strip() == "目录":
                sid = "toc-heading"
            elif plain.strip() == "附录":
                sid = "app"
            append(f'<h1 id="{sid}">{title_html}</h1>')
            continue
        if text.startswith(r"\subsection*", i):
            i = skip_ws(text, i + len(r"\subsection*"))
            title, i = grab_group(text, i)
            title_html = convert_arg(title, math, footnotes)
            plain = re.sub(r"<[^>]+>", "", title_html)
            sid = slug(plain)
            if "附录 A" in plain:
                sid = "app-a"
            append(f'<h2 id="{sid}">{title_html}</h2>')
            continue
        if text.startswith(r"\tocentry", i):
            i = skip_ws(text, i + len(r"\tocentry"))
            _lvl, i = grab_group(text, i)
            _title, i = grab_group(text, i)
            _page, i = grab_group(text, i)
            # Structured TOC is generated separately.
            continue
        if text.startswith(r"\protect\footnote", i) or text.startswith(r"\footnote", i):
            if text.startswith(r"\protect\footnote", i):
                i += len(r"\protect\footnote")
            else:
                i += len(r"\footnote")
            _opt, i = grab_optional(text, i)
            body, i = grab_group(text, i)
            footnotes.append(convert_arg(body, math, footnotes))
            num = len(footnotes)
            append(
                f'<sup class="fn-ref"><a href="#fn-{num}" id="fnref-{num}">[{num}]</a></sup>'
            )
            continue
        if text.startswith(r"\textbf", i):
            i = skip_ws(text, i + len(r"\textbf"))
            body, i = grab_group(text, i)
            append(f"<strong>{convert_arg(body, math, footnotes)}</strong>")
            continue
        if text.startswith(r"\textit", i) or text.startswith(r"\emph", i):
            cmd = r"\textit" if text.startswith(r"\textit", i) else r"\emph"
            i = skip_ws(text, i + len(cmd))
            body, i = grab_group(text, i)
            append(f"<em>{convert_arg(body, math, footnotes)}</em>")
            continue
        if text.startswith(r"\textsuperscript", i):
            i = skip_ws(text, i + len(r"\textsuperscript"))
            body, i = grab_group(text, i)
            append(f"<sup>{convert_arg(body, math, footnotes)}</sup>")
            continue
        if text.startswith(r"\textcircled", i):
            i = skip_ws(text, i + len(r"\textcircled"))
            body, i = grab_group(text, i)
            append(CIRCLED.get(body.strip(), f"({htmlmod.escape(body)})"))
            continue
        if text.startswith(r"\includegraphics", i):
            i += len(r"\includegraphics")
            opt, i = grab_optional(text, i)
            path, i = grab_group(text, i)
            name = Path(path).name
            width = None
            if opt:
                wm = re.search(r"width\s*=\s*([\d.]+)\\(?:linewidth|textwidth)", opt)
                if wm:
                    width = float(wm.group(1))
            style = ""
            if width:
                style = f' style="width:{min(width * 100, 100):.0f}%;max-width:100%"'
            append(
                f'<img class="figure-img" src="figures/{htmlmod.escape(name)}" alt="{htmlmod.escape(name)}" loading="lazy"{style}>'
            )
            continue
        if text.startswith(r"\begin{center}", i):
            body, i = extract_env(text, i, "center")
            inner = convert_text(body, math, footnotes, para=True)
            append(f'<div class="center">{inner}</div>')
            continue
        if text.startswith(r"\begin{minipage}", i):
            i = text.find(r"\begin{minipage}", i)
            # optional [pos] then {width}
            start_cmd = i + len(r"\begin{minipage}")
            pos, j = grab_optional(text, start_cmd)
            width, j = grab_group(text, j)
            # find matching end, accounting for nested minipage
            body, i = extract_env(text, i, "minipage")
            # extract_env already consumed from \begin, but we also parsed width
            # Re-parse properly:
            # Actually extract_env starts at \begin and returns body after {name},
            # which still includes {width} at the start.
            # Fix: the body starts with optional [pos]{width}
            rest = body
            k = 0
            _p, k = grab_optional(rest, k)
            _w, k = grab_group(rest, k)
            inner = convert_text(rest[k:], math, footnotes, para=True)
            wcss = ""
            wm = re.search(r"([\d.]+)\\(?:linewidth|textwidth)", width)
            if wm:
                wcss = f' style="flex:0 0 {float(wm.group(1))*100:.0f}%"'
            append(f'<div class="minipage"{wcss}>{inner}</div>')
            continue
        if text.startswith(r"\par", i) and (i + 4 == n or not text[i + 4].isalpha()):
            append("\n\n")
            i += 4
            continue
        if text.startswith(r"\noindent", i):
            i += len(r"\noindent")
            continue
        if text.startswith(r"\centering", i):
            i += len(r"\centering")
            continue
        if text.startswith(r"\hfill", i):
            append('<span class="hfill"></span>')
            i += len(r"\hfill")
            continue
        if text.startswith(r"\qquad", i):
            append("  ")
            i += len(r"\qquad")
            continue
        if text.startswith(r"\quad", i):
            append("　")
            i += len(r"\quad")
            continue
        if text.startswith(r"\textasciicircum", i):
            append("^")
            i += len(r"\textasciicircum")
            continue
        if text.startswith(r"\\", i):
            # \\[3pt] or \\
            i += 2
            _sp, i = grab_optional(text, i)
            append("<br>")
            continue
        if text.startswith(r"\%", i):
            append("%")
            i += 2
            continue
        if text.startswith(r"\&", i):
            append("&amp;")
            i += 2
            continue
        if text.startswith(r"\#", i):
            append("#")
            i += 2
            continue
        if text.startswith(r"\_", i):
            append("_")
            i += 2
            continue
        if text.startswith(r"\{", i):
            append("{")
            i += 2
            continue
        if text.startswith(r"\}", i):
            append("}")
            i += 2
            continue
        if text.startswith(r"\$", i):
            append("$")
            i += 2
            continue
        if text.startswith(r"\ ", i) or text.startswith("\\,", i) or text.startswith("\\;", i):
            append(" ")
            i += 2
            continue
        if text.startswith(r"\~", i) or text[i] == "~":
            append("\u00a0")
            i += 2 if text.startswith(r"\~", i) else 1
            continue
        if text.startswith("---", i):
            append("—")
            i += 3
            continue
        if text.startswith("--", i):
            append("–")
            i += 2
            continue
        if text[i] in "<>&":
            append(htmlmod.escape(text[i]))
            i += 1
            continue
        # leftover TeX command in text — keep a visible fallback
        if text[i] == "\\" and i + 1 < n and text[i + 1].isalpha():
            m = re.match(r"\\([a-zA-Z]+)", text[i:])
            append(htmlmod.escape(m.group(0)))
            i += m.end()
            continue
        append(text[i])
        i += 1

    raw = "".join(out)
    # Close source-page sections before the next one or at end
    parts = re.split(r'(<section class="source-page")', raw)
    rebuilt = []
    opened = False
    for part in parts:
        if part.startswith("<section class="):
            if opened:
                rebuilt.append("</section>")
            opened = True
            rebuilt.append(part)
        else:
            rebuilt.append(part)
    if opened:
        rebuilt.append("</section>")
    raw = "".join(rebuilt)

    if not para:
        return raw.strip()

    # paragraphize text not already in block tags
    return paragraphize(raw)


BLOCK_RE = re.compile(
    r"(</?(?:h[1-6]|section|div|p|ul|ol|li|table|figure|blockquote|pre)(?:\s[^>]*)?>)",
    re.I,
)


def paragraphize(raw: str) -> str:
    parts = BLOCK_RE.split(raw)
    out = []
    in_block = 0
    buf = []

    def flush():
        nonlocal buf
        text = "".join(buf)
        buf = []
        chunks = re.split(r"\n\s*\n", text)
        for ch in chunks:
            piece = ch.strip()
            if not piece:
                continue
            # line breaks already inserted as <br>
            piece = re.sub(r"\n+", "", piece)
            if re.fullmatch(r"(?:<br>\s*)+", piece):
                continue
            out.append(f"<p>{piece}</p>")

    for part in parts:
        if BLOCK_RE.fullmatch(part or ""):
            flush()
            name = re.match(r"</?([a-z0-9]+)", part, re.I).group(1).lower()
            closing = part.startswith("</")
            if name in {"p", "br", "section"}:
                if name == "section":
                    flush()
                out.append(part)
            elif name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                if not closing:
                    flush()
                    in_block += 1
                    out.append(part)
                else:
                    out.extend(buf)
                    buf.clear()
                    in_block = max(0, in_block - 1)
                    out.append(part)
            else:
                if not closing:
                    flush()
                    in_block += 1
                    out.append(part)
                else:
                    out.extend(buf)
                    buf.clear()
                    in_block = max(0, in_block - 1)
                    out.append(part)
            continue
        if in_block:
            out.append(part)
        else:
            buf.append(part)
    flush()
    return "".join(out)


def restore_math(html: str, blocks: list[dict]) -> str:
    def repl(m):
        blk = blocks[int(m.group(1))]
        tex = blk["tex"]
        # keep raw TeX in data attribute; text content is also the TeX for KaTeX
        tex_text = tex.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if blk["display"]:
            tag = blk.get("tag")
            tag_html = ""
            eqid = ""
            if tag:
                slug_tag = tag.replace(".", "-").replace(" ", "")
                eqid = f' id="eq-{slug_tag}"'
                tag_html = f'<span class="eq-tag">({htmlmod.escape(tag)})</span>'
            return (
                f'<div class="eq"{eqid} data-display="true">'
                f'<span class="math" data-display="true">{tex_text}</span>'
                f"{tag_html}</div>"
            )
        return f'<span class="math" data-display="false">{tex_text}</span>'

    return re.sub(r"@@MATH(\d+)@@", repl, html)


def convert_page(tex: str) -> tuple[str, list[dict], list[str], dict]:
    meta = {}
    body = strip_comments(tex)
    def _rot(m):
        cls = 'rot-45' if m.group(1).startswith('-') else 'rot45'
        return r"\mathrel{\htmlClass{" + cls + r"}{\leftrightarrow}}"
    body = re.sub(
        r"\\mathrel\{\s*\\rotatebox\[origin=c\]\{(-?\d+)\}\{\$\\leftrightarrow\$\}\s*\}",
        _rot,
        body,
    )
    body = re.sub(
        r"\\rotatebox\[origin=c\]\{(-?\d+)\}\{\$\\leftrightarrow\$\}",
        _rot,
        body,
    )
    m = re.search(r"\\SourcePage\{([^}]+)\}\{([^}]+)\}", body)
    if m:
        meta["source"] = m.group(1)
        meta["printed"] = m.group(2)
    text, blocks = extract_math_blocks(body)
    footnotes: list[str] = []
    html = convert_text(text, blocks, footnotes, para=False)
    html = restore_math(html, blocks)
    html = paragraphize(html)
    if footnotes:
        items = []
        for i, fn in enumerate(footnotes, 1):
            fn = restore_math(fn, blocks)
            items.append(
                f'<li id="fn-{i}">{fn} <a class="fn-back" href="#fnref-{i}">↩</a></li>'
            )
        html += '<ol class="footnotes">' + "".join(items) + "</ol>"
    return html, blocks, footnotes, meta


def parse_toc_entries(pages_dir: Path) -> list[dict]:
    entries = []
    preamble_lines = []
    for n in range(1, 5):
        raw = strip_comments((pages_dir / f"page-{n:03d}.tex").read_text(encoding="utf-8"))
        if n == 1:
            if "信息科学技术学术著作丛书" in raw:
                preamble_lines.append("《信息科学技术学术著作丛书》序")
            if re.search(r"(?m)^序\\par", raw) or "\n序\\par" in raw:
                preamble_lines.append("序")
            if "前言" in raw:
                preamble_lines.append("前言")
        i = 0
        while True:
            j = raw.find(r"\tocentry", i)
            if j < 0:
                break
            i = skip_ws(raw, j + len(r"\tocentry"))
            lvl, i = grab_group(raw, i)
            title, i = grab_group(raw, i)
            page, i = grab_group(raw, i)
            entries.append({"level": int(lvl), "title": title, "page": page})
    return entries, preamble_lines


def title_to_plain(title: str) -> str:
    t = title
    t = re.sub(r"\\ket\{([^}]*)\}", r"|\\1⟩", t)
    t = re.sub(r"\\textsuperscript\{([^}]*)\}", r"\1", t)
    t = re.sub(r"\$([^$]+)\$", r"\1", t)
    t = t.replace(r"\alpha", "α").replace(r"\quad", " ")
    return t


def title_to_html(title: str) -> str:
    footnotes: list[str] = []
    text, blocks = extract_math_blocks(strip_comments(title))
    html = convert_text(text, blocks, footnotes, para=False)
    return restore_math(html, blocks)


def assign_docs(pages_meta: list[dict]) -> list[dict]:
    """pages_meta items have html and source number, plus detected starts."""
    docs = []

    def new_doc(doc_id, title, kind):
        d = {"id": doc_id, "title": title, "kind": kind, "pages": [], "html_parts": []}
        docs.append(d)
        return d

    current = new_doc("toc", "目录", "toc")
    for p in pages_meta:
        src = int(p["source"])
        html = p["html"]
        if src <= 4:
            current["pages"].append(p)
            continue
        ch = re.search(r'<h1 id="ch-(\d+)">', html)
        if ch:
            num = ch.group(1)
            title = CHAPTER_TITLES.get(num, f"第{num}章")
            current = new_doc(f"ch{num}", f"第{num}章 {title}", "chapter")
            current["chapter"] = num
        elif re.search(r'<h1 id="app"', html) and current["id"] != "app":
            current = new_doc("app", "附录", "appendix")
        current["pages"].append(p)
    return docs


def linkify(html: str, eq_tags: set[str], fig_ids: set[str]) -> str:
    def eq_repl(m):
        prefix, body, suffix = m.group(1), m.group(2), m.group(3)
        parts = []
        # split on 、 or comma or 和
        bits = re.split(r"(、|，|,|和)", body)
        acc = []
        for bit in bits:
            if bit in ("、", "，", ",", "和"):
                acc.append(bit)
                continue
            tag = bit.strip()
            if tag in eq_tags:
                slug_tag = tag.replace(".", "-").replace(" ", "")
                acc.append(f'<a class="xref" href="#/eq/{htmlmod.escape(tag)}">{htmlmod.escape(tag)}</a>')
            else:
                acc.append(htmlmod.escape(tag) if tag and "<" not in bit else bit)
        return f"{prefix}{''.join(acc)}{suffix}"

    # Only link simple 式（tag） / 式(tag)
    html = re.sub(
        r"(式（)([0-9A-D]+\.[0-9]+[a-z]?)(）)",
        lambda m: f'{m.group(1)}<a class="xref" href="#/eq/{m.group(2)}">{m.group(2)}</a>{m.group(3)}'
        if m.group(2) in eq_tags
        else m.group(0),
        html,
    )
    html = re.sub(
        r"(式\()([0-9A-D]+\.[0-9]+[a-z]?)(\))",
        lambda m: f'{m.group(1)}<a class="xref" href="#/eq/{m.group(2)}">{m.group(2)}</a>{m.group(3)}'
        if m.group(2) in eq_tags
        else m.group(0),
        html,
    )
    html = re.sub(
        r"(图\s*)(\d+\.\d+)",
        lambda m: f'{m.group(1)}<a class="xref" href="#/fig/{m.group(2)}">{m.group(2)}</a>'
        if m.group(2) in fig_ids
        else m.group(0),
        html,
    )
    return html


def caption_figures(html: str) -> str:
    """Wrap each image and its 图 caption, including math in the caption."""

    def wrap_unit(chunk: str) -> str:
        if "figure-img" not in chunk or "<figure" in chunk:
            return chunk
        m = re.search(
            r'(<img class="figure-img"[^>]*>)([\s\S]*)$',
            chunk,
        )
        if not m:
            return chunk
        img, rest = m.group(1), m.group(2)
        if "图" not in rest and "图" not in chunk:
            return chunk
        fm = re.search(r"图\s*(\d+\.\d+)", rest) or re.search(r"图\s*(\d+\.\d+)", chunk)
        fid = f' id="fig-{fm.group(1)}"' if fm else ""
        cap = rest.strip()
        cap = re.sub(r"^</p>\s*<p>", "", cap)
        cap = re.sub(r"</p>\s*<p>", "<br>", cap)
        cap = re.sub(r"</?p>", "", cap)
        return f"<figure{fid}>{img}<figcaption>{cap}</figcaption></figure>"

    def wrap_minipage(m):
        inner = m.group(1)
        style = m.group(0)[len('<div class="minipage"'):]
        style = style[: style.find(">") + 1] if ">" in style else ">"
        # m.group(0) is full tag+inner+close; easier rebuild
        open_tag = m.group(0)[: m.group(0).find(">") + 1]
        return f"{open_tag}{wrap_unit(inner)}</div>"

    html = re.sub(
        r'<div class="minipage"[^>]*>([\s\S]*?)</div>',
        wrap_minipage,
        html,
    )

    def wrap_center(m):
        inner = m.group(1)
        if "figure-img" not in inner:
            return m.group(0)
        # already one or more figures (e.g. two minipages)
        if inner.count("<figure") >= inner.count("figure-img"):
            return f'<div class="center fig-row">{inner}</div>'
        return f'<div class="center">{wrap_unit(inner)}</div>'

    html = re.sub(
        r'<div class="center">([\s\S]*?)</div>',
        wrap_center,
        html,
    )

    def wrap_loose(m):
        return wrap_unit(m.group(0))

    html = re.sub(
        r'<p>\s*(<img class="figure-img"[^>]*>[\s\S]*?图[\s\S]*?)</p>',
        lambda m: wrap_unit(m.group(1)),
        html,
    )
    return html



def md_to_html(md: str) -> str:
    lines = md.replace("\r\n", "\n").split("\n")
    out = []
    in_list = False
    para = []

    def flush_para():
        nonlocal para
        if para:
            text = " ".join(para).strip()
            if text:
                out.append("<p>" + inline_md(text) + "</p>")
        para = []

    def flush_list():
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    def inline_md(s: str) -> str:
        # extract code spans
        parts = re.split(r"(`[^`]+`)", s)
        acc = []
        for p in parts:
            if p.startswith("`") and p.endswith("`") and len(p) >= 2:
                acc.append("<code>" + htmlmod.escape(p[1:-1]) + "</code>")
            else:
                acc.append(htmlmod.escape(p))
        return "".join(acc)

    for line in lines:
        if line.startswith("# "):
            flush_para(); flush_list()
            out.append("<h1>" + inline_md(line[2:].strip()) + "</h1>")
        elif line.startswith("## "):
            flush_para(); flush_list()
            title = line[3:].strip()
            sid = slug(title)
            out.append(f'<h2 id="{sid}">' + inline_md(title) + "</h2>")
        elif line.startswith("### "):
            flush_para(); flush_list()
            out.append("<h3>" + inline_md(line[4:].strip()) + "</h3>")
        elif re.match(r"\s*-\s+", line):
            flush_para()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append("<li>" + inline_md(re.sub(r"^\s*-\s+", "", line)) + "</li>")
        elif not line.strip():
            flush_para(); flush_list()
        else:
            flush_list()
            para.append(line.strip())
    flush_para(); flush_list()
    # link 原 PDF 第 N 页
    html = "".join(out)
    html = re.sub(
        r"原 PDF 第\s*(\d+)\s*页",
        lambda m: f'<a class="xref" href="#/p/{int(m.group(1)):03d}">原 PDF 第 {m.group(1)} 页</a>',
        html,
    )
    html = re.sub(
        r"式（([0-9A-D]+\.[0-9]+[a-z]?)）",
        r'式（<a class="xref" href="#/eq/\1">\1</a>）',
        html,
    )
    return html


def plain_from_html(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", html)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = htmlmod.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def build(src: Path, dest: Path) -> dict:
    pages_dir = src / "pages"
    fig_src = src / "figures"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "content").mkdir(exist_ok=True)
    (dest / "data").mkdir(exist_ok=True)
    fig_dest = dest / "figures"
    fig_dest.mkdir(exist_ok=True)

    figure_files = sorted(p.name for p in fig_src.glob("*.png"))
    for name in figure_files:
        shutil.copy2(fig_src / name, fig_dest / name)

    pages = []
    all_blocks = []
    leftover_cmds = []
    for n in range(1, 243):
        tex = (pages_dir / f"page-{n:03d}.tex").read_text(encoding="utf-8")
        try:
            html, blocks, footnotes, meta = convert_page(tex)
        except Exception as e:
            raise ConvertError(f"page {n}: {e}") from e
        if "source" not in meta:
            raise ConvertError(f"page {n} missing SourcePage")
        # leftover tex commands in non-math html
        stripped = re.sub(r'<span class="math"[^>]*>[\s\S]*?</span>', "", html)
        for m in re.finditer(r"\\[a-zA-Z]+", stripped):
            leftover_cmds.append((n, m.group(0)))
        pages.append({"html": html, "blocks": blocks, "footnotes": footnotes, **meta, "n": n})
        all_blocks.extend(blocks)

    eq_tags = {b["tag"] for b in all_blocks if b.get("tag")}
    fig_ids = set()
    for name in figure_files:
        m = re.match(r"fig-(\d+)-(\d+)\.png", name)
        if m:
            fig_ids.add(f"{m.group(1)}.{m.group(2)}")

    toc_entries, preamble_lines = parse_toc_entries(pages_dir)
    docs = assign_docs(pages)

    # Build TOC html
    toc_html = ['<h1 id="toc-heading">目录</h1>']
    if preamble_lines:
        toc_html.append(
            "<p class='front-matter-note'>"
            + "　".join(htmlmod.escape(x) + "（原书有此篇，本次文稿未收录正文）" if False else htmlmod.escape(x)
                       for x in preamble_lines)
            + "</p>"
        )
        # The above is messy — write clearly:
        toc_html[-1] = (
            "<ul class='front-matter'>"
            + "".join(f"<li>{htmlmod.escape(x)}<span class='dim'>（原书目录所列，本次文稿未收录正文）</span></li>" for x in preamble_lines)
            + "</ul>"
        )
    toc_html.append('<nav class="book-toc"><ol>')
    # We need to map printed page to source page and doc
    printed_to_source = {p["printed"]: p["source"] for p in pages}
    source_to_doc = {}
    for d in docs:
        for p in d["pages"]:
            source_to_doc[p["source"]] = d["id"]

    def route_for_printed(page: str) -> str | None:
        src = printed_to_source.get(page) or printed_to_source.get(str(page))
        if not src:
            # try zero-padded? printed may be '1' while stored '1' from {1}
            for p in pages:
                if p["printed"] == page or p["printed"].lstrip("0") == page.lstrip("0"):
                    src = p["source"]
                    break
        if not src:
            return None
        doc_id = source_to_doc.get(src)
        return f"#/{doc_id}/p/{src}"

    open_levels = [0]
    for ent in toc_entries:
        title_html = title_to_html(ent["title"])
        href = route_for_printed(ent["page"]) or "#"
        lvl = ent["level"]
        cls = f"toc-l{lvl}"
        toc_html.append(
            f'<li class="{cls}"><a href="{href}">{title_html}</a>'
            f'<span class="toc-page">{htmlmod.escape(ent["page"])}</span></li>'
        )
    toc_html.append("</ol></nav>")
    toc_html.append(
        '<p class="toc-extra"><a href="#/notes">原书疑点与转录说明</a></p>'
    )

    # Replace toc doc html
    for d in docs:
        if d["id"] == "toc":
            anchors = "".join(
                f'<section class="source-page" id="p-{pg["source"]}" data-source="{pg["source"]}" data-printed="{pg["printed"]}"></section>'
                for pg in d["pages"]
            )
            d["built_html"] = anchors + "\n".join(toc_html)
        else:
            parts = []
            for p in d["pages"]:
                h = caption_figures(p["html"])
                h = linkify(h, eq_tags, fig_ids)
                parts.append(h)
            d["built_html"] = "\n".join(parts)

    # notes
    notes_md = (src / "review" / "疑似原书问题.md").read_text(encoding="utf-8")
    notes_html = md_to_html(notes_md)
    docs.append(
        {
            "id": "notes",
            "title": "原书疑点与转录说明",
            "kind": "notes",
            "pages": [],
            "built_html": notes_html,
        }
    )

    # eq/fig maps
    eq_map = {}
    for d in docs:
        for m in re.finditer(r'id="eq-([^"]+)"', d.get("built_html", "")):
            tag = m.group(1).replace("-", ".")
            # restore last hyphen? tags like 1-11a -> 1.11a (only first hyphen is dot)
            # Better: we used tag.replace('.', '-') so 1.11a -> 1-11a, 2.139c -> 2-139c
            orig = None
            for t in eq_tags:
                if t.replace(".", "-").replace(" ", "") == m.group(1):
                    orig = t
                    break
            if orig:
                eq_map[orig] = {"doc": d["id"], "anchor": f"eq-{m.group(1)}"}
        for m in re.finditer(r'id="fig-([^"]+)"', d.get("built_html", "")):
            pass  # stored by id

    fig_map = {}
    for d in docs:
        for m in re.finditer(r'id="fig-([^"]+)"', d.get("built_html", "")):
            fig_map[m.group(1)] = {"doc": d["id"], "anchor": f"fig-{m.group(1)}"}

    page_map = {}
    for d in docs:
        for p in d.get("pages") or []:
            page_map[p["source"]] = {
                "doc": d["id"],
                "printed": p["printed"],
                "anchor": f"p-{p['source']}",
            }

    # Write content files
    nav = {"book": {
        "title": "量子光学",
        "author": "张智明",
        "publisher": "科学出版社",
        "year": "2015",
        "series": "信息科学技术学术著作丛书",
        "isbn": "978-7-03-043370-1",
        "pages": 242,
        "figures": len(figure_files),
        "equations": len(eq_tags),
    }, "docs": [], "eq": eq_map, "fig": fig_map, "page": page_map}

    search_docs = []
    for d in docs:
        (dest / "content" / f"{d['id']}.html").write_text(d["built_html"], encoding="utf-8")
        # extract headings for nav
        heads = []
        for m in re.finditer(
            r'<h([123]) id="([^"]+)">(.*?)</h\1>', d["built_html"], re.S
        ):
            heads.append(
                {
                    "level": int(m.group(1)),
                    "id": m.group(2),
                    "title": plain_from_html(m.group(3)),
                }
            )
        sources = [p["source"] for p in d.get("pages") or []]
        printed = [p["printed"] for p in d.get("pages") or []]
        nav["docs"].append(
            {
                "id": d["id"],
                "title": d["title"],
                "kind": d["kind"],
                "file": f"content/{d['id']}.html",
                "chapter": d.get("chapter"),
                "headings": heads,
                "sources": sources,
                "printed": printed,
            }
        )
        # search units: doc + each heading/page
        search_docs.append(
            {
                "id": d["id"],
                "title": d["title"],
                "route": f"#/{d['id']}",
                "text": plain_from_html(d["built_html"])[:],
            }
        )
        for p in d.get("pages") or []:
            search_docs.append(
                {
                    "id": f"{d['id']}-p-{p['source']}",
                    "title": f"{d['title']} · 源页 {p['source']}（原书第 {p['printed']} 页）",
                    "route": f"#/{d['id']}/p/{p['source']}",
                    "text": plain_from_html(p["html"]),
                }
            )

    (dest / "data" / "nav.json").write_text(
        json.dumps(nav, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (dest / "data" / "search.json").write_text(
        json.dumps({"docs": search_docs}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    report = {
        "pages": len(pages),
        "figures": len(figure_files),
        "equations": len(eq_tags),
        "docs": [d["id"] for d in docs],
        "leftover_commands": leftover_cmds[:50],
        "leftover_count": len(leftover_cmds),
        "toc_entries": len(toc_entries),
        "search_units": len(search_docs),
        "missing_fig_ids": sorted(fig_ids - set(fig_map)),
    }
    (dest / "data" / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=Path("/tmp/ql-wiki-src"))
    ap.add_argument(
        "--dest",
        type=Path,
        default=Path("/workspace/claude-test-site/ql/wiki"),
    )
    args = ap.parse_args()
    report = build(args.src, args.dest)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
