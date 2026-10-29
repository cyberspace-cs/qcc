/* 企信查 QCC v2 前端：对标企查查/天眼查
   路由：home/search/person/path/company/graph/report/vip/open/monitor/map/login */
const app = document.getElementById("app");
let USER = null;
let SEARCH_TAB = "company";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const badge = (text, color) => `<span class="badge ${color}">${esc(text)}</span>`;
const statusBadge = t => t === "存续" ? badge("存续","green") : t === "注销" ? badge("注销","gray") : badge("吊销","red");
const riskMini = r => r && r.total ? `<span class="risk-mini"><i class="r">诉讼${r.lawsuit}</i><i class="o">失信${r.dishonest + r.zhixing}</i></span>` : "";
const sentimentBadge = s => s === 1 ? badge("正面","green") : s === -1 ? badge("负面","red") : badge("中性","blue");

async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) { goLogin(); throw new Error("unauthorized"); }
  return { status: r.status, body };
}
function goLogin() {
  const cur = location.hash.slice(1) || "/home";
  location.hash = "#/login?from=" + encodeURIComponent(cur);
}
function needLogin(target) { if (!USER) { goLogin(); return false; } return true; }

function renderUserArea() {
  const el = document.getElementById("userArea");
  if (!USER) {
    el.innerHTML = `<a class="btn" onclick="location.hash='#/login?from='+encodeURIComponent(location.hash.slice(1)||'/home')">登录 / 注册</a>`;
  } else {
    el.innerHTML = `<span class="avatar">${esc(USER.username[0].toUpperCase())}</span>
      <span><b>${esc(USER.username)}</b> ${badge(USER.plan, USER.role >= 2 ? "orange" : "blue")}</span>
      <a class="btn" onclick="logout()">退出</a>`;
  }
}
async function logout() { await api("/api/auth/logout", { method: "POST" }); USER = null; renderUserArea(); location.hash = "#/home"; route(); }

/* ---------------- 首页 ---------------- */
const QUICK = [
  ["查老板","#/person","老板背调"],["查关系","#/path","关联路径"],["股权穿透","#/company/10000001","穿透图"],
  ["企业地图","#/map","地理分布"],["监控雷达","#/monitor","变更推送"],["信用报告","#/company/10000001","一键生成"],
  ["批量查询","#/open","API对接"],["三要素核验","#/open","开户合规"],["开放平台","#/open","数据接口"],
  ["会员权益","#/vip","VIP/SVIP"],["高级筛选","#/search","精准圈客"],["系统监控","#/monitor","缓存/事件"],
];
async function viewHome() {
  app.innerHTML = `
    <div class="hero">
      <h1>查企业 · 查老板 · 查关系</h1>
      <p>4亿+企业主体数据库 · 工商/司法/知识产权全景档案 · 股权穿透与实控人挖掘（演示数据）</p>
      <div class="search-tabs" id="stabs">
        <span class="active" data-t="company">查企业</span><span data-t="person">查老板</span><span data-t="path">查关系</span>
      </div>
      <div id="searchArea"></div>
      <div class="chips" id="hotChips"></div>
      <div class="hero-stats">
        <div><b>4亿+</b><span>企业主体库（演示）</span></div><div><b>&lt;300ms</b><span>企业主页 P95</span></div>
        <div><b>&lt;800ms</b><span>图谱查询 P95</span></div><div><b>200+</b><span>开放API（对标）</span></div>
      </div>
    </div>
    <div class="grid cols-2-1">
      <div class="card"><h3>热门应用</h3><div class="qgrid">${QUICK.map(q =>
        `<div class="qitem" onclick="location.hash='${q[1]}'"><span class="ic">◆</span>${q[0]}<p class="muted" style="margin-top:4px">${q[2]}</p></div>`).join("")}</div></div>
      <div class="card"><h3>热搜企业榜</h3><ul class="hot-list" id="hot"><li class="muted">加载中…</li></ul></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>商业快讯</h3><ul class="flash" id="flash"><li class="muted">加载中…</li></ul></div>
      <div class="card" style="background:linear-gradient(135deg,#fff7ec,#fff)">
        <h3>开通会员 · 深度挖掘企业价值</h3>
        <p class="muted" style="line-height:2">VIP 会员：全部风险信息 · 股权穿透不限层 · 历史沿革 · 信用报告<br>
        SVIP：另享上市公司财务三表 · 开放API 1000次/日 · 报告不限量</p>
        <button class="btn-cta" style="border:none;border-radius:8px;padding:11px 26px;font-weight:700;color:#fff;cursor:pointer" onclick="location.hash='#/vip'">立即开通</button>
      </div>
    </div>`;
  renderSearchArea();
  document.querySelectorAll("#stabs span").forEach(s => s.onclick = () => {
    SEARCH_TAB = s.dataset.t;
    document.querySelectorAll("#stabs span").forEach(x => x.classList.toggle("active", x === s));
    renderSearchArea();
  });
  const [hot, flash] = await Promise.all([api("/api/hot"), api("/api/news/flash")]);
  document.getElementById("hot").innerHTML = hot.body.data.length ? hot.body.data.map((h, i) =>
    `<li onclick="location.hash='#/search?kw=${encodeURIComponent(h.kw)}'"><span><i class="no">${i + 1}</i>${esc(h.kw)}</span><span class="score">${h.score} 次搜索</span></li>`).join("")
    : `<li class="muted">暂无热搜，先搜索试试～</li>`;
  document.getElementById("flash").innerHTML = flash.body.data.map(f =>
    `<li><span class="t">${esc(f.time)}</span><span>${esc(f.title)}</span></li>`).join("");
  const chips = await api("/api/hot");
  document.getElementById("hotChips").innerHTML = `<span class="lab">热搜：</span>` +
    (chips.body.data.slice(0, 6).map(h => `<span class="chip" onclick="location.hash='#/search?kw=${encodeURIComponent(h.kw)}'">${esc(h.kw)}</span>`).join("") || `<span class="chip">华为</span><span class="chip">星辰</span>`);
}
function renderSearchArea() {
  const area = document.getElementById("searchArea");
  if (SEARCH_TAB === "path") {
    area.innerHTML = `<div class="search-box" style="max-width:720px" id="pathPick"><span class="muted" style="color:#fff">加载企业列表…</span></div>`;
    fillPathPickers("pathPick");
    return;
  }
  area.innerHTML = `<div class="search-box">
    <input id="kw" placeholder="${SEARCH_TAB === "person" ? "请输入老板姓名（如：张三）" : "请输入企业名称、法人、统一社会信用代码（如：星辰）"}" />
    <button class="btn-cta" id="goBtn">${SEARCH_TAB === "person" ? "查老板" : "查一下"}</button></div>`;
  const go = () => {
    const kw = document.getElementById("kw").value.trim();
    if (!kw) return;
    location.hash = SEARCH_TAB === "person" ? "#/person?kw=" + encodeURIComponent(kw) : "#/search?kw=" + encodeURIComponent(kw);
  };
  document.getElementById("goBtn").onclick = go;
  document.getElementById("kw").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}
async function fillPathPickers(elId) {
  const { body } = await api("/api/map/companies");
  const opts = body.data.points.map(p => `<option value="${p.companyId}">${esc(p.name)}</option>`).join("");
  document.getElementById(elId).innerHTML = `
    <select id="pFrom" class="inp" style="flex:1">${opts}</select>
    <span style="align-self:center;font-weight:700">→</span>
    <select id="pTo" class="inp" style="flex:1">${opts}</select>
    <button class="btn-cta" style="padding:0 22px" onclick="doPath(document.getElementById('pFrom').value,document.getElementById('pTo').value)">找关系</button>`;
}
function doPath(from, to) { location.hash = `#/path?from=${from}&to=${to}`; }

/* ---------------- 登录 ---------------- */
async function viewLogin(qs) {
  app.innerHTML = `<div class="login-card">
    <h2>登录企信查</h2><p class="muted">查询企业/老板/关系数据需要登录（对标企查查登录墙策略）</p>
    <input id="lu" class="inp" style="width:100%" placeholder="用户名" value="${esc(qs.u || "")}" />
    <input id="lp" class="inp" style="width:100%;margin-top:10px" type="password" placeholder="密码" value="123456" />
    <button class="btn primary" id="doLogin">登 录</button>
    <div class="quick">
      <button class="btn" onclick="quickLogin('user1')">一键普通用户</button>
      <button class="btn" onclick="quickLogin('vip1')">一键VIP</button>
      <button class="btn" onclick="quickLogin('admin')">一键管理员</button>
    </div>
    <p class="muted" style="margin-top:14px">演示账号：user1 / vip1 / admin，密码均为 123456。登录后可回跳原页面（from=${esc(qs.from || "/home")}）</p>
  </div>`;
  const doLogin = async (u, p) => {
    const { status, body } = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
    if (body.code === 0) {
      const me = await api("/api/auth/me"); USER = me.body.data; renderUserArea();
      location.hash = "#" + decodeURIComponent(qs.from || "/home");
    } else alert(body.msg || "登录失败");
  };
  document.getElementById("doLogin").onclick = () => doLogin(document.getElementById("lu").value.trim(), document.getElementById("lp").value);
  window.quickLogin = u => doLogin(u, "123456");
}

/* ---------------- 搜索结果 ---------------- */
async function viewSearch(qs) {
  app.innerHTML = `<div class="loading">ES 检索中…</div>`;
  const { body } = await api("/api/search?keyword=" + encodeURIComponent(qs.kw || ""));
  if (body.code !== 0) { app.innerHTML = `<div class="card" style="margin-top:18px">${esc(body.msg)}</div>`; return; }
  const sugg = body.suggestion ? `<div class="suggest">未找到与「${esc(qs.kw)}」匹配的结果，您是不是要找：<a href="#/search?kw=${encodeURIComponent(body.suggestion.name)}">${esc(body.suggestion.name)}</a>（拼音纠错）</div>` : "";
  app.innerHTML = `
    <div class="hero" style="padding:22px 28px;margin-bottom:4px">
      <div class="search-box" style="max-width:520px">
        <input id="kw2" value="${esc(qs.kw || "")}" placeholder="输入企业名称/法人/信用代码" />
        <button class="btn-cta" onclick="doSearch2()">查一下</button>
      </div>
      <p style="margin:12px 0 0;font-size:12px">ES 检索耗时 <b>${body.costMs}ms</b> · 命中 <b>${body.total}</b> 条（Elasticsearch 唯一搜索入口）</p>
    </div>${sugg}
    <div class="card">${body.data.length ? body.data.map(r => `
      <div class="result-item">
        <h4 onclick="location.hash='#/company/${r.companyId}'">${r.companyName} ${statusBadge(r.statusText)} ${riskMini(r.risk)}</h4>
        <div class="result-meta">
          <span>法定代表人：${r.legalPerson}</span><span>注册资本：${esc(r.registerCapital)}</span>
          <span>成立：${esc(r.establishTime)}</span><span>${esc(r.province)}</span><span>${esc(r.industry)}</span>
          ${r.tags.map(t => badge(t, "blue")).join(" ")}
        </div>
        <div class="result-meta" style="margin-top:6px"><span class="muted">信用代码：${esc(r.creditCode)}</span>
          <a href="#/graph/${r.companyId}" style="color:var(--blue)">股权穿透</a>
          <a href="#/path?from=${r.companyId}" style="color:var(--blue)">查关系</a>
          <a href="#/report/${r.companyId}" style="color:var(--blue)">信用报告</a></div>
      </div>`).join("") : `<div class="loading">无匹配结果</div>`}</div>`;
  document.getElementById("kw2").addEventListener("keydown", e => { if (e.key === "Enter") doSearch2(); });
}
function doSearch2() {
  const kw = document.getElementById("kw2").value.trim();
  if (kw) location.hash = "#/search?kw=" + encodeURIComponent(kw);
}

/* ---------------- 查老板 ---------------- */
async function viewPerson(qs) {
  if (!needLogin()) return;
  const kw = qs.kw || "";
  app.innerHTML = `
    <div class="hero" style="padding:22px 28px">
      <h1 style="font-size:20px">查老板 · 人物画像</h1>
      <div class="search-box" style="max-width:480px;margin-top:10px">
        <input id="pkw" value="${esc(kw)}" placeholder="输入老板姓名（如：张三）" />
        <button class="btn-cta" onclick="location.hash='#/person?kw='+encodeURIComponent(document.getElementById('pkw').value.trim())">查老板</button>
      </div>
    </div><div id="personBody"><div class="loading">输入姓名开始查询（演示人物：张三/李四/王五/陈明/周芸…）</div></div>`;
  if (kw) {
    const { body } = await api("/api/person/search?keyword=" + encodeURIComponent(kw));
    document.getElementById("personBody").innerHTML = `<div class="card" style="margin-top:14px">${body.data.length ? body.data.map(p => `
      <div class="person-card" onclick="location.hash='#/person/${p.pid}'">
        <div><h4>${esc(p.name)}</h4><p class="muted">${esc(p.title || "")} · ${esc(p.region)}</p>
          <div class="ptags">${p.tags.map(t => badge(t, "blue")).join("")}</div></div>
        <div style="text-align:right">${badge("关联企业 " + p.companyCount + " 家", p.companyCount > 2 ? "orange" : "blue")}
          <p class="muted" style="margin-top:6px">查看人物画像 →</p></div>
      </div>`).join("") : `<div class="loading">未找到该姓名的人物</div>`}</div>`;
  }
}
async function viewPersonProfile(pid) {
  if (!needLogin()) return;
  app.innerHTML = `<div class="loading">加载人物画像…</div>`;
  const { body } = await api("/api/person/" + pid);
  const d = body.data;
  app.innerHTML = `
    <div class="detail-head">
      <div><h2>${esc(d.name)} ${d.risks.count ? badge("风险 " + d.risks.count, "red") : badge("无个人风险", "green")}</h2>
        <p class="muted" style="margin-top:8px">${esc(d.title || "")} · ${esc(d.region)}</p>
        <div class="ptags" style="margin-top:10px">${d.tags.map(t => badge(t, "blue")).join("")}</div></div>
      <div style="text-align:right"><p class="muted">关联企业</p><div style="font-size:34px;font-weight:800;color:var(--blue)">${d.companies.length}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>名下企业（任职 / 持股）</h3>
      <table class="tbl"><tr><th>企业</th><th>角色</th><th>持股比例</th><th>状态</th><th>企业风险</th></tr>
      ${d.companies.map(c => `<tr><td style="color:var(--blue);cursor:pointer" onclick="location.hash='#/company/${c.companyId}'">${esc(c.companyName)}</td>
        <td>${c.roles.map(r => badge(r, "blue")).join(" ") || "—"}</td>
        <td><b>${c.ratios.join(" / ") || "—"}</b></td><td>${statusBadge(c.statusText)}</td>
        <td>${c.riskTotal ? badge("风险 " + c.riskTotal, "red") : badge("0", "green")}</td></tr>`).join("")}</table></div>
    <div class="card" style="margin-top:14px"><h3>个人风险（限高 / 失信）</h3>
      ${d.risks.xianxiao.concat(d.risks.dishonest).length ? d.risks.xianxiao.map(x => `<div class="risk-item"><b>限制高消费令 ${badge("限高", "red")}</b>
        <div class="meta"><span>案号：${esc(x.caseNo)}</span><span>法院：${esc(x.court)}</span><span>${esc(x.date)}</span><span>关联：${esc(x.target)}</span></div></div>`).join("")
        + d.risks.dishonest.map(x => `<div class="risk-item"><b>失信记录 ${badge("失信", "red")}</b><div class="meta"><span>案号：${esc(x.caseNo)}</span><span>${esc(x.court)}</span><span>${esc(x.date)}</span></div></div>`).join("")
      : `<p class="muted">未发现个人限高/失信记录 ✅</p>`}</div>`;
}

/* ---------------- 查关系 ---------------- */
async function viewPath(qs) {
  if (!needLogin()) return;
  app.innerHTML = `
    <div class="hero" style="padding:22px 28px">
      <h1 style="font-size:20px">查关系 · 多主体关联路径</h1>
      <div id="pathPick" class="search-box" style="max-width:760px;margin-top:12px"><span style="color:#fff">加载企业列表…</span></div>
      <p style="margin:10px 0 0;font-size:12px;opacity:.85">基于 NebulaGraph 边（HOLD_SHARE / WORK_AT / INVEST）BFS 最短路径，结果缓存 Redis（qcc:graph:path:*）</p>
    </div><div id="pathBody" style="margin-top:16px"><div class="card"><p class="muted">选择两家企业，点击"找关系"开始挖掘</p></div></div>`;
  fillPathPickers("pathPick").then(() => {
    if (qs.from) document.getElementById("pFrom").value = qs.from;
    if (qs.to) document.getElementById("pTo").value = qs.to;
    if (qs.from && qs.to) runPath(qs.from, qs.to);
  });
}
async function runPath(from, to) {
  document.getElementById("pathBody").innerHTML = `<div class="loading">图计算挖掘中…</div>`;
  const { body } = await api(`/api/graph/path?from=${from}&to=${to}`);
  const d = body.data;
  if (!d.found) { document.getElementById("pathBody").innerHTML = `<div class="card"><p>${esc(d.msg)}</p></div>`; return; }
  const nodes = [];
  d.chain.forEach((s, i) => {
    if (i === 0) nodes.push(nodeHtml(s.frm, true));
    nodes.push(`<div class="plink"><span>${esc(s.label)}</span></div>`);
    nodes.push(nodeHtml(s.to, i === d.chain.length - 1));
  });
  function nodeHtml(n, clickable) {
    return `<div class="pnode ${n.type} ${clickable && n.type === "company" ? "clickable" : ""}"
      ${clickable && n.type === "company" ? `onclick="location.hash='#/company/${n.id}'"` : ""}>
      ${n.type === "person" ? "●" : "■"} ${esc(n.name)}</div>`;
  }
  document.getElementById("pathBody").innerHTML = `<div class="card">
    <h3>最短关联路径 ${badge(d.hops + " 跳", "blue")} ${badge("缓存 " + body.cache, body.cache === "HIT" ? "green" : "orange")}<span class="muted" style="margin-left:10px">${body.costMs}ms</span></h3>
    <div class="path-chain">${nodes.join("")}</div></div>`;
}

/* ---------------- 企业详情（多Tab） ---------------- */
const CTABS = ["biz", "own", "risk", "history", "changes", "ip", "bizinfo", "news"];
const CTAB_NAMES = { biz: "工商信息", own: "股东与高管", risk: "风险信息", history: "历史沿革", changes: "变更记录", ip: "知识产权", bizinfo: "经营信息", news: "舆情动态" };
let cTab = "biz", CO = null, CID = null;
async function viewCompany(id) {
  if (!needLogin()) return;
  CID = id; cTab = "biz"; CO = null;
  app.innerHTML = `<div class="loading">查询企业主页…</div>`;
  let head;
  try { head = await api("/api/company/" + id); } catch (e) { return; }
  if (head.status === 429) {
    app.innerHTML = `<div class="card" style="margin-top:18px;text-align:center;padding:40px">
      <h3 style="justify-content:center;color:var(--red)">${esc(head.body.msg)}</h3>
      <p class="muted" style="margin-top:10px">对应 LLD 5.4：IP+账号双层滑动窗口限流（演示阈值 30 次/分钟/IP）</p></div>`;
    return;
  }
  if (!head.body.data) { app.innerHTML = `<div class="card" style="margin-top:18px">未找到该企业</div>`; return; }
  const all = await api("/api/company/" + id + "/all");
  CO = all.body.data;
  const d = head.body.data, rs = CO.riskSummary;
  app.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(d.companyName)} ${statusBadge(d.statusText)} ${riskMini(d.risk)}
          ${CO.listed ? badge(CO.stockCode, "orange") : ""}</h2>
        <div class="meta-line">统一社会信用代码：<b>${esc(d.creditCode)}</b>
          ${head.body.cache ? badge("Redis " + head.body.cache + " · " + head.body.costMs + "ms" + (head.body.ttl ? " · TTL " + head.body.ttl + "s" : ""), head.body.cache === "HIT" ? "green" : "orange") : ""}</div>
        <div class="kv">
          <span>法定代表人：<b>${esc(d.legalPerson)}</b></span><span>注册资本：<b>${esc(d.registerCapital)}</b></span>
          <span>成立：<b>${esc(d.establishTime)}</b></span><span>${esc(d.industry)}</span><span>${esc(d.province)}</span></div>
        <div class="ptags" style="margin-top:10px">${d.tags.map(t => badge(t, "blue")).join(" ")}</div>
      </div>
      <div class="detail-actions">
        <button class="btn-cta" style="border:none;border-radius:8px;padding:10px 18px;color:#fff;font-weight:700;cursor:pointer" onclick="location.hash='#/report/${id}'">生成信用报告</button>
        <a class="btn" href="#/graph/${id}">股权穿透</a>
        <a class="btn" href="#/path?from=${id}">查关系</a>
        <a class="btn" onclick="subscribeRadar(${id})">订阅雷达</a>
      </div>
    </div>
    <div class="tabs">${CTABS.map(t => `<button data-tab="${t}" class="${t === cTab ? "active" : ""}" onclick="switchTab('${t}')">${CTAB_NAMES[t]}${t === "risk" && rs.total ? ` (${rs.total})` : ""}${t === "changes" && CO.changes.length ? ` (${CO.changes.length})` : ""}</button>`).join("")}</div>
    <div class="card" id="tabBody"></div>`;
  renderCTab();
}
async function subscribeRadar(cid) {
  if (!needLogin()) return;
  const { body } = await api("/api/monitor/subscribe/" + cid, { method: "POST" });
  alert(body.msg);
}
function switchTab(t) { cTab = t; document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === t)); renderCTab(); }
function renderCTab() {
  const d = CO, el = document.getElementById("tabBody");
  const t = (title) => `<h3 style="margin:16px 0 10px">${title}</h3>`;
  if (cTab === "biz") el.innerHTML = `<div class="kv-grid">${[["企业名称", d.company_name], ["统一社会信用代码", d.credit_code],
    ["法定代表人", d.legal_person], ["注册资本", d.register_capital], ["成立日期", d.establish_time], ["登记状态", d.statusText],
    ["企业类型", d.org_type], ["登记机关", d.reg_institute], ["所属行业", d.industry], ["参保人数", d.employees],
    ["联系电话(非VIP脱敏)", d.contact], ["注册地址", d.address]].map(([k, v]) =>
    `<div class="kv-row"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join("")}</div>`;
  else if (cTab === "own") el.innerHTML = t("股东信息（HOLD_SHARE 边）") + `<table class="tbl"><tr><th>股东</th><th>类型</th><th>持股比例</th></tr>
      ${d.shareholders.map(s => `<tr><td>${esc(s.name)}</td><td>${badge(s.type, s.type === "自然人股东" ? "blue" : "green")}</td><td><b>${s.ratio}%</b></td></tr>`).join("") || emptyRow(3)}</table>`
    + t("主要人员（WORK_AT 边）") + `<table class="tbl"><tr><th>姓名</th><th>职位</th><th>任职日期</th></tr>
      ${d.staff.map(s => `<tr><td style="color:var(--blue);cursor:pointer" onclick="location.hash='#/person?kw=${encodeURIComponent(s.name)}'">${esc(s.name)}</td><td>${esc(s.position)}</td><td>${esc(s.entry)} 至 ${s.exit ? esc(s.exit) : "至今"}</td></tr>`).join("") || emptyRow(3)}</table>`
    + (d.invests.length ? t("对外投资（INVEST 边）") + `<table class="tbl"><tr><th>被投资企业</th><th>比例</th><th>认缴出资</th></tr>
      ${d.invests.map(s => `<tr><td>${esc(s.name)}</td><td>${s.ratio}%</td><td>${esc(s.amount)}</td></tr>`).join("")}</table>` : "");
  else if (cTab === "risk") {
    const items = [["lawsuit", "司法诉讼"], ["dishonest", "失信被执行"], ["zhixing", "被执行人"], ["xianxiao", "限制高消费"],
      ["penalty", "行政处罚"], ["abnormal", "经营异常"], ["pledge", "股权出质"], ["mortgage", "动产抵押"], ["guarantee", "对外担保"]];
    el.innerHTML = `<div class="risk-counts">${items.map(([k, n]) => {
      const v = d.riskSummary[k] ?? 0;
      return `<div class="rc"><div class="v ${v ? "some" : "zero"}">${v}</div><p>${n}</p></div>`;
    }).join("")}</div>`
      + t("司法诉讼") + (d.lawsuits.map(l => `<div class="risk-item"><b>${esc(l.title)} ${badge(l.statusText, "orange")}</b>
        <div class="meta"><span>${esc(l.ctype)}</span><span>${esc(l.court)}</span><span>${esc(l.date)}</span></div></div>`).join("") || `<p class="muted">暂无 ✅</p>`)
      + t("失信被执行") + (d.dishonest.map(x => `<div class="risk-item"><b>${esc(x.caseNo)} ${badge("失信", "red")}</b>
        <div class="meta"><span>立案：${esc(x.date)}</span><span>行为：${esc(x.behavior)}</span><span>${esc(x.court)}</span><span>履行：${esc(x.perform)}</span><span>标的：${esc(x.amount)}</span></div></div>`).join("") || `<p class="muted">暂无 ✅</p>`)
      + t("被执行人") + (d.zhixing.map(x => `<div class="risk-item"><b>${esc(x.caseNo)} ${badge("被执行", "orange")}</b>
        <div class="meta"><span>立案：${esc(x.date)}</span><span>标的：${esc(x.amount)}</span><span>${esc(x.court)}</span></div></div>`).join("") || `<p class="muted">暂无 ✅</p>`)
      + t("限制高消费") + (d.xianxiao.map(x => `<div class="risk-item"><b>${esc(x.caseNo)} ${badge("限高", "red")}</b>
        <div class="meta"><span>限高对象：${esc(x.target)}</span><span>${esc(x.court)}</span><span>${esc(x.date)}</span></div></div>`).join("") || `<p class="muted">暂无 ✅</p>`)
      + t("行政处罚 / 经营异常") + (d.penalties.map(p => `<div class="risk-item"><b>${esc(p.reason)} ${badge("行政处罚", "red")}</b>
        <div class="meta"><span>${esc(p.org)}</span><span>${esc(p.date)}</span><span>${esc(p.result)}</span></div></div>`).join("")
        + d.abnormal.map(a => `<div class="risk-item"><b>${esc(a.reason)} ${badge("经营异常", "orange")}</b>
        <div class="meta"><span>${esc(a.org)}</span><span>${esc(a.date)}</span></div></div>`).join("") || (!d.penalties.length && !d.abnormal.length ? `<p class="muted">暂无 ✅</p>` : ""))
      + t("股权出质 / 动产抵押 / 对外担保") + `<table class="tbl"><tr><th>类别</th><th>明细</th><th>金额/份额</th><th>状态</th><th>日期</th></tr>
        ${d.pledges.map(p => `<tr><td>${badge("股权出质", "orange")}</td><td>出质人 ${esc(p.pledgor)} → 质权人 ${esc(p.pledgee)}</td><td>${esc(p.shares)}</td><td>${esc(p.status)}</td><td>${esc(p.date)}</td></tr>`).join("")
        + d.mortgages.map(m => `<tr><td>${badge("动产抵押", "blue")}</td><td>${esc(m.property)}</td><td>${esc(m.amount)}</td><td>${esc(m.status)}</td><td>${esc(m.date)}</td></tr>`).join("")
        + d.guarantees.map(g => `<tr><td>${badge("对外担保", "green")}</td><td>为 ${esc(g.beneficiary)} 提供${esc(g.kind)}</td><td>${esc(g.amount)}</td><td>${esc(g.status)}</td><td>${esc(g.date)}</td></tr>`).join("")
        || emptyRow(5)}</table>`;
  }
  else if (cTab === "history") el.innerHTML = d.history.length ? `<table class="tbl"><tr><th>类别</th><th>名称</th><th>期间</th><th>说明</th></tr>
      ${d.history.map(h => `<tr><td>${badge(h.type, "blue")}</td><td>${esc(h.name)}</td><td>${esc(h.start)} ~ ${esc(h.end)}</td><td>${esc(h.note)}</td></tr>`).join("")}</table>`
    : `<p class="muted">暂无历史沿革记录</p>`;
  else if (cTab === "changes") el.innerHTML = d.changes.length ? `<table class="tbl"><tr><th>变更日期</th><th>变更事项</th><th>变更前</th><th>变更后</th></tr>
      ${d.changes.map(c2 => `<tr><td>${esc(c2.date)}</td><td>${esc(c2.item)}</td><td class="muted">${esc(c2.before)}</td><td style="color:var(--green)">${esc(c2.after)}</td></tr>`).join("")}</table>`
    : `<p class="muted">暂无变更记录</p>`;
  else if (cTab === "ip") el.innerHTML = `<table class="tbl"><tr><th>类型</th><th>名称</th><th>日期</th><th>状态</th></tr>
      ${d.ips.map(p => `<tr><td>${badge(p[0], p[0] === "专利" ? "blue" : p[0] === "软著" ? "green" : "orange")}</td><td>${esc(p[1])}</td><td>${esc(p[2])}</td><td>${esc(p[3])}</td></tr>`).join("") || emptyRow(4)}</table>`;
  else if (cTab === "bizinfo") {
    el.innerHTML = t("企业年报") + (d.annual.length ? `<table class="tbl"><tr><th>年度</th><th>资产总额</th><th>净资产</th><th>营收</th><th>利润</th><th>社保人数</th><th>股东出资</th></tr>
      ${d.annual.map(a => `<tr><td><b>${esc(a.year)}</b></td><td>${esc(a.assets)}</td><td>${esc(a.equity)}</td><td>${esc(a.revenue)}</td><td>${esc(a.profit)}</td><td>${esc(a.social_staff)}</td><td class="muted">${esc(a.holders)}</td></tr>`).join("")}</table>`
      : `<p class="muted">年报数据为 SVIP 权益 <a href="#/vip" style="color:var(--blue)">升级查看 →</a></p>`)
      + t("资质证书") + (d.licenses.length ? `<table class="tbl"><tr><th>证书名称</th><th>发证机关</th><th>编号</th><th>有效期</th><th>状态</th></tr>
      ${d.licenses.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(l.org)}</td><td class="muted">${esc(l.num)}</td><td>${esc(l.start)} ~ ${esc(l.end)}</td><td>${badge(l.status, "green")}</td></tr>`).join("")}</table>` : `<p class="muted">暂无</p>`)
      + t("招投标") + (d.biddings.length ? `<table class="tbl"><tr><th>角色</th><th>项目</th><th>金额</th><th>日期</th><th>对方单位</th></tr>
      ${d.biddings.map(b => `<tr><td>${badge(b.role, b.role === "中标方" ? "green" : "blue")}</td><td>${esc(b.project)}</td><td><b>${esc(b.amount)}</b></td><td>${esc(b.date)}</td><td class="muted">${esc(b.party)}</td></tr>`).join("")}</table>` : `<p class="muted">暂无</p>`)
      + t("融资历史") + (d.financings.length ? `<table class="tbl"><tr><th>轮次</th><th>金额</th><th>日期</th><th>投资方</th><th>投后估值</th></tr>
      ${d.financings.map(f => `<tr><td>${badge(f.round_, "orange")}</td><td><b>${esc(f.amount)}</b></td><td>${esc(f.date)}</td><td>${esc(f.investors)}</td><td>${esc(f.valuation)}</td></tr>`).join("")}</table>` : `<p class="muted">暂无公开融资</p>`)
      + t("上市公司财务三表") + (d.financials ? finTable(d.financials) : (d.listed ? `<p class="muted">财务三表为 SVIP 权益 <a href="#/vip" style="color:var(--blue)">升级查看 →</a></p>` : `<p class="muted">非上市公司，暂无公开财务三表</p>`));
  }
  else el.innerHTML = d.news.length ? d.news.map(n => `<div class="risk-item"><b>${esc(n.title)} ${sentimentBadge(n.sentiment)}</b>
      <div class="meta"><span>${esc(n.source)}</span><span>${esc(n.date)}</span><span>${esc(n.summary)}</span></div></div>`).join("")
    : `<p class="muted">暂无舆情新闻 ✅</p>`;
}
function emptyRow(n) { return `<tr><td colspan="${n}" class="muted">暂无数据</td></tr>`; }
function finTable(f) {
  const mk = (title, blk) => `<p style="margin:10px 0 6px;font-weight:600;font-size:13px">${title}（单位：人民币）</p>
    <table class="tbl"><tr><th>科目</th>${f.periods.map(p => `<th>${esc(p)}</th>`).join("")}</tr>
    ${blk.label.map((l, i) => `<tr><td>${esc(l)}</td>${blk.data[i].map(v => `<td><b>${esc(v)}</b></td>`).join("")}</tr>`).join("")}</table>`;
  return mk("利润表", f.income) + mk("资产负债表", f.balance) + mk("现金流量表", f.cashflow);
}

/* ---------------- 股权穿透 ---------------- */
async function viewGraph(id) {
  if (!needLogin()) return;
  app.innerHTML = `<div class="loading">读取预计算图谱缓存…</div>`;
  const { body } = await api("/api/graph/" + id);
  if (body.code !== 0) { app.innerHTML = `<div class="card" style="margin-top:18px">${esc(body.msg)}</div>`; return; }
  const d = body.data, c = d.controller;
  app.innerHTML = `<div class="graph-layout">
      <div>
        <div class="card ctrl-card"><h3>实际控制人</h3>
          ${c ? `<div class="name">${esc(c.name)} <a class="muted" style="cursor:pointer" onclick="location.hash='#/person?kw=${encodeURIComponent(c.name)}'">查老板 →</a></div>
          <div class="ratio">${(c.controlRatio * 100).toFixed(1)}%</div><p class="muted">最终受益人（UBO）· 沿持股链加权累乘</p>`
          : `<p class="muted">未识别出自然人实控人</p>`}</div>
        <div class="card" style="margin-top:14px"><h3>查询链路</h3>
          <div class="flow"><span class="step">用户查询</span><span class="arr">→</span><span class="step">Redis 图谱缓存</span><span class="arr">→</span>
          <span class="step">${body.cache === "HIT" ? "命中 · " + body.costMs + "ms" : "回源预计算"}</span></div>
          <div class="meta-line">${badge("缓存 " + body.cache, body.cache === "HIT" ? "green" : "orange")}<span>${esc(body.source)}</span></div></div>
        <div class="card" style="margin-top:14px"><h3>穿透说明</h3>
          <p class="muted" style="line-height:1.9">每日凌晨 Spark 全量重算穿透树与实控人；企业变更时由 Kafka 事件触发单主体局部重算；结果常驻 Redis，查询只读缓存，绝不实时递归图库。</p></div>
      </div>
      <div class="card"><h3>${esc(d.companyName)} · 股权穿透图（NebulaGraph）</h3><div id="tree"></div></div>
    </div>`;
  const chart = echarts.init(document.getElementById("tree"));
  const toTree = n => ({
    name: (n.name || n.companyName || "") + (n.ratio != null ? `\n持股 ${(n.ratio * 100).toFixed(0)}%` : ""),
    itemStyle: n.ratio != null && n.ratio >= 0.5 ? { color: "#1a66ff" } : { color: "#5aa2ff" },
    children: (n.children || []).map(toTree),
  });
  chart.setOption({ tooltip: { trigger: "item" }, series: [{ type: "tree", data: [toTree(d)],
    top: "5%", bottom: "5%", left: "18%", right: "18%", symbol: "circle", symbolSize: 14, orient: "TB",
    expandAndCollapse: true, initialTreeDepth: -1, label: { position: "top", fontSize: 12, lineHeight: 16 },
    leaves: { label: { position: "bottom", align: "middle" } },
    lineStyle: { color: "#b9c8e0", width: 1.5, curveness: 0.5 }, animationDuration: 400 }] });
  window.addEventListener("resize", () => chart.resize());
}

/* ---------------- 信用报告 ---------------- */
async function viewReport(id) {
  if (!needLogin()) return;
  app.innerHTML = `<div class="loading">聚合企业全量数据，生成信用报告…</div>`;
  const { status, body } = await api("/api/company/" + id + "/report");
  if (status === 429) {
    app.innerHTML = `<div class="card" style="margin-top:24px;text-align:center;padding:44px">
      <h3 style="justify-content:center;color:var(--orange)">${esc(body.msg)}</h3>
      <button class="btn-cta" style="border:none;border-radius:8px;padding:11px 26px;color:#fff;font-weight:700;margin-top:16px;cursor:pointer" onclick="location.hash='#/vip'">升级 VIP 不限量</button></div>`;
    return;
  }
  const d = body.data, rs = d.riskSummary;
  const sec = (title, inner) => `<div class="card report-sec"><h3>${title}</h3>${inner}</div>`;
  const kv = pairs => `<div class="kv-grid">${pairs.map(([k, v]) => `<div class="kv-row"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join("")}</div>`;
  app.innerHTML = `
    <div class="report-head"><h2>企业信用报告 · ${esc(d.company_name)}</h2>
      <div class="no">报告编号 ${esc(d.reportNo)} · 生成时间 ${esc(d.generatedAt)} · 生成人 ${esc(d.generatedBy)} · 企信查 QCC（演示）</div></div>
    ${sec("一、工商信息", kv([["企业名称", d.company_name], ["信用代码", d.credit_code], ["法定代表人", d.legal_person],
      ["注册资本", d.register_capital], ["成立日期", d.establish_time], ["登记状态", d.statusText], ["企业类型", d.org_type],
      ["登记机关", d.reg_institute], ["所属行业", d.industry], ["参保人数", d.employees], ["联系电话", d.contact], ["注册地址", d.address]]))}
    ${sec("二、股权结构与主要人员", `<p style="margin-bottom:8px;font-size:13px;font-weight:600">股东</p>
      <table class="tbl"><tr><th>股东</th><th>类型</th><th>比例</th></tr>${d.shareholders.map(s => `<tr><td>${esc(s.name)}</td><td>${s.type}</td><td><b>${s.ratio}%</b></td></tr>`).join("")}</table>
      <p style="margin:12px 0 8px;font-size:13px;font-weight:600">主要人员</p>
      <table class="tbl"><tr><th>姓名</th><th>职位</th><th>任职日期</th></tr>${d.staff.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.position)}</td><td>${esc(s.entry)} 至今</td></tr>`).join("")}</table>`)}
    ${sec("三、风险扫描（共 " + rs.total + " 条）", `<div class="risk-counts">${[["lawsuit", "司法诉讼"], ["dishonest", "失信"], ["zhixing", "被执行"], ["xianxiao", "限高"], ["penalty", "行政处罚"], ["abnormal", "经营异常"], ["pledge", "股权出质"], ["mortgage", "动产抵押"], ["guarantee", "对外担保"]].map(([k, n]) => {
        const v = rs[k] ?? 0; return `<div class="rc"><div class="v ${v ? "some" : "zero"}">${v}</div><p>${n}</p></div>`; }).join("")}</div>
      ${(d.lawsuits.concat(d.dishonest.map(x => ({ title: x.caseNo + "（失信）", date: x.date, court: x.court, statusText: "已列入" })))
        .concat(d.zhixing.map(x => ({ title: x.caseNo + "（被执行 " + x.amount + "）", date: x.date, court: x.court, statusText: "执行中" }))))
        .map(l => `<div class="risk-item"><b>${esc(l.title)} ${badge(l.statusText, "orange")}</b><div class="meta"><span>${esc(l.court || "")}</span><span>${esc(l.date || "")}</span></div></div>`).join("") || `<p class="muted">核心风险项为空 ✅</p>`}`)}
    ${sec("四、历史沿革", d.history.length ? `<table class="tbl"><tr><th>类别</th><th>名称</th><th>期间</th><th>说明</th></tr>${d.history.map(h => `<tr><td>${h.type}</td><td>${esc(h.name)}</td><td>${esc(h.start)} ~ ${esc(h.end)}</td><td>${esc(h.note)}</td></tr>`).join("")}</table>` : `<p class="muted">无</p>`)}
    ${sec("五、变更记录（近5条）", d.changes.length ? `<table class="tbl"><tr><th>日期</th><th>事项</th><th>变更后</th></tr>${d.changes.slice(0, 5).map(c2 => `<tr><td>${esc(c2.date)}</td><td>${esc(c2.item)}</td><td>${esc(c2.after)}</td></tr>`).join("")}</table>` : `<p class="muted">无</p>`)}
    ${sec("六、经营信息", (d.licenses.length ? `<p style="font-weight:600;font-size:13px">资质证书 ${d.licenses.length} 项</p>` : "")
      + (d.biddings.length ? `<p style="margin-top:8px;font-weight:600;font-size:13px">招投标 ${d.biddings.length} 条（中标 ${d.biddings.filter(b => b.role === "中标方").length} 次）</p>` : "")
      + (d.financings.length ? `<p style="margin-top:8px;font-weight:600;font-size:13px">融资 ${d.financings.length} 轮，最新：${esc(d.financings[0].round_)} ${esc(d.financings[0].amount)}（${esc(d.financings[0].date)}）</p>` : "")
      + (d.annual.length ? `<p style="margin-top:8px;font-weight:600;font-size:13px">最新年报（${esc(d.annual[0].year)}）：营收 ${esc(d.annual[0].revenue)} · 利润 ${esc(d.annual[0].profit)}</p>` : ""))}
    ${sec("七、舆情摘要（" + d.news.length + " 条）", d.news.map(n => `<div class="risk-item"><b>${esc(n.title)} ${sentimentBadge(n.sentiment)}</b>
      <div class="meta"><span>${esc(n.source)}</span><span>${esc(n.date)}</span></div></div>`).join("") || `<p class="muted">无</p>`)}
    <p class="muted" style="margin:16px 0 30px">免责声明：本报告基于模拟数据生成，仅用于架构演示。真实场景数据来源为国家企业信用信息公示系统、裁判文书网等官方公开渠道。</p>
    <button class="btn primary" onclick="window.print()">打印 / 导出 PDF</button>`;
}

/* ---------------- VIP 会员 ---------------- */
async function viewVip() {
  app.innerHTML = `<div class="loading">加载会员套餐…</div>`;
  const { body } = await api("/api/member/plans");
  const hot = body.data.plans[1];
  app.innerHTML = `
    <div class="hero" style="padding:26px 30px"><h1 style="font-size:22px">选择适合你的会员</h1>
      <p style="margin:6px 0 0">深度挖掘企业价值 · 全量风险信息 · 图谱穿透不限层</p></div>
    <div class="plans">${body.data.plans.map(p => `
      <div class="plan ${p === hot ? "hot" : ""}">
        ${p === hot ? `<span class="tag-top">最受欢迎</span>` : `<span class="tag-top" style="background:#eef2f8;color:var(--sub)">　</span>`}
        <h3>${esc(p.name)}</h3><p class="sub">${esc(p.sub)}</p><div class="price">${esc(p.price)}</div>
        <ul>${p.perks.map(k => `<li>${esc(k)}</li>`).join("")}</ul>
        <button class="btn-cta" style="border:none;border-radius:8px;padding:10px;width:100%;color:#fff;font-weight:700;cursor:pointer" onclick="subscribe(${p.plan_id})">立即开通</button>
      </div>`).join("")}</div>
    <div class="card" style="margin-top:16px">
      <div class="priv-opts"><h3 style="margin:0;flex:1">会员权益对比</h3>
        <label style="cursor:pointer"><input type="checkbox" id="onlyDiff" onchange="renderPriv()"> 只看不同</label></div>
      <div class="table-wrap" id="privBody"></div></div>`;
  window._PRIV = body.data.privileges; renderPriv();
}
function renderPriv() {
  const onlyDiff = document.getElementById("onlyDiff") && document.getElementById("onlyDiff").checked;
  const rows = window._PRIV.filter(r => !onlyDiff || new Set(r.slice(1)).size > 1);
  document.getElementById("privBody").innerHTML = `<table class="tbl"><tr><th>权益项</th><th>普通用户</th><th>VIP</th><th>SVIP</th><th>企业版</th></tr>
    ${rows.map(r => `<tr><td>${esc(r[0])}</td>${r.slice(1).map(v => `<td style="text-align:center">${v === "√" ? `<b style="color:var(--green)">✓</b>` : v === "×" ? `<span class="muted">—</span>` : `<b>${esc(v)}</b>`}</td>`).join("")}</tr>`).join("")}</table>`;
}
async function subscribe(pid) {
  if (!needLogin()) return;
  const { body } = await api("/api/member/subscribe", { method: "POST" });
  const me = await api("/api/auth/me"); USER = me.body.data; renderUserArea();
  alert(body.msg + "，当前身份：" + USER.plan);
  viewVip();
}

/* ---------------- 开放平台 ---------------- */
async function viewOpen() {
  app.innerHTML = `<div class="loading">加载开放平台…</div>`;
  const keys = USER ? await api("/api/open/keys") : null;
  app.innerHTML = `
    <div class="hero" style="padding:26px 30px"><h1 style="font-size:22px">企信查开放平台</h1>
      <p style="margin:6px 0 0">让程序也能查公司、查老板、查关系 · ApiCode 体系 · 按次计费 · 每日配额</p></div>
    ${keys ? `<div class="card" style="margin-top:16px"><h3>我的 API 凭证</h3>
      <div class="kv-grid">
        <div class="kv-row"><span class="k">ApiKey</span><span><b>${esc(keys.body.data.apiKey)}</b></span></div>
        <div class="kv-row"><span class="k">今日调用</span><span><b style="color:var(--orange)">${keys.body.data.used}</b> / ${keys.body.data.quota} 次（${esc(keys.body.data.date)}）</span></div>
      </div>
      <p class="muted" style="margin-top:8px">对接方式：GET ${keys.body.data.apis[0].path}?apiKey=${esc(keys.body.data.apiKey)} —— 返回 {error_code, reason, result, bill}</p></div>`
    : `<div class="card" style="margin-top:16px"><p class="muted">登录后可在本页获取 ApiKey 并在线调试（<a style="color:var(--blue);cursor:pointer" onclick="goLogin()">去登录</a>）</p></div>`}
    <div class="card" style="margin-top:16px"><h3>接口列表（ApiCode 风格，对标企查查开放平台）</h3>
      <table class="tbl"><tr><th>ApiCode</th><th>接口名称</th><th>路径</th><th>单价</th></tr>
      ${keys ? keys.body.data.apis.map(a => `<tr><td><b>${a.code}</b></td><td>${esc(a.name)}</td><td class="muted">${esc(a.path)}</td><td>¥${a.price.toFixed(2)}/次</td></tr>`).join("") : `<tr><td colspan="4" class="muted">登录后可见</td></tr>`}</table></div>
    ${USER ? `<div class="card playground" style="margin-top:16px"><h3>在线调试</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <select id="pgApi" class="inp">
          <option value="/api/open/company/10000001">410 · 企业工商信息（星辰控股）</option>
          <option value="/api/open/risk/10000007">411 · 企业风险聚合（磐石建设）</option>
          <option value="/api/open/graph/10000001">453 · 股权结构图（星辰控股）</option>
          <option value="/api/open/search?keyword=星辰">886 · 企业模糊搜索（星辰）</option>
        </select>
        <button class="btn primary" onclick="runPlayground()">发送请求（计1次配额）</button></div>
      <pre id="pgOut">// 响应将显示在这里（含 bill 计费信息）</pre></div>` : ""}
    <div class="card" style="margin-top:16px"><h3>配额规则（对标两家平台）</h3>
      <p class="muted" style="line-height:2">普通用户 20 次/日 · VIP 1000 次/日 · 企业版 5000 次/日 · 计数键 <code>qcc:api:quota:{uid}:{date}</code>（LLD 4.4），超额返回 42901。真实生产按阶梯计费并开具发票。</p></div>`;
  window.runPlayground = async () => {
    const url = document.getElementById("pgApi").value + (document.getElementById("pgApi").value.includes("?") ? "&" : "?") + "apiKey=" + keys.body.data.apiKey;
    const r = await fetch(url); const j = await r.json();
    document.getElementById("pgOut").textContent = JSON.stringify(j, null, 2);
    const k2 = await api("/api/open/keys");
    document.querySelector(".kv-row .kv-row") ;
  };
}

/* ---------------- 监控雷达 ---------------- */
async function viewMonitor() {
  if (!needLogin()) return;
  app.innerHTML = `<div class="loading">采集指标…</div>`;
  const [stats, mset] = await Promise.all([api("/api/stats"), api("/api/monitor/settings")]);
  const s = stats.body.data, m = mset.body.data;
  app.innerHTML = `
    <div class="mon-cards">
      <div class="mon"><p class="muted">Redis 缓存命中率</p><div class="v green">${s.cacheHitRate}%</div><p class="muted">命中 ${s.cacheHits} / 未命中 ${s.cacheMisses}</p></div>
      <div class="mon"><p class="muted">企业主体库</p><div class="v blue">${s.totalCompanies}</div><p class="muted">人物主档 ${s.totalPersons} 位</p></div>
      <div class="mon"><p class="muted">滑动窗口限流</p><div class="v orange">${esc(s.rateLimit.limit)}</div><p class="muted">当前窗口 IP 记录：${Object.values(s.rateLimit.current).join(" / ") || 0}</p></div>
      <div class="mon"><p class="muted">Kafka 事件流</p><div class="v blue">${s.events.length}</div><p class="muted">最近事件（含雷达推送）</p></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>我的订阅（${m.subscriptions.length}）与推送设置</h3>
        ${m.subscriptions.length ? m.subscriptions.map(x => `<div class="ev"><span class="t">${statusBadge(x.status)}</span><b style="color:var(--blue);cursor:pointer" onclick="location.hash='#/company/${x.companyId}'">${esc(x.companyName)}</b></div>`).join("") : `<p class="muted">暂无订阅</p>`}
        <p style="margin:14px 0 6px;font-size:13px;font-weight:600">推送渠道</p>
        <div id="chBox">${["app", "sms", "email"].map(c => `<label style="margin-right:14px;font-size:13px"><input type="checkbox" value="${c}" ${m.settings.channels.includes(c) ? "checked" : ""}> ${({ "app": "App推送", "sms": "短信", "email": "邮件" })[c]}</label>`).join("")}</div>
        <p style="margin:10px 0 6px;font-size:13px;font-weight:600">订阅事件类型</p>
        <div id="tyBox">${Object.entries({ 1: "工商变更", 2: "司法风险", 3: "新增知识产权" }).map(([k, v]) =>
          `<label style="margin-right:14px;font-size:13px"><input type="checkbox" value="${k}" ${m.settings.types.includes(+k) ? "checked" : ""}> ${v}</label>`).join("")}</div>
        <button class="btn primary" style="margin-top:14px" onclick="saveMonitor()">保存推送设置</button>
      </div>
      <div class="card"><h3>模拟企业变更（数据更新流程）</h3>
        <p class="muted">触发后走 HLD 4.2 全链路：爬虫抓取 → Kafka 分发 → 更新台账+变更落库 → 删脏缓存 → 雷达推送</p>
        <div class="flow"><span class="step">爬虫</span><span class="arr">→</span><span class="step">Kafka</span><span class="arr">→</span>
          <span class="step">台账+变更记录</span><span class="arr">→</span><span class="step">删缓存</span><span class="arr">→</span><span class="step">雷达推送</span></div>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <select id="chgSel" class="inp">${["10000001", "10000002", "10000005", "10000007"].map((v, i) =>
            `<option value="${v}">${["星辰控股集团", "星辰智科", "华芯半导体", "磐石建设"][i]}</option>`).join("")}</select>
          <button class="btn-cta" style="border:none;border-radius:8px;padding:9px 18px;color:#fff;font-weight:700;cursor:pointer" onclick="doChange()">触发变更事件</button>
          <a class="btn" href="#/company/10000001">看缓存 MISS→HIT</a></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Kafka 事件总线（最近事件）</h3>
      ${s.events.map(e => `<div class="ev"><span class="t">${esc(e.ts)}</span>${badge(e.topic, e.topic === "company-change" ? "orange" : "blue")}<span>${esc(JSON.stringify(e.payload).slice(0, 110))}</span></div>`).join("") || `<p class="muted">暂无事件</p>`}</div>`;
  window.saveMonitor = async () => {
    const channels = [...document.querySelectorAll("#chBox input:checked")].map(i => i.value);
    const types = [...document.querySelectorAll("#tyBox input:checked")].map(i => +i.value);
    const { body } = await api("/api/monitor/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channels, types }) });
    alert(body.msg);
  };
  window.doChange = async () => {
    const cid = document.getElementById("chgSel").value;
    await api("/api/admin/change/" + cid, { method: "POST" });
    viewMonitor();
  };
}

/* ---------------- 企业地图 ---------------- */
async function viewMap() {
  app.innerHTML = `<div class="loading">加载企业地图…</div>`;
  const { body } = await api("/api/map/companies");
  const d = body.data;
  app.innerHTML = `
    <div class="card" style="margin-top:18px"><h3>企业地图（按风险度标注 · 对标天眼地图/千寻地图）</h3><div id="mapchart"></div></div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>省份分布</h3>${Object.entries(d.provinces).sort((a, b) => b[1] - a[1]).map(([p, n]) =>
        `<div class="kv-row"><span class="k" style="width:auto">${esc(p)}</span><span style="flex:1;margin:0 12px"><span style="display:inline-block;height:10px;background:var(--blue);border-radius:5px;width:${n * 22}%"></span></span><span><b>${n}</b> 家</span></div>`).join("")}</div>
      <div class="card"><h3>风险热力（点击查看）</h3>${d.points.sort((a, b) => b.riskTotal - a.riskTotal).slice(0, 8).map(p =>
        `<div class="kv-row"><span class="k" style="width:auto;cursor:pointer;color:var(--blue)" onclick="location.hash='#/company/${p.companyId}'">${esc(p.name)}</span>
         <span style="flex:1;text-align:right">${p.riskTotal ? badge("风险 " + p.riskTotal, p.riskTotal >= 3 ? "red" : "orange") : badge("0 风险", "green")}</span></div>`).join("")}</div>
    </div>`;
  try {
    const geo = await (await fetch("/static/china.json")).json();
    echarts.registerMap("china", geo);
    const chart = echarts.init(document.getElementById("mapchart"));
    chart.setOption({
      tooltip: { trigger: "item", formatter: p => p.data ? `${p.data.name}<br/>${p.data.value.join(", ")}` : p.name },
      visualMap: { min: 0, max: 9, left: 20, bottom: 20, text: ["高风险", "无风险"], inRange: { color: ["#0aa870", "#f59e0b", "#e34d4d"] }, calculable: false },
      series: [{ type: "map", map: "china", roam: true, itemStyle: { areaColor: "#eef3fb", borderColor: "#c9d6ea" },
        emphasis: { label: { show: true } }, data: [] },
        { type: "scatter", coordinateSystem: "geo", symbolSize: v => 12 + v[2] * 3,
          data: d.points.map(p => ({ name: p.name, value: [p.lng, p.lat, p.riskTotal] })),
          itemStyle: { color: "#1a66ff" } }],
      geo: { map: "china", roam: true, itemStyle: { areaColor: "#eef3fb", borderColor: "#c9d6ea" } },
    });
  } catch (e) {
    document.getElementById("mapchart").innerHTML = `<p class="muted" style="padding:40px;text-align:center">地图资源加载失败（离线环境），请查看下方省份分布</p>`;
  }
}

/* ---------------- 路由 ---------------- */
window.addEventListener("hashchange", route);
function route() {
  const h = location.hash.slice(2) || "home";
  const [p, q] = h.split("?");
  const qs = Object.fromEntries(new URLSearchParams(q || ""));
  const navKey = ({ "": "home", home: "home", search: "home", person: "person", path: "path", map: "map", open: "open", vip: "vip", monitor: "monitor" })[p.split("/")[0]] || "home";
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === navKey));
  if (p.startsWith("search")) viewSearch(qs);
  else if (p.startsWith("person/")) viewPersonProfile(+p.split("/")[1]);
  else if (p.startsWith("person")) viewPerson(qs);
  else if (p.startsWith("path")) viewPath(qs);
  else if (p.startsWith("company/")) viewCompany(p.split("/")[1]);
  else if (p.startsWith("graph/")) viewGraph(p.split("/")[1]);
  else if (p.startsWith("report/")) viewReport(p.split("/")[1]);
  else if (p.startsWith("vip")) viewVip();
  else if (p.startsWith("open")) viewOpen();
  else if (p.startsWith("monitor")) viewMonitor();
  else if (p.startsWith("map")) viewMap();
  else if (p.startsWith("login")) viewLogin(qs);
  else viewHome();
}
(async function boot() {
  try {
    const me = await fetch("/api/auth/me"); const j = await me.json();
    USER = j.data; renderUserArea();
  } catch (e) { renderUserArea(); }
  route();
})();
