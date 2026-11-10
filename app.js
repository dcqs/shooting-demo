/* ============================================================
 * app.js —— 数据驱动的内容渲染 + 可视化内容管理 + 管理员门禁
 * 设计要点：
 *   1) 所有「更多内容」都由 content 数组动态渲染；
 *   2) BLOCK_TYPES 是内容类型的注册表，新增展示类型只需在这里登记；
 *   3) 内容管理入口默认对游客隐藏，仅管理员登录后可见（前端门禁）。
 * ============================================================ */

/* ---------- 内容类型注册表（可扩展点） ---------- */
const BLOCK_TYPES = {
  text: {
    label: "文本块", icon: "📝",
    fields: [
      { key: "title", label: "标题", type: "text" },
      { key: "body", label: "正文（支持 **加粗** 与 “- ”开头的列表）", type: "textarea" },
      { key: "align", label: "对齐方式", type: "select", options: ["left", "center"], labels: ["左对齐", "居中"] },
    ],
  },
  image: {
    label: "图片", icon: "🖼️",
    fields: [
      { key: "url", label: "图片地址（URL 或本地路径，如 assets/xxx.jpg）", type: "text" },
      { key: "caption", label: "说明文字", type: "text" },
    ],
  },
  video: {
    label: "视频", icon: "🎬",
    fields: [
      { key: "src", label: "视频地址（URL 或本地路径）", type: "text" },
      { key: "title", label: "标题", type: "text" },
      { key: "caption", label: "说明文字", type: "text" },
    ],
  },
  gallery: {
    label: "图集", icon: "📷",
    fields: [
      { key: "title", label: "标题", type: "text" },
      {
        key: "items", label: "图片列表", type: "list", itemLabel: "图片",
        itemFields: [
          { key: "url", label: "图片地址", type: "text" },
          { key: "caption", label: "说明", type: "text" },
        ],
      },
    ],
  },
  timeline: {
    label: "时间线", icon: "🕒",
    fields: [
      { key: "title", label: "标题", type: "text" },
      {
        key: "items", label: "节点列表", type: "list", itemLabel: "节点",
        itemFields: [
          { key: "date", label: "时间 / 标签", type: "text" },
          { key: "title", label: "标题", type: "text" },
          { key: "desc", label: "说明", type: "text" },
        ],
      },
    ],
  },
  links: {
    label: "链接", icon: "🔗",
    fields: [
      { key: "title", label: "标题", type: "text" },
      {
        key: "items", label: "链接列表", type: "list", itemLabel: "链接",
        itemFields: [
          { key: "label", label: "名称", type: "text" },
          { key: "url", label: "地址", type: "text" },
          { key: "desc", label: "说明", type: "text" },
        ],
      },
    ],
  },
  divider: { label: "分隔线", icon: "➖", fields: [] },
};

/* ---------- 状态与存储 ---------- */
const STORAGE_KEY = "showcase_content_v1";
let content = loadContent();
let modalState = { mode: "add", type: null, id: null };

function loadContent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
    }
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(window.SEED_CONTENT || []));
}
function saveContent() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(content)); } catch (e) {}
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 管理员门禁（前端） ----------
 * 说明：静态站点没有后端，这里是纯前端门禁，用于「隐藏管理入口、阻止游客误改」。
 * 它无法阻止会看源码的人刻意绕过；但对外发布的内容只能由拥有仓库权限的人改动。
 * 默认密码：Shoot@2026
 * 修改密码：用 __hashStr("新密码") 生成哈希，替换下方 ADMIN_HASH 即可。
 */
const ADMIN_HASH = "bbed419c"; // hashStr("Shoot@2026")
const AUTH_KEY = "showcase_admin_ok";

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}
function isAdmin() {
  try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
}
function setAdmin(v) {
  try { if (v) sessionStorage.setItem(AUTH_KEY, "1"); else sessionStorage.removeItem(AUTH_KEY); } catch (e) {}
}

/* ---------- 工具：转义 & 极简 Markdown ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function miniMd(s) {
  let html = esc(s || "");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const lines = html.split("\n").map((line) =>
    /^\s*[-*]\s+/.test(line)
      ? "<li>" + line.replace(/^\s*[-*]\s+/, "") + "</li>"
      : line
  );
  html = lines.join("\n");
  html = html.replace(/(?:<li>[\s\S]*?<\/li>(?:<br>)*)+/g, (m) =>
    "<ul>" + m.replace(/<br>/g, "") + "</ul>"
  );
  html = html.replace(/\n/g, "<br>");
  return html;
}
function placeholder(text) {
  return `<div class="block__media" style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:var(--muted);background:linear-gradient(135deg,#1a1f2e,#141823)">${esc(text)}</div>`;
}

/* ---------- 渲染：内容块 ---------- */
function blockTitle(block, fallback) {
  return `<h3 class="block__title">${esc(block.title || fallback)}</h3>`;
}
function renderBlock(block) {
  const wrap = (inner, opts = {}) =>
    `<div class="block ${opts.full ? "block--full" : ""} ${opts.center ? "block--center" : ""}">${inner}</div>`;

  switch (block.type) {
    case "text": {
      const body = `<div class="block__body">${miniMd(block.body || "")}</div>`;
      return wrap((block.title ? blockTitle(block) : "") + body, { full: true, center: block.align === "center" });
    }
    case "image": {
      const media = block.url ? `<img class="block__media" src="${esc(block.url)}" alt="${esc(block.caption || "")}" loading="lazy">` : placeholder("图片地址为空");
      const cap = block.caption ? `<p class="block__caption">${esc(block.caption)}</p>` : "";
      return wrap(blockTitle(block, "图片") + media + cap, { full: true });
    }
    case "video": {
      const media = block.src ? `<video class="block__media" src="${esc(block.src)}" controls preload="metadata" playsinline></video>` : placeholder("视频地址为空");
      const cap = block.caption ? `<p class="block__caption">${esc(block.caption)}</p>` : "";
      return wrap(blockTitle(block, "视频") + media + cap, { full: true });
    }
    case "gallery": {
      const imgs = (block.items || []).map((it) =>
        it.url ? `<img src="${esc(it.url)}" alt="${esc(it.caption || "")}" loading="lazy">` : ""
      ).join("");
      const cap = block.items && block.items.length ? "" : `<p class="block__caption">暂无图片</p>`;
      return wrap(blockTitle(block, "图集") + `<div class="gallery">${imgs}</div>` + cap, { full: true });
    }
    case "timeline": {
      const items = (block.items || []).map((it) =>
        `<li><span class="tl-date">${esc(it.date || "")}</span><div class="tl-title">${esc(it.title || "")}</div><div class="tl-desc">${esc(it.desc || "")}</div></li>`
      ).join("");
      return wrap(blockTitle(block, "时间线") + `<ul class="timeline">${items}</ul>`, { full: true });
    }
    case "links": {
      const cards = (block.items || []).map((it) =>
        `<a class="link-card" href="${esc(it.url || "#")}" target="_blank" rel="noopener"><div class="lc-label">${esc(it.label || "链接")}</div>${it.desc ? `<div class="lc-desc">${esc(it.desc)}</div>` : ""}<div class="lc-url">${esc(it.url || "")}</div></a>`
      ).join("");
      return wrap(blockTitle(block, "链接") + cards, { full: true });
    }
    case "divider":
      return `<div class="block block--divider"><hr></div>`;
    default:
      return "";
  }
}
function render() {
  const root = document.getElementById("contentRoot");
  const empty = document.getElementById("contentEmpty");
  if (!content.length) {
    root.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    root.innerHTML = content.map(renderBlock).join("");
  }
}

/* ---------- 表单生成 ---------- */
function inputHtml(f, attr, value) {
  if (f.type === "textarea")
    return `<textarea ${attr} rows="5" placeholder="${esc(f.placeholder || "")}">${esc(value)}</textarea>`;
  if (f.type === "select") {
    let o = `<select ${attr}>`;
    f.options.forEach((opt, i) => {
      o += `<option value="${esc(opt)}" ${opt === value ? "selected" : ""}>${esc(f.labels ? f.labels[i] : opt)}</option>`;
    });
    return o + "</select>";
  }
  return `<input type="text" ${attr} value="${esc(value)}" placeholder="${esc(f.placeholder || "")}">`;
}
function subItemHtml(field, data, idx) {
  let inner = `<div class="si-head"><span>${esc(field.itemLabel || "项")} #${idx + 1}</span><button class="icon-btn" data-remove-sub type="button" aria-label="删除该项">🗑</button></div>`;
  field.itemFields.forEach((f) => {
    const v = data ? data[f.key] ?? "" : "";
    inner += `<div class="field"><label>${esc(f.label)}</label>${inputHtml(f, `data-subfield="${esc(f.key)}"`, v)}</div>`;
  });
  return `<div class="subitem">${inner}</div>`;
}
function renderListField(field, value) {
  const items = value || [];
  let html = `<div class="field"><label>${esc(field.label)}</label><div class="subitems" data-list="${esc(field.key)}">`;
  items.forEach((it, i) => (html += subItemHtml(field, it, i)));
  html += `</div><button class="btn btn--ghost add-sub" data-add-list="${esc(field.key)}" type="button">＋ 添加${esc(field.itemLabel || "项")}</button></div>`;
  return html;
}
function buildForm(type, data) {
  const def = BLOCK_TYPES[type];
  if (!def.fields.length) return `<p class="field">该类型无需额外内容，保存后即插入一条分隔线。</p>`;
  let html = "";
  def.fields.forEach((f) => {
    const v = data ? (data[f.key] ?? (f.type === "list" ? [] : "")) : (f.type === "list" ? [] : "");
    if (f.type === "list") html += renderListField(f, v);
    else html += `<div class="field"><label>${esc(f.label)}</label>${inputHtml(f, `data-field="${esc(f.key)}"`, v)}</div>`;
  });
  return html;
}
function readForm() {
  const result = {};
  document.querySelectorAll("#modalBody [data-field]").forEach((el) => {
    result[el.getAttribute("data-field")] = el.value;
  });
  document.querySelectorAll("#modalBody [data-list]").forEach((listEl) => {
    const key = listEl.getAttribute("data-list");
    const items = [];
    listEl.querySelectorAll(":scope > .subitem").forEach((si) => {
      const obj = {};
      si.querySelectorAll("[data-subfield]").forEach((inp) => {
        obj[inp.getAttribute("data-subfield")] = inp.value;
      });
      items.push(obj);
    });
    result[key] = items;
  });
  return result;
}

/* ---------- 弹窗（添加 / 编辑） ---------- */
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");

function typePickerHtml() {
  let h = `<p class="field">选择要添加的内容类型：</p><div class="type-grid">`;
  Object.entries(BLOCK_TYPES).forEach(([k, v]) => {
    h += `<button class="btn btn--ghost type-opt" data-type="${k}" type="button">${v.icon} ${v.label}</button>`;
  });
  return h + `</div>`;
}
function openAddModal() {
  if (!isAdmin()) return;
  modalState = { mode: "add", type: null, id: null };
  modalTitle.textContent = "添加内容块";
  modalBody.innerHTML = typePickerHtml();
  modal.hidden = false;
}
function openEditModal(id) {
  if (!isAdmin()) return;
  const block = content.find((b) => b.id === id);
  if (!block) return;
  modalState = { mode: "edit", type: block.type, id };
  modalTitle.textContent = "编辑：" + BLOCK_TYPES[block.type].label;
  modalBody.innerHTML = buildForm(block.type, block);
  modal.hidden = false;
}
function closeModal() { modal.hidden = true; modalBody.innerHTML = ""; }

/* ---------- 抽屉（内容管理列表） ---------- */
const drawer = document.getElementById("drawer");
const blockList = document.getElementById("blockList");

function renderBlockList() {
  blockList.innerHTML = content.map((b, i) => {
    const t = BLOCK_TYPES[b.type] || { label: b.type, icon: "❓" };
    return `<li>
      <div class="bl-info">
        <div class="bl-type">${t.icon} ${t.label}</div>
        <div class="bl-title">${esc(b.title || "(无标题)")}</div>
      </div>
      <div class="bl-actions">
        <button class="btn btn--ghost" data-up="${b.id}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn--ghost" data-down="${b.id}" ${i === content.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn btn--ghost" data-edit="${b.id}">编辑</button>
        <button class="btn btn--ghost" data-del="${b.id}">删除</button>
      </div>
    </li>`;
  }).join("");
}
function openDrawer() {
  if (!isAdmin()) { openLogin(); return; }
  drawer.hidden = false;
  renderBlockList();
}
function closeDrawer() { drawer.hidden = true; }

/* ---------- 管理员登录 UI ---------- */
const loginModal = document.getElementById("loginModal");
const adminPwd = document.getElementById("adminPwd");
const loginErr = document.getElementById("loginErr");

function refreshAdminUI() {
  const admin = isAdmin();
  const editBtn = document.getElementById("openEditorBtn");
  const badge = document.getElementById("adminBadge");
  const logoutBtn = document.getElementById("logoutBtn");
  if (editBtn) editBtn.hidden = !admin;
  if (badge) badge.hidden = !admin;
  if (logoutBtn) logoutBtn.hidden = !admin;
  if (!admin) closeDrawer();
}
function openLogin() {
  if (!loginModal) return;
  loginModal.hidden = false;
  adminPwd.value = "";
  loginErr.hidden = true;
  setTimeout(() => adminPwd && adminPwd.focus(), 60);
}
function closeLogin() { if (loginModal) loginModal.hidden = true; }
function submitLogin() {
  if (hashStr(adminPwd.value) === ADMIN_HASH) {
    setAdmin(true);
    refreshAdminUI();
    closeLogin();
    openDrawer();
  } else {
    loginErr.hidden = false;
    adminPwd.select();
  }
}
function logout() {
  setAdmin(false);
  refreshAdminUI();
  closeDrawer();
}

function deleteBlock(id) {
  content = content.filter((b) => b.id !== id);
  saveContent(); render(); renderBlockList();
}
function moveBlock(id, dir) {
  const i = content.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= content.length) return;
  [content[i], content[j]] = [content[j], content[i]];
  saveContent(); render(); renderBlockList();
}

/* ---------- 导入 / 导出 / 重置 ---------- */
function exportContent() {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "showcase-content.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
function importContent(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const p = JSON.parse(reader.result);
      if (!Array.isArray(p)) throw new Error("格式错误");
      content = p;
      saveContent(); render(); renderBlockList();
      alert("导入成功，共 " + content.length + " 个内容块。");
    } catch (e) {
      alert("导入失败：文件不是有效的内容 JSON。");
    }
  };
  reader.readAsText(file);
}
function resetContent() {
  if (!confirm("确定要重置为初始示例内容吗？当前本地修改将丢失。")) return;
  content = JSON.parse(JSON.stringify(window.SEED_CONTENT || []));
  saveContent(); render(); renderBlockList();
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  document.getElementById("openEditorBtn").addEventListener("click", openDrawer);
  document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
  document.getElementById("drawerMask").addEventListener("click", closeDrawer);
  document.getElementById("addBlockBtn").addEventListener("click", openAddModal);
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("modalMask").addEventListener("click", closeModal);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  document.getElementById("saveModal").addEventListener("click", () => {
    const vals = readForm();
    if (modalState.mode === "add") {
      if (!modalState.type) return;
      content.push({ id: uid(), type: modalState.type, ...vals });
    } else {
      const i = content.findIndex((b) => b.id === modalState.id);
      if (i >= 0) content[i] = { ...content[i], ...vals };
    }
    saveContent(); render(); renderBlockList(); closeModal();
  });
  document.getElementById("exportBtn").addEventListener("click", exportContent);
  document.getElementById("resetBtn").addEventListener("click", resetContent);

  // 管理员登录 / 退出
  document.getElementById("closeLogin").addEventListener("click", closeLogin);
  document.getElementById("loginMask").addEventListener("click", closeLogin);
  document.getElementById("cancelLogin").addEventListener("click", closeLogin);
  document.getElementById("submitLogin").addEventListener("click", submitLogin);
  adminPwd.addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });
  document.getElementById("logoutBtn").addEventListener("click", logout);

  const importFile = document.getElementById("importFile");
  document.getElementById("importBtn").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (e) => {
    if (e.target.files[0]) importContent(e.target.files[0]);
    e.target.value = "";
  });

  // 抽屉列表事件委托
  blockList.addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.up) moveBlock(t.dataset.up, -1);
    else if (t.dataset.down) moveBlock(t.dataset.down, 1);
    else if (t.dataset.edit) openEditModal(t.dataset.edit);
    else if (t.dataset.del) deleteBlock(t.dataset.del);
  });

  // 弹窗：类型选择 & 列表子项增删（事件委托）
  modalBody.addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.type) {
      modalState.type = t.dataset.type;
      modalBody.innerHTML = buildForm(t.dataset.type, null);
    } else if (t.dataset.addList) {
      const listEl = modalBody.querySelector(`[data-list="${t.dataset.addList}"]`);
      const field = BLOCK_TYPES[modalState.type].fields.find((f) => f.key === t.dataset.addList);
      const idx = listEl.children.length + 1;
      listEl.insertAdjacentHTML("beforeend", subItemHtml(field, null, idx));
    } else if (t.dataset.removeSub) {
      t.closest(".subitem").remove();
    }
  });

  // Esc 关闭（按层级）
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!loginModal.hidden) closeLogin();
    else if (!modal.hidden) closeModal();
    else if (!drawer.hidden) closeDrawer();
  });
}

/* ---------- 交互增强：秘密入口 / 回到顶部 / 全屏 / 导航高亮 ---------- */
function initUX() {
  // 秘密入口：连续点击左上角 logo 5 次 → 管理员登录
  const brand = document.getElementById("brandLogo");
  let clicks = 0, timer = null;
  brand.addEventListener("click", (e) => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => (clicks = 0), 1200);
    if (clicks >= 5) {
      e.preventDefault();
      clicks = 0;
      isAdmin() ? openDrawer() : openLogin();
    }
  });

  // 访问 #admin 直接弹登录
  if (location.hash === "#admin" || location.hash === "#admin-login") {
    setTimeout(() => (isAdmin() ? openDrawer() : openLogin()), 250);
  }

  // 全屏播放
  const video = document.getElementById("mainVideo");
  const fsBtn = document.getElementById("fullscreenBtn");
  if (fsBtn) fsBtn.addEventListener("click", () => {
    if (video.requestFullscreen) video.requestFullscreen();
    else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
  });

  // 视频加载提示：可播放后淡出
  const loading = document.getElementById("videoLoading");
  if (loading) {
    const hideLoading = () => loading.classList.add("is-hidden");
    video.addEventListener("canplay", hideLoading, { once: true });
    video.addEventListener("playing", hideLoading, { once: true });
    video.addEventListener("error", hideLoading, { once: true });
    if (video.readyState >= 3) hideLoading();
  }

  // 回到顶部
  const toTop = document.getElementById("toTop");
  window.addEventListener("scroll", () => {
    toTop.hidden = window.scrollY < 480;
  }, { passive: true });
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  // 导航高亮
  const links = Array.from(document.querySelectorAll(".nav__link"));
  const secs = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) =>
          a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id)
        );
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    secs.forEach((s) => io.observe(s));
  }
}

/* ---------- 应用站点配置 ---------- */
function applyConfig() {
  const c = window.SITE_CONFIG || {};
  if (c.navTitle) document.getElementById("navTitle").textContent = c.navTitle;
  if (c.heroEyebrow) document.getElementById("heroEyebrow").textContent = c.heroEyebrow;
  if (c.heroTitle) document.getElementById("heroTitle").textContent = c.heroTitle;
  if (c.heroSubtitle) document.getElementById("heroSubtitle").textContent = c.heroSubtitle;
  if (c.videoSrc) {
    const v = document.getElementById("mainVideo");
    v.querySelector("source").src = c.videoSrc;
    v.load();
  }
  if (c.downloadName) document.getElementById("downloadVideo").setAttribute("download", c.downloadName);
}

/* 修改管理密码时可用：控制台执行 __hashStr("新密码") */
window.__hashStr = hashStr;

/* ---------- 启动 ---------- */
applyConfig();
render();
bindEvents();
initUX();
refreshAdminUI();
