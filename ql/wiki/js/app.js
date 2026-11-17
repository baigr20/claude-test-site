const BASE = "/ql/wiki/";
const MACROS = {
  "\\ket": "\\lvert #1\\rangle",
  "\\bra": "\\langle #1\\rvert",
  "\\braket": "\\langle #1\\mid #2\\rangle",
  "\\dyad": "\\lvert #1\\rangle\\langle #2\\rvert",
  "\\dd": "\\mathrm{d}",
  "\\ii": "\\mathrm{i}",
  "\\ee": "\\mathrm{e}",
  "\\Tr": "\\operatorname{Tr}",
  "\\RePart": "\\operatorname{Re}",
  "\\ImPart": "\\operatorname{Im}",
  "\\bm": "\\boldsymbol{#1}"
};

const state = {
  nav: null,
  searchIndex: null,
  searchLoading: null,
  currentDoc: "home",
  cache: new Map()
};

const $ = (id) => document.getElementById(id);

function decodeTex(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function renderMath(root) {
  if (!window.katex) return;
  root.querySelectorAll("span.math").forEach((el) => {
    if (el.dataset.rendered) return;
    const display = el.getAttribute("data-display") === "true";
    const tex = decodeTex(el.textContent);
    try {
      el.innerHTML = window.katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        macros: MACROS,
        trust: true,
        strict: "ignore"
      });
      el.dataset.rendered = "1";
    } catch (err) {
      el.classList.add("math-error");
      el.title = String(err);
    }
  });
}

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const path = raw.replace(/^\//, "");
  if (!path || path === "home") return { type: "home" };
  if (path === "toc") return { type: "doc", id: "toc" };
  if (path === "notes") return { type: "doc", id: "notes" };
  if (path === "app") return { type: "doc", id: "app" };
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "q") {
    const q = new URLSearchParams(path.slice(2).replace(/^\/?/, "")).get("q") || decodeURIComponent(parts[1] || "");
    return { type: "search", q };
  }
  if (parts[0] === "p" && parts[1]) return { type: "page", source: padPage(parts[1]) };
  if (parts[0] === "eq" && parts[1]) return { type: "eq", tag: parts.slice(1).join("/") };
  if (parts[0] === "fig" && parts[1]) return { type: "fig", id: parts[1] };
  const docId = parts[0];
  const route = { type: "doc", id: docId };
  if (parts[1] === "p" && parts[2]) route.source = padPage(parts[2]);
  if (parts[1] === "s" && parts[2]) route.heading = parts[2];
  if (parts[1] && parts[1].startsWith("s-")) route.heading = parts[1];
  return route;
}

function padPage(s) {
  const n = String(s).replace(/\D/g, "");
  return n.padStart(3, "0");
}

function docById(id) {
  return state.nav.docs.find((d) => d.id === id);
}

async function loadNav() {
  const res = await fetch(BASE + "data/nav.json");
  if (!res.ok) throw new Error("无法读取目录数据");
  state.nav = await res.json();
}

async function loadDoc(id) {
  if (state.cache.has(id)) return state.cache.get(id);
  const doc = docById(id);
  if (!doc) throw new Error("没有这篇文稿");
  const res = await fetch(BASE + doc.file);
  if (!res.ok) throw new Error("无法读取 " + doc.title);
  const html = await res.text();
  state.cache.set(id, html);
  return html;
}

async function ensureSearch() {
  if (state.searchIndex) return state.searchIndex;
  if (!state.searchLoading) {
    state.searchLoading = fetch(BASE + "data/search.json")
      .then((r) => r.json())
      .then((data) => {
        state.searchIndex = data.docs;
        return state.searchIndex;
      });
  }
  return state.searchLoading;
}

function normalize(s) {
  return String(s).toLowerCase().replace(/\s+/g, "");
}

function search(q, limit = 30) {
  const query = q.trim();
  if (!query || !state.searchIndex) return [];
  const nq = normalize(query);
  const hits = [];
  for (const doc of state.searchIndex) {
    const title = doc.title || "";
    const text = doc.text || "";
    const nt = normalize(title);
    const nx = normalize(text);
    let score = 0;
    if (nt.includes(nq)) score += 50;
    if (title.includes(query)) score += 20;
    if (nx.includes(nq)) score += 8;
    if (!score) continue;
    let snippet = "";
    const idx = text.replace(/\s+/g, " ").indexOf(query);
    const nidx = normalize(text).indexOf(nq);
    if (idx >= 0) {
      snippet = text.replace(/\s+/g, " ").slice(Math.max(0, idx - 24), idx + query.length + 48);
    } else if (nidx >= 0) {
      const plain = text.replace(/\s+/g, " ");
      snippet = plain.slice(Math.max(0, Math.floor(nidx * 0.9) - 24), Math.floor(nidx * 0.9) + 72);
    }
    hits.push({ doc, score, snippet });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function highlight(text, q) {
  if (!q) return escapeHtml(text);
  const safe = escapeHtml(text);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
  return safe.replace(re, (m) => "<b>" + m + "</b>");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSidebar() {
  const box = $("navList");
  if (!box || !state.nav) return;
  const book = state.nav.book;
  const items = state.nav.docs
    .map((d) => {
      const sub = (d.headings || [])
        .filter((h) => h.level === 2)
        .map(
          (h) =>
            `<li><a href="#/${d.id}/s/${encodeURIComponent(h.id)}" data-doc="${d.id}">${escapeHtml(h.title)}</a></li>`
        )
        .join("");
      return `<li>
        <a href="#/${d.id}" data-doc="${d.id}">${escapeHtml(d.title)}</a>
        ${sub ? `<ul class="nav-sub" data-parent="${d.id}">${sub}</ul>` : ""}
      </li>`;
    })
    .join("");
  box.innerHTML = items;
  $("bookMeta").textContent = `${book.author} · ${book.publisher} · ${book.year}`;
}

function setActiveNav(docId) {
  document.querySelectorAll(".nav-list a, .nav-sub a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-doc") === docId && !a.getAttribute("href").includes("/s/"));
  });
  document.querySelectorAll(".nav-sub").forEach((ul) => {
    ul.classList.toggle("collapsed", ul.getAttribute("data-parent") !== docId);
  });
}

function renderToc(doc) {
  const list = $("tocList");
  const heads = (doc && doc.headings) || [];
  if (!heads.length) {
    list.innerHTML = "<li class='muted'>本页无小标题</li>";
    return;
  }
  list.innerHTML = heads
    .map(
      (h) =>
        `<li><a class="l${h.level}" href="#/${doc.id}/s/${encodeURIComponent(h.id)}">${escapeHtml(h.title)}</a></li>`
    )
    .join("");
}

function homeHTML(book) {
  const chapters = state.nav.docs
    .filter((d) => d.kind === "chapter" || d.kind === "appendix" || d.kind === "toc" || d.kind === "notes")
    .map((d) => `<li><a href="#/${d.id}">${escapeHtml(d.title)}</a></li>`)
    .join("");
  return `
    <div class="home-card">
      <p class="kicker">${escapeHtml(book.series)}</p>
      <h1>${escapeHtml(book.title)}</h1>
      <div class="meta-grid">
        <span>著者</span><span>${escapeHtml(book.author)}</span>
        <span>出版</span><span>${escapeHtml(book.publisher)}，${escapeHtml(book.year)}</span>
        <span>ISBN</span><span>${escapeHtml(book.isbn)}</span>
        <span>文稿</span><span>${book.pages} 个源页，${book.figures} 幅插图，${book.equations} 个编号公式</span>
      </div>
    </div>
    <p>这是根据提供的可编辑转录文稿整理的阅读页，保留原书章节、页码、公式和插图。目录中的「序」与「前言」在本次文稿中没有正文。</p>
    <ul class="chapter-list">${chapters}</ul>
    <p class="attr">隐藏链接不是访问控制；知道地址的人都可以打开。仓库若公开，这些文件也可以从 GitHub 读取。</p>
  `;
}

function pagerHTML(doc) {
  const docs = state.nav.docs;
  const i = docs.findIndex((d) => d.id === doc.id);
  const prev = i > 0 ? docs[i - 1] : null;
  const next = i >= 0 && i < docs.length - 1 ? docs[i + 1] : null;
  return `<nav class="pager">
    <span>${prev ? `<a href="#/${prev.id}">← ${escapeHtml(prev.title)}</a>` : ""}</span>
    <span>${next ? `<a href="#/${next.id}">${escapeHtml(next.title)} →</a>` : ""}</span>
  </nav>`;
}

async function show(route) {
  const article = $("article");
  const kicker = $("kicker");
  try {
    if (route.type === "eq" && state.nav.eq[route.tag]) {
      const hit = state.nav.eq[route.tag];
      return await show({ type: "doc", id: hit.doc, anchor: hit.anchor });
    }
    if (route.type === "fig" && state.nav.fig[route.id]) {
      const hit = state.nav.fig[route.id];
      return await show({ type: "doc", id: hit.doc, anchor: hit.anchor });
    }
    if (route.type === "page") {
      const hit = state.nav.page[route.source];
      if (hit) return await show({ type: "doc", id: hit.doc, source: route.source, anchor: hit.anchor });
    }
    if (route.type === "home") {
      state.currentDoc = "home";
      kicker.textContent = "知识库";
      document.title = "量子光学 · 知识库";
      article.innerHTML = homeHTML(state.nav.book);
      renderToc(null);
      setActiveNav(null);
      $("article").focus({ preventScroll: true });
      return;
    }
    const id = route.id;
    const doc = docById(id);
    if (!doc) {
      article.innerHTML = `<p class="error">没有找到对应的章节。</p><p><a href="#/">返回封面</a></p>`;
      return;
    }
    state.currentDoc = id;
    kicker.textContent = doc.title;
    document.title = doc.title + " · 量子光学";
    article.innerHTML = `<p class="loading">正在载入……</p>`;
    const html = await loadDoc(id);
    const attr = `<p class="attr">张智明《量子光学》，科学出版社，2015，ISBN 978-7-03-043370-1。正文与插图来自提供的转录文稿，未改写原书表述。</p>`;
    article.innerHTML = html + pagerHTML(doc) + attr;
    renderMath(article);
    renderToc(doc);
    setActiveNav(id);
    let target = null;
    if (route.anchor) target = document.getElementById(route.anchor);
    if (!target && route.source) target = document.getElementById("p-" + route.source);
    if (!target && route.heading) {
      const hid = decodeURIComponent(route.heading);
      target = document.getElementById(hid) || document.getElementById("s-" + hid);
    }
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  } catch (err) {
    article.innerHTML = `<p class="error">${escapeHtml(err.message || err)}</p>`;
  }
}

function bindSearch() {
  const input = $("q");
  const panel = $("searchPanel");
  let last = "";
  const run = async () => {
    const q = input.value.trim();
    last = q;
    if (!q) {
      panel.classList.remove("open");
      panel.innerHTML = "";
      return;
    }
    panel.classList.add("open");
    panel.innerHTML = `<div class="empty">正在检索……</div>`;
    await ensureSearch();
    if (input.value.trim() !== last) return;
    const hits = search(q);
    if (!hits.length) {
      panel.innerHTML = `<div class="empty">没有找到「${escapeHtml(q)}」</div>`;
      return;
    }
    panel.innerHTML = hits
      .map(
        (h) => `<a class="hit" href="${h.doc.route}">
          <span>${highlight(h.doc.title, q)}</span>
          ${h.snippet ? `<span class="meta">${highlight(h.snippet, q)}</span>` : ""}
        </a>`
      )
      .join("");
  };
  input.addEventListener("input", () => {
    clearTimeout(input._t);
    input._t = setTimeout(run, 160);
  });
  input.addEventListener("focus", run);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      panel.classList.remove("open");
      input.blur();
    }
    if (ev.key === "Enter") {
      const first = panel.querySelector(".hit");
      if (first) {
        ev.preventDefault();
        first.click();
      }
    }
  });
  document.addEventListener("click", (ev) => {
    if (!panel.contains(ev.target) && ev.target !== input) panel.classList.remove("open");
  });
  panel.addEventListener("click", (ev) => {
    if (ev.target.closest(".hit")) panel.classList.remove("open");
  });
}

function bindChrome() {
  const sidebar = $("sidebar");
  const backdrop = $("backdrop");
  const toggle = () => {
    const open = !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("show", open);
  };
  $("menuBtn").addEventListener("click", toggle);
  backdrop.addEventListener("click", toggle);
  $("themeBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ql-wiki-theme", next); } catch (_) {}
  });
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a.xref");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (href.startsWith("#/")) {
      /* hash routing handles it */
    }
  });
}

function restoreTheme() {
  try {
    const t = localStorage.getItem("ql-wiki-theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (_) {}
}

async function main() {
  restoreTheme();
  bindChrome();
  bindSearch();
  try {
    await loadNav();
    renderSidebar();
    await show(parseHash());
  } catch (err) {
    $("article").innerHTML = `<p class="error">${escapeHtml(err.message || err)}</p>`;
  }
  window.addEventListener("hashchange", () => {
    $("sidebar").classList.remove("open");
    $("backdrop").classList.remove("show");
    show(parseHash());
  });
}

main();
