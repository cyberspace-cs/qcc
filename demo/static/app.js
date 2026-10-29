/* 企信查 QCC 演示前端：hash 路由（首页/搜索/企业详情/股权穿透/系统监控） */
const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const badge = (text, color) => `<span class="badge ${color}">${esc(text)}</span>`;
const statusBadge = (t) => t === "存续" ? badge("存续", "green") : t === "注销" ? badge("注销", "gray") : badge("吊销", "red");

async function api(path, opts) {
  const r = await fetch(path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/* ---------------- 首页 ---------------- */
async function viewHome() {
  app.innerHTML = `
    <div class="hero">
      <h1>查企业 · 看风险 · 穿股权</h1>
      <p>亿级企业主体数据库 · 工商/司法/知识产权全景档案 · 股权穿透与实控人挖掘（演示数据）</p>
      <div class="search-box">
        <input id="kw" placeholder="请输入企业名称、法人、统一社会信用代码（如：星辰）" />
        <button onclick="doSearch()">立即查询</button>
      </div>
      <div class="hero-stats">
        <div><b>10亿+</b><span>企业主体库（演示）</span></div>
        <div><b>&lt;300ms</b><span>企业主页 P95</span></div>
        <div><b>&lt;800ms</b><span>图谱查询 P95</span></div>
        <div><b>5层+</b><span>股权穿透深度</span></div>
      </div>
    </div>
    <div class="grid cols-2-1">
      <div class="card"><h3>平台核心能力</h3>
        <div class="caps" style="grid-template-columns:1fr 1fr">
          <div class="cap"><span class="ic">◆</span><b>全文检索</b><p>ES 唯一搜索入口：分词、拼音纠错、模糊匹配、高亮、多条件筛选</p></div>
          <div class="cap"><span class="ic">◆</span><b>股权穿透</b><p>Spark 每日全量预计算 + Redis 缓存，查询不实时递归图库</p></div>
          <div class="cap"><span class="ic">◆</span><b>风险聚合</b><p>诉讼、失信、被执行、行政处罚、经营异常一站式聚合</p></div>
          <div class="cap"><span class="ic">◆</span><b>监控雷达</b><p>Kafka 变更事件驱动，订阅企业变更分钟级推送</p></div>
        </div>
      </div>
      <div class="card"><h3>热搜企业榜</h3><ul class="hot-list" id="hot"><li class="muted">加载中…</li></ul></div>
    </div>`;
  app.querySelector("#kw").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
  const { body } = await api("/api/hot");
  const ul = document.getElementById("hot");
  ul.innerHTML = body.data.length ? body.data.map((h, i) =>
    `<li onclick="location.hash='#/search?kw=${encodeURIComponent(h.kw)}'"><span><i class="no">${i + 1}</i>${esc(h.kw)}</span><span class="score">${h.score} 次搜索</span></li>`
  ).join("") : `<li class="muted">暂无热搜，先搜索试试～</li>`;
}

function doSearch() {
  const kw = document.getElementById("kw").value.trim();
  if (kw) location.hash = "#/search?kw=" + encodeURIComponent(kw);
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
        <button onclick="doSearch2()">搜索</button>
      </div>
      <p style="margin:12px 0 0;font-size:12px">ES 检索耗时 <b>${body.costMs}ms</b> · 命中 <b>${body.total}</b> 条（Elasticsearch 唯一搜索入口）</p>
    </div>${sugg}
    <div class="card">${body.data.length ? body.data.map(r => `
      <div class="result-item">
        <h4 onclick="location.hash='#/company/${r.companyId}'">${r.companyName} ${statusBadge(r.statusText)}</h4>
        <div class="result-meta">
          <span>法定代表人：${r.legalPerson}</span><span>注册资本：${esc(r.registerCapital)}</span>
          <span>成立时间：${esc(r.establishTime)}</span><span>${esc(r.province)} ${esc(r.city)}</span>
          <span>${esc(r.industry)}</span>
        </div>
        <div class="result-meta" style="margin-top:6px"><span class="muted">统一社会信用代码：${esc(r.creditCode)}</span>
          <a href="#/graph/${r.companyId}" style="color:var(--blue)">查看股权穿透 →</a></div>
      </div>`).join("") : `<div class="loading">无匹配结果</div>`}</div>`;
  document.getElementById("kw2").addEventListener("keydown", e => { if (e.key === "Enter") doSearch2(); });
}
function doSearch2() {
  const kw = document.getElementById("kw2").value.trim();
  if (kw) location.hash = "#/search?kw=" + encodeURIComponent(kw);
}

/* ---------------- 企业详情 ---------------- */
const TABS = { biz: "工商信息", own: "股东与高管", risk: "风险信息", ip: "知识产权" };
let curTab = "biz";
async function viewCompany(id) {
  app.innerHTML = `<div class="loading">查询企业主页…</div>`;
  const { status, body } = await api("/api/company/" + id);
  if (status === 429) {
    app.innerHTML = `<div class="card" style="margin-top:18px;text-align:center;padding:40px">
      <h3 style="justify-content:center;color:var(--red)">${esc(body.msg)}</h3>
      <p class="muted" style="margin-top:10px">对应 LLD 5.4：IP+账号双层滑动窗口限流，超过阈值的请求被 429 拦截（演示阈值 20 次/分钟/IP）</p></div>`;
    return;
  }
  if (!body.data) { app.innerHTML = `<div class="card" style="margin-top:18px">未找到该企业</div>`; return; }
  const d = body.data;
  window._co = d;
  app.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(d.companyName)} ${statusBadge(d.statusText)}</h2>
        <div class="meta-line">统一社会信用代码：<b>${esc(d.creditCode)}</b>
          ${body.cache ? badge("Redis 缓存 " + body.cache + " · " + body.costMs + "ms" + (body.ttl ? " · TTL " + body.ttl + "s" : ""), body.cache === "HIT" ? "green" : "orange") : ""}</div>
        <div class="kv">
          <span>法定代表人：<b>${esc(d.legalPerson)}</b></span>
          <span>注册资本：<b>${esc(d.registerCapital)}</b></span>
          <span>成立时间：<b>${esc(d.establishTime)}</b></span>
          <span>行业：<b>${esc(d.industry)}</b></span>
          <span>地址：${esc(d.address)}</span>
        </div>
      </div>
      <div style="text-align:right">
        <div class="risk-card">
          <p class="muted">风险扫描</p>
          <p style="margin:6px 0">司法诉讼 <b style="color:${d.riskSummary.lawsuit ? "var(--red)" : "var(--green)"}">${d.riskSummary.lawsuit}</b> 条</p>
          <p>行政处罚 <b style="color:${d.riskSummary.penalty ? "var(--orange)" : "var(--green)"}">${d.riskSummary.penalty}</b> 条</p>
          <a class="btn" style="display:inline-block;margin-top:12px" href="#/graph/${d.companyId}">查看股权穿透 →</a>
        </div>
      </div>
    </div>
    <div class="tabs">${Object.entries(TABS).map(([k, v]) =>
      `<button data-tab="${k}" class="${k === curTab ? "active" : ""}" onclick="switchTab('${k}')">${v}${k === "risk" && (d.riskSummary.lawsuit + d.riskSummary.penalty) ? ` (${d.riskSummary.lawsuit + d.riskSummary.penalty})` : ""}</button>`).join("")}</div>
    <div class="card" id="tabBody"></div>`;
  renderTab();
}
function switchTab(k) {
  curTab = k;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === k));
  renderTab();
}
function renderTab() {
  const d = window._co, el = document.getElementById("tabBody");
  if (curTab === "biz") el.innerHTML = `
    <div class="kv-grid">
      ${[["企业名称", d.companyName], ["统一社会信用代码", d.creditCode], ["法定代表人", d.legalPerson],
         ["注册资本", d.registerCapital], ["成立日期", d.establishTime], ["登记状态", d.statusText],
         ["所属行业", d.industry], ["注册地址", d.address]].map(([k, v]) =>
        `<div class="kv-row"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join("")}
    </div>`;
  else if (curTab === "own") el.innerHTML = `
    <h3 style="margin-bottom:10px">股东信息（HOLD_SHARE 持股边）</h3>
    <table class="tbl"><tr><th>股东名称</th><th>类型</th><th>持股比例</th></tr>
      ${d.shareholders.map(s => `<tr><td>${esc(s.name)}</td><td>${badge(s.type, s.type === "自然人股东" ? "blue" : "green")}</td><td><b>${s.ratio}%</b></td></tr>`).join("") || "<tr><td colspan=3 class=muted>暂无</td></tr>"}</table>
    <h3 style="margin:18px 0 10px">主要人员（WORK_AT 任职边）</h3>
    <table class="tbl"><tr><th>姓名</th><th>职位</th><th>任职日期</th></tr>
      ${d.staff.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.position)}</td><td>${esc(s.entry)} 至 ${s.exit ? esc(s.exit) : "至今"}</td></tr>`).join("") || "<tr><td colspan=3 class=muted>暂无</td></tr>"}</table>
    ${d.invests.length ? `<h3 style="margin:18px 0 10px">对外投资（INVEST 边）</h3>
    <table class="tbl"><tr><th>被投资企业</th><th>持股比例</th><th>认缴出资</th></tr>
      ${d.invests.map(s => `<tr><td style="color:var(--blue);cursor:pointer" onclick="location.hash='#/company/${window._co.companyId}'">${esc(s.name)}</td><td>${s.ratio}%</td><td>${esc(s.amount)}</td></tr>`).join("")}</table>` : ""}`;
  else if (curTab === "risk") el.innerHTML = `
    <h3 style="margin-bottom:10px">司法诉讼</h3>
    ${d.lawsuits.map(l => `<div class="risk-item"><b>${esc(l.title)} ${badge(["", "审理中", "已判决", "执行中"][l.status] || "已判决", "orange")}</b>
      <div class="meta"><span>案件类型：${esc(l.ctype)}</span><span>审理法院：${esc(l.court)}</span><span>发布日期：${esc(l.date)}</span></div></div>`).join("") || `<p class="muted">暂无司法诉讼 ✅</p>`}
    <h3 style="margin:18px 0 10px">行政处罚 / 经营异常</h3>
    ${d.penalties.map(p => `<div class="risk-item"><b>${esc(p.reason)} ${badge("行政处罚", "red")}</b>
      <div class="meta"><span>决定机关：${esc(p.org)}</span><span>日期：${esc(p.date)}</span><span>结果：${esc(p.result)}</span></div></div>`).join("") || `<p class="muted">暂无行政处罚 ✅</p>`}`;
  else el.innerHTML = `
    <table class="tbl"><tr><th>类型</th><th>名称</th><th>日期</th><th>状态</th></tr>
      ${d.ips.map(p => `<tr><td>${badge(p[0], p[0] === "专利" ? "blue" : p[0] === "软著" ? "green" : "orange")}</td><td>${esc(p[1])}</td><td>${esc(p[2])}</td><td>${esc(p[3])}</td></tr>`).join("") || "<tr><td colspan=4 class=muted>暂无知识产权记录</td></tr>"}</table>`;
}

/* ---------------- 股权穿透 ---------------- */
async function viewGraph(id) {
  app.innerHTML = `<div class="loading">读取预计算图谱缓存…</div>`;
  const { body } = await api("/api/graph/" + id);
  if (body.code !== 0) { app.innerHTML = `<div class="card" style="margin-top:18px">${esc(body.msg)}</div>`; return; }
  const d = body.data, c = d.controller;
  app.innerHTML = `
    <div class="graph-layout">
      <div>
        <div class="card ctrl-card">
          <h3 style="--c:var(--orange)">实际控制人</h3>
          ${c ? `<div class="name">${esc(c.name)}</div><div class="ratio">${(c.controlRatio * 100).toFixed(1)}%</div><p class="muted">最终受益人（UBO）· 沿持股链加权累乘计算（LLD 5.1.1）</p>`
              : `<p class="muted">未识别出自然人实控人</p>`}
        </div>
        <div class="card" style="margin-top:14px">
          <h3>查询链路</h3>
          <div class="flow">
            <span class="step">用户查询</span><span class="arr">→</span>
            <span class="step">Redis 图谱缓存</span><span class="arr">→</span>
            <span class="step">${body.cache === "HIT" ? "命中 · " + body.costMs + "ms" : "回源预计算"}</span>
          </div>
          <div class="meta-line">${badge("缓存 " + body.cache, body.cache === "HIT" ? "green" : "orange")}<span>来源：${esc(body.source)}</span><span>禁止实时递归图库（SRS 硬约束）</span></div>
        </div>
        <div class="card" style="margin-top:14px">
          <h3>穿透说明</h3>
          <p class="muted" style="line-height:1.9">每日凌晨 Spark 全量重算穿透树与实控人；企业变更时由 Kafka 事件触发单主体局部重算；结果常驻 Redis，查询只读缓存。</p>
        </div>
      </div>
      <div class="card">
        <h3>${esc(d.companyName)} · 股权穿透图（NebulaGraph HOLD_SHARE/INVEST 边）</h3>
        <div id="tree"></div>
      </div>
    </div>`;
  const chart = echarts.init(document.getElementById("tree"));
  const toTree = n => ({
    name: (n.name || n.companyName || "") + (n.ratio != null ? `\n持股 ${(n.ratio * 100).toFixed(0)}%` : ""),
    itemStyle: n.ratio != null && n.ratio >= 0.5 ? { color: "#1a66ff" } : { color: "#5aa2ff" },
    children: (n.children || []).map(toTree),
  });
  chart.setOption({
    tooltip: { trigger: "item" },
    series: [{
      type: "tree", data: [toTree(d)], top: "5%", bottom: "5%", left: "18%", right: "18%",
      symbol: "circle", symbolSize: 14, orient: "TB", expandAndCollapse: true, initialTreeDepth: -1,
      label: { position: "top", fontSize: 12, color: "#24324a", lineHeight: 16 },
      leaves: { label: { position: "bottom", align: "middle" } },
      lineStyle: { color: "#b9c8e0", width: 1.5, curveness: 0.5 },
      animationDuration: 400,
    }],
  });
  window.addEventListener("resize", () => chart.resize());
}

/* ---------------- 系统监控 ---------------- */
async function viewMonitor() {
  app.innerHTML = `<div class="loading">采集指标…</div>`;
  const { body } = await api("/api/stats");
  const s = body.data;
  const comList = Object.entries(window._coList || {}).length ? "" : "";
  app.innerHTML = `
    <div class="mon-cards">
      <div class="mon"><p class="muted">Redis 缓存命中率</p><div class="v green">${s.cacheHitRate}%</div><p class="muted">命中 ${s.cacheHits} / 未命中 ${s.cacheMisses}</p></div>
      <div class="mon"><p class="muted">企业主体库</p><div class="v blue">${s.totalCompanies}</div><p class="muted">演示规模（生产为亿级）</p></div>
      <div class="mon"><p class="muted">滑动窗口限流</p><div class="v orange">${esc(s.rateLimit.limit)}</div><p class="muted">当前窗口 IP 记录数：${Object.values(s.rateLimit.current).join(" / ") || 0}</p></div>
      <div class="mon"><p class="muted">Kafka 事件流</p><div class="v blue">${s.events.length}</div><p class="muted">最近事件（含雷达推送）</p></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>模拟企业变更（数据更新流程）</h3>
        <p class="muted">触发后走 HLD 4.2 全链路：爬虫抓取变更 → Kafka 分发 → 更新 MySQL/图库 → 删除脏缓存 → 雷达推送</p>
        <div class="flow">
          <span class="step">爬虫抓取</span><span class="arr">→</span><span class="step">Kafka</span><span class="arr">→</span>
          <span class="step">更新台账</span><span class="arr">→</span><span class="step">删脏缓存</span><span class="arr">→</span><span class="step">雷达推送</span>
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <select id="chgSel" class="btn">
            ${Object.entries({ 10000001: "星辰控股集团有限公司", 10000002: "星辰智科有限公司", 10000005: "华芯半导体有限公司", 10000007: "磐石建设工程有限公司" }).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
          <button class="btn primary" onclick="doChange()">触发变更事件</button>
          <a class="btn" href="#/company/10000001">去企业主页看缓存MISS→HIT</a>
        </div>
        <p class="muted" style="margin-top:10px">提示：先打开某企业主页（MISS 回源并写缓存），再触发变更（删缓存），再次访问即重新回源 —— 完整演示"删缓存+懒加载"一致性方案。</p>
      </div>
      <div class="card"><h3>Kafka 事件总线（最近事件）</h3>
        <div id="evList">${s.events.map(e => `<div class="ev"><span class="t">${esc(e.ts)}</span>${badge(e.topic, e.topic === "company-change" ? "orange" : "blue")}<span>${esc(JSON.stringify(e.payload).slice(0, 90))}</span></div>`).join("") || `<p class="muted">暂无事件，点击左侧"触发变更事件"试试</p>`}</div>
      </div>
    </div>`;
}
async function doChange() {
  const cid = document.getElementById("chgSel").value;
  await api("/api/admin/change/" + cid, { method: "POST" });
  viewMonitor();
}

/* ---------------- 路由 ---------------- */
window.addEventListener("hashchange", route);
function route() {
  const h = location.hash.slice(2) || "home";
  const nav = h.startsWith("monitor") ? "monitor" : "home";
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === nav));
  const [p, q] = h.split("?");
  const qs = Object.fromEntries(new URLSearchParams(q || ""));
  curTab = "biz";
  if (p.startsWith("search")) viewSearch(qs);
  else if (p.startsWith("company/")) viewCompany(p.split("/")[1]);
  else if (p.startsWith("graph/")) viewGraph(p.split("/")[1]);
  else if (p.startsWith("monitor")) viewMonitor();
  else viewHome();
}
route();
