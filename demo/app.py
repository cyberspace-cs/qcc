# -*- coding: utf-8 -*-
"""
企业征信查询平台（对标企查查）演示版后端 v2
按对标差距清单实现 P0 + P1 + P2 全部接口：
  P0: 认证/会员 | 查老板 | 查关系(最短路径) | 历史沿革 | 变更记录 | 风险细分
  P1: 年报/资质/招投标/融资/财务三表/出质抵押担保/舆情 | 高级搜索/批量查询
  P2: 信用报告 | 开放API网关(真实配额计费) | 三要素核验 | 企业地图 | 雷达设置
架构模拟保持不变：ES检索 / Redis(缓存·热搜·限流·布隆·配额) / Spark穿透预计算 / Kafka事件
"""
import time, difflib, threading, json, datetime, itertools
from collections import defaultdict, deque
from urllib.parse import parse_qs
from functools import wraps
from flask import Flask, jsonify, request, send_from_directory, session

import data as D

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = "qcc-demo-secret-key"

BLOOM = set(D.COMPANIES.keys())
NULL_PLACEHOLDER = "@@NULL@@"
TODAY = lambda: time.strftime("%Y-%m-%d")

# ============================================================
# Redis 模拟
# ============================================================
class FakeRedis:
    def __init__(self):
        self.kv, self.ttl = {}, {}
        self.zsets = defaultdict(dict)
        self.hits = self.misses = 0
        self.lock = threading.Lock()
    def get(self, key):
        with self.lock:
            if key not in self.kv:
                self.misses += 1; return None
            self.hits += 1
            if self.ttl.get(key) and time.time() > self.ttl[key]:
                del self.kv[key]; del self.ttl[key]; self.misses += 1; return None
            return self.kv[key]
    def set(self, key, val, ttl=None):
        with self.lock:
            self.kv[key] = val
            self.ttl[key] = time.time() + ttl if ttl else None
    def delete(self, *keys):
        with self.lock:
            for k in keys: self.kv.pop(k, None); self.ttl.pop(k, None)
    def incr(self, key, ttl=None):
        with self.lock:
            v = int(self.kv.get(key, 0)) + 1
            self.kv[key] = str(v)
            if ttl and key not in self.ttl: self.ttl[key] = time.time() + ttl
            return v
    def zincrby(self, name, member, delta=1):
        with self.lock: self.zsets[name][member] = self.zsets[name].get(member, 0) + delta
    def zrevrange(self, name, top=10):
        with self.lock:
            return sorted(self.zsets[name].items(), key=lambda x: -x[1])[:top]
    def hit_rate(self):
        t = self.hits + self.misses
        return round(self.hits * 100.0 / t, 1) if t else 0.0

R = FakeRedis()

RATE_LIMIT, RATE_WINDOW = 30, 60
rate_windows = defaultdict(deque)
def try_acquire(ip):
    now, win = time.time(), rate_windows[ip]
    while win and win[0] < now - RATE_WINDOW: win.popleft()
    if len(win) >= RATE_LIMIT: return False
    win.append(now); return True

# ============================================================
# Kafka 事件总线 + 雷达推送（变更落库）
# ============================================================
EVENTS = deque(maxlen=50)
def publish(topic, payload):
    EVENTS.appendleft(dict(topic=topic, payload=payload, ts=time.strftime("%Y-%m-%d %H:%M:%S")))
    if topic != "company-change":
        return
    notified = D.MONITORS.get(payload.get("company_id"), [])
    if notified:
        s = D.MONITOR_SETTINGS.get(notified[0], {})
        publish("radar-notify", {"company_id": payload["company_id"], "users": notified,
                                 "channels": s.get("channels", ["app"]),
                                 "msg": f"您关注的企业【{D.COMPANIES[payload['company_id']]['company_name']}】发生工商变更"})

# ============================================================
# 认证与权限
# ============================================================
def current_user():
    uid = session.get("uid")
    for u, info in D.USERS.items():
        if info["uid"] == uid:
            return dict(username=u, uid=uid, role=info["role"], plan=D.ROLE_TEXT.get(info["role"], "普通用户"))
    return None

def require_login(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not current_user():
            return jsonify(code=40101, msg="鉴权失败：请先登录"), 401
        return fn(*a, **kw)
    return wrapper

def vip_full(user):
    return user and user["role"] >= 2

# 会员套餐 → 开放API每日配额
def open_quota(user):
    return {1: 20, 2: 1000, 3: 1000, 4: 5000, 5: 100000}.get(user["role"], 20)

@app.route("/api/auth/login", methods=["POST"])
def api_login():
    body = request.get_json(silent=True) or {}
    u = body.get("username")
    info = D.USERS.get(u)
    if not info or info.get("password") != body.get("password"):
        return jsonify(code=40101, msg="用户名或密码错误"), 401
    session["uid"] = info["uid"]
    return jsonify(code=0, data=dict(username=u, uid=info["uid"], role=info["role"],
                                     plan=D.ROLE_TEXT.get(info["role"]), apiKey=f"qcc_{info['uid']}_{u}"))

@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.pop("uid", None)
    return jsonify(code=0)

@app.route("/api/auth/me")
def api_me():
    return jsonify(code=0, data=current_user())

@app.route("/api/member/plans")
def api_plans():
    return jsonify(code=0, data=dict(plans=D.PLANS, privileges=D.PRIVILEGES))

@app.route("/api/member/subscribe", methods=["POST"])
def api_subscribe():
    u = current_user()
    if not u: return jsonify(code=40101, msg="请先登录"), 401
    D.USERS[u["username"]]["role"] = 2
    return jsonify(code=0, msg="订阅成功：已开通 VIP 会员（演示）", data=dict(role=2, plan="VIP会员"))

# ============================================================
# 查企业：ES 检索 + 高级搜索 + 批量查询
# ============================================================
def highlight(text, kw):
    return text.replace(kw, f"<em>{kw}</em>") if kw and kw in text else text

def risk_counts(cid):
    r = _risk_rows(cid)
    return dict(lawsuit=len(r["lawsuits"]), dishonest=len(r["dishonest"]), zhixing=len(r["zhixing"]),
                xianxiao=len(r["xianxiao"]), penalty=len(r["penalties"]), abnormal=len(r["abnormal"]),
                pledge=len(r["pledges"]), mortgage=len(r["mortgages"]), guarantee=len(r["guarantees"]),
                total=sum(len(v) for v in r.values()))

def _base_row(cid, kw=None):
    c = D.COMPANIES[cid]
    rk = risk_counts(cid)
    return dict(companyId=cid, companyName=highlight(c["company_name"], kw or ""),
        legalPerson=highlight(c["legal_person"], kw or ""), creditCode=c["credit_code"],
        registerCapital=c["register_capital"], establishTime=c["establish_time"],
        industry=c["industry"], province=c["province"], city=c["city"],
        status=c["company_status"], statusText=D.STATUS_TEXT[c["company_status"]][0],
        tags=c.get("tags", []),
        risk=dict(lawsuit=rk["lawsuit"], dishonest=rk["dishonest"], zhixing=rk["zhixing"], total=rk["total"]))

@app.route("/api/search")
def api_search():
    t0 = time.time()
    _q = lambda n: (parse_qs(request.query_string.decode("utf-8", "ignore")).get(n) or [""])[0]
    kw = _q("keyword").strip()
    if not kw: return jsonify(code=40001, msg="参数错误：keyword 必填")
    R.zincrby("qcc:hot:search", kw)
    scored = []
    for cid, c in D.COMPANIES.items():
        hay = " ".join([c["company_name"], c["pinyin"], c["legal_person"], c["credit_code"]] + c.get("tags", []))
        s = 2.0 if kw in c["company_name"] else 1.2 if kw in hay else 0.0
        if s: scored.append((s, cid))
    scored.sort(reverse=True)
    suggestion = None
    if not scored:
        pool = [c["company_name"] for c in D.COMPANIES.values()] + [c["pinyin"] for c in D.COMPANIES.values()]
        close = difflib.get_close_matches(kw.lower(), [p.lower() for p in pool], n=1, cutoff=0.6)
        if close:
            for cid, c in D.COMPANIES.items():
                if close[0] in (c["company_name"].lower(), c["pinyin"]):
                    suggestion = dict(cid=cid, name=c["company_name"]); break
    results = [_base_row(cid, kw) for _, cid in scored]
    return jsonify(code=0, data=results, suggestion=suggestion,
                   costMs=round((time.time() - t0) * 1000, 1), total=len(results))

@app.route("/api/search/advanced", methods=["POST"])
def api_search_advanced():
    f = request.get_json(silent=True) or {}
    res = []
    for cid, c in D.COMPANIES.items():
        if f.get("keyword") and f["keyword"] not in c["company_name"] + c["pinyin"] + c["legal_person"]: continue
        if f.get("industry") and f["industry"] not in c["industry"]: continue
        if f.get("province") and f["province"] != c["province"]: continue
        if f.get("status") and int(f["status"]) != c["company_status"]: continue
        if f.get("estabFrom") and c["establish_time"] < f["estabFrom"]: continue
        if f.get("estabTo") and c["establish_time"] > f["estabTo"]: continue
        if f.get("tag") and f["tag"] not in c.get("tags", []): continue
        res.append(_base_row(cid))
    return jsonify(code=0, data=res, total=len(res))

@app.route("/api/search/batch", methods=["POST"])
def api_search_batch():
    names = (request.get_json(silent=True) or {}).get("names") or []
    out = []
    for n in names[:20]:
        hit = next((cid for cid, c in D.COMPANIES.items() if n in c["company_name"]), None)
        out.append(dict(keyword=n, found=hit is not None, company=_base_row(hit) if hit else None))
    return jsonify(code=0, data=out, total=len(out))

# ============================================================
# 风险细分 + 企业全量聚合 + 信用报告
# ============================================================
def _risk_rows(cid):
    return dict(
        lawsuits=[dict(title=t, ctype=ct, court=co, date=d, status=s,
                       statusText=["", "审理中", "已判决", "执行中"][s]) for (o, t, ct, co, d, s) in D.LAWSUITS if o == cid],
        dishonest=[dict(caseNo=n, date=d, behavior=b, court=c, perform=p, amount=a)
                   for (o, n, d, b, c, p, a) in D.DISHONEST if o == cid],
        zhixing=[dict(caseNo=n, date=d, amount=a, court=c)
                 for (o, n, d, a, c) in D.ZHIXING if o == cid],
        xianxiao=[dict(caseNo=n, date=d, court=c, target=t)
                  for (pid, name, o, n, d, c, t) in D.XIANXIAO if o == cid],
        penalties=[dict(reason=r, org=g, date=d, result=rr) for (o, r, g, d, rr) in D.PENALTIES if o == cid],
        abnormal=[dict(reason=r, date=d, org=g) for (o, r, d, g) in D.ABNORMAL if o == cid],
        pledges=[dict(pledgor=p, pledgee=q, shares=s, status=st, date=d)
                 for (o, p, q, s, st, d) in D.PLEDGES if o == cid],
        mortgages=[dict(property=p, org=g, amount=a, date=d, status=s)
                   for (o, p, g, a, d, s) in D.MORTGAGES if o == cid],
        guarantees=[dict(beneficiary=b, kind=k, amount=a, date=d, status=s)
                    for (o, b, k, a, d, s) in D.GUARANTEES if o == cid],
    )

def _gather(cid, user=None):
    """聚合企业全量数据（/all 与 /report 共用）"""
    c = D.COMPANIES[cid]
    risks = _risk_rows(cid)
    contact = c.get("contact", "")
    if not vip_full(user) and "*" not in contact and contact != "—":
        contact = contact[:3] + "****" + contact[7:] if len(contact) >= 11 else contact
    full_vip = vip_full(user)
    return dict(
        companyId=cid, **{k: c[k] for k in ("company_name", "credit_code", "legal_person", "register_capital",
                                            "establish_time", "industry", "province", "city", "address",
                                            "org_type", "reg_institute", "employees", "tags", "business_scope")},
        contact=contact, listed=c.get("listed", False), stockCode=c.get("stock_code"),
        statusText=D.STATUS_TEXT[c["company_status"]][0],
        shareholders=[dict(name=n, ratio=r, type="自然人股东") for (o, n, r) in D.PERSON_SHARE if o == cid]
                   + [dict(name=n, ratio=r, type="企业法人股东") for (ow, n, obj, r, a, t) in D.INVEST if obj == cid],
        staff=[dict(name=n, position=p, entry=s, exit=e) for (o, n, p, s, e) in D.STAFF if o == cid],
        invests=[dict(name=n, ratio=r, amount=a) for (ow, n, obj, r, a, t) in D.INVEST if ow == cid],
        riskSummary=risk_counts(cid), **risks,
        history=[dict(type=D.HISTORY_TYPE[t], name=n, note=note, start=s, end=e)
                 for (o, t, n, note, s, e) in D.HISTORY if o == cid],
        changes=[dict(item=i, before=b, after=a, date=d) for (o, i, b, a, d) in D.CHANGE_LOG if o == cid],
        ips=D.IP.get(cid, []),
        annual=D.ANNUAL.get(cid, []) if full_vip or c.get("listed") else [],
        licenses=[dict(name=n, org=g, num=num, start=s, end=e, status=s2)
                  for (o, n, g, num, s, e, s2) in D.LICENSES if o == cid],
        biddings=[dict(role=r, project=p, amount=a, date=d, party=pt)
                  for (o, r, p, a, d, pt) in D.BIDDINGS if o == cid],
        financings=[dict(round_=r, amount=a, date=d, investors=i, valuation=v)
                    for (o, r, a, d, i, v) in D.FINANCINGS if o == cid],
        financials=D.FINANCIALS.get(cid) if full_vip else None,
        news=[dict(title=t, source=s, date=d, sentiment=s2, summary=su)
              for (o, s2, t, s, d, su) in D.NEWS if o == cid],
    )

@app.route("/api/company/<int:cid>")
def api_company(cid):
    t0 = time.time()
    if not try_acquire(request.remote_addr or "test"):
        return jsonify(code=42901, msg=f"限流/配额不足：IP 触发滑动窗口限流（{RATE_LIMIT}次/分钟）"), 429
    if cid not in BLOOM:
        return jsonify(code=0, data=None, msg="布隆过滤器拦截：非法企业ID"), 404
    key = f"qcc:company:base:{cid}"
    cached = R.get(key)
    if cached == NULL_PLACEHOLDER:
        return jsonify(code=0, data=None, costMs=round((time.time() - t0) * 1000, 1))
    if cached:
        return jsonify(code=0, data=json.loads(cached), cache="HIT", costMs=round((time.time() - t0) * 1000, 1))
    time.sleep(0.045)
    if cid not in D.COMPANIES:
        R.set(key, NULL_PLACEHOLDER, ttl=60)
        return jsonify(code=0, data=None, cache="NULL_CACHE", costMs=round((time.time() - t0) * 1000, 1))
    c = D.COMPANIES[cid]
    data = _base_row(cid)
    data.update(address=c["address"], orgType=c["org_type"], regInstitute=c["reg_institute"],
                employees=c["employees"], riskSummary=risk_counts(cid))
    hot = dict(R.zsets.get("qcc:hot:search", {}))
    ttl = 300 if hot.get(c["company_name"], 0) >= 3 else 7 * 86400
    R.set(key, json.dumps(data, ensure_ascii=False), ttl=ttl)
    return jsonify(code=0, data=data, cache="MISS->DB", ttl=ttl, costMs=round((time.time() - t0) * 1000, 1))

@app.route("/api/company/<int:cid>/all")
@require_login
def api_company_all(cid):
    if cid not in D.COMPANIES:
        return jsonify(code=40401, msg="企业不存在"), 404
    return jsonify(code=0, data=_gather(cid, current_user()))

@app.route("/api/company/<int:cid>/report")
@require_login
def api_report(cid):
    if cid not in D.COMPANIES:
        return jsonify(code=40401, msg="企业不存在"), 404
    u = current_user()
    if u["role"] == 1:  # 普通用户每日3份
        used = R.incr(f"qcc:report:quota:{u['uid']}:{TODAY()}", ttl=172800)
        if used > 3:
            return jsonify(code=42901, msg="今日信用报告额度已用完（普通用户3份/日），升级VIP不限量"), 429
    d = _gather(cid, u)
    return jsonify(code=0, data=dict(
        reportNo=f"QCC-RPT-{cid}-{time.strftime('%Y%m%d%H%M%S')}",
        generatedAt=time.strftime("%Y-%m-%d %H:%M:%S"), generatedBy=u["username"], **d))

# ============================================================
# 查老板（人物维度）
# ============================================================
def _person_companies(pid):
    name = D.PERSONS[pid]["name"]
    comps = {}
    def _add(o):
        return comps.setdefault(o, dict(companyId=o, companyName=D.COMPANIES[o]["company_name"],
            statusText=D.STATUS_TEXT[D.COMPANIES[o]["company_status"]][0], roles=[], ratios=[]))
    for (o, n, p, s, e) in D.STAFF:
        if n == name: _add(o)["roles"].append(p)
    for (o, n, r) in D.PERSON_SHARE:
        if n == name: _add(o)["ratios"].append(f"{r}%")
    for (ow, n, obj, r, a, t) in D.INVEST:
        if t == 2 and n == name: _add(obj)["ratios"].append(f"{r}%")
    out = list(comps.values())
    for c in out:
        c["riskTotal"] = risk_counts(c["companyId"])["total"]
    return out

@app.route("/api/person/search")
def api_person_search():
    _q = lambda n: (parse_qs(request.query_string.decode("utf-8", "ignore")).get(n) or [""])[0]
    kw = _q("keyword").strip()
    if not kw: return jsonify(code=40001, msg="参数错误：keyword 必填")
    R.zincrby("qcc:hot:person", kw)
    res = [dict(pid=pid, **info, companyCount=len(_person_companies(pid)))
           for pid, info in D.PERSONS.items() if kw in info["name"]]
    return jsonify(code=0, data=res, total=len(res))

@app.route("/api/person/<int:pid>")
def api_person(pid):
    if pid not in D.PERSONS:
        return jsonify(code=40401, msg="人物不存在"), 404
    name = D.PERSONS[pid]["name"]
    xianxiao = [dict(caseNo=n, date=d, court=c, target=t)
                for (p, nm, o, n, d, c, t) in D.XIANXIAO if p == pid]
    dishonest = [dict(caseNo=n, court=c, date=d)
                 for (o, n, d, b, c, p, a) in D.DISHONEST if D.COMPANIES[o]["legal_person"] == name]
    return jsonify(code=0, data=dict(pid=pid, **D.PERSONS[pid],
        companies=_person_companies(pid),
        risks=dict(xianxiao=xianxiao, dishonest=dishonest, count=len(xianxiao) + len(dishonest))))

# ============================================================
# 查关系（多主体最短路径 BFS，缓存 qcc:graph:path:*）
# ============================================================
def _build_graph():
    g = defaultdict(list)
    def add(a, b, label):
        g[a].append((b, label)); g[b].append((a, label))
    for (ow, n, obj, r, a, t) in D.INVEST:
        add(("c", ow), ("c", obj), f"对外投资 {r}%")
    for (o, n, r) in D.PERSON_SHARE:
        add(("p_person", n), ("c", o), f"持股 {r}%")
    for (o, n, p, s, e) in D.STAFF:
        add(("p_person", n), ("c", o), f"任职 {p}")
    return g

GRAPH = _build_graph()

def _node(n):
    if n[0] == "c":
        return dict(type="company", id=n[1], name=D.COMPANIES[n[1]]["company_name"])
    return dict(type="person", id=n[1], name=n[1])

@app.route("/api/graph/path")
def api_graph_path():
    t0 = time.time()
    _q = lambda n: (parse_qs(request.query_string.decode("utf-8", "ignore")).get(n) or [""])[0]
    try:
        a, b = int(_q("from")), int(_q("to"))
    except ValueError:
        return jsonify(code=40001, msg="参数错误：from/to 必须为企业ID")
    if a == b: return jsonify(code=40001, msg="两个主体相同")
    if a not in D.COMPANIES or b not in D.COMPANIES:
        return jsonify(code=40401, msg="企业不存在"), 404
    key = f"qcc:graph:path:{a}:{b}"
    cached = R.get(key)
    if cached:
        d = json.loads(cached)
        d.update(cache="HIT", costMs=round((time.time() - t0) * 1000, 1))
        return jsonify(code=0, data=d, cache="HIT")
    start, goal = ("c", a), ("c", b)
    prev = {start: None}
    q = deque([start]); found = False
    while q:
        cur = q.popleft()
        if cur == goal: found = True; break
        for (nb, label) in GRAPH.get(cur, []):
            if nb not in prev:
                prev[nb] = (cur, label); q.append(nb)
    if not found:
        return jsonify(code=0, data=dict(found=False, msg="未发现关联路径"),
                       cache="MISS", costMs=round((time.time() - t0) * 1000, 1))
    chain, cur = [], goal
    while prev[cur]:
        p, label = prev[cur]
        chain.append(dict(frm=_node(p), label=label, to=_node(cur)))
        cur = p
    chain.reverse()
    data = dict(found=True, hops=len(chain), chain=chain)
    R.set(key, json.dumps(data, ensure_ascii=False), ttl=7 * 86400)
    return jsonify(code=0, data=data, cache="MISS->BFS", costMs=round((time.time() - t0) * 1000, 1))

# ============================================================
# 股权穿透（LLD 5.1 逻辑不变）
# ============================================================
def _precompute_penetration():
    trees = {}
    def build(cid):
        node = dict(companyId=cid, name=D.COMPANIES[cid]["company_name"], children=[])
        for (owner, obj_name, obj_id, ratio, amount, t) in D.INVEST:
            if owner == cid:
                child = build(obj_id); child["ratio"] = ratio / 100.0
                node["children"].append(child)
        return node
    def controller(node, carried=1.0, best=None):
        for (cid, name, ratio) in D.PERSON_SHARE:
            if cid == node["companyId"]:
                r = carried * ratio / 100.0
                if best is None or r > best["controlRatio"]:
                    best = dict(type="PERSON", name=name, controlRatio=round(r, 4))
        for ch in node["children"]:
            best = controller(ch, carried * ch["ratio"], best)
        return best
    for cid in D.COMPANIES:
        tree = build(cid)
        trees[cid] = dict(companyId=cid, companyName=D.COMPANIES[cid]["company_name"],
                          controller=controller(tree), children=tree["children"])
    return trees

PENETRATION = _precompute_penetration()

@app.route("/api/graph/<int:cid>")
def api_graph(cid):
    t0 = time.time()
    key = f"qcc:graph:penetrate:{cid}"
    cached = R.get(key)
    if cached:
        return jsonify(code=0, data=json.loads(cached), cache="HIT",
                       source="Spark 预计算 -> Redis", costMs=round((time.time() - t0) * 1000, 1))
    tree = PENETRATION.get(cid)
    if tree is None: return jsonify(code=40401, msg="无该企业的穿透数据"), 404
    R.set(key, json.dumps(tree, ensure_ascii=False), ttl=7 * 86400)
    return jsonify(code=0, data=tree, cache="MISS->预计算回源",
                   source="Spark 预计算 -> Redis", costMs=round((time.time() - t0) * 1000, 1))

# ============================================================
# 热搜 / 快讯 / 地图
# ============================================================
@app.route("/api/hot")
def api_hot():
    return jsonify(code=0, data=[dict(kw=k, score=s) for k, s in R.zrevrange("qcc:hot:search", 10)])

@app.route("/api/news/flash")
def api_flash():
    return jsonify(code=0, data=[dict(time=t, title=ti, company=c) for (t, ti, c) in D.FLASH])

@app.route("/api/map/companies")
def api_map():
    pts = [dict(companyId=cid, name=c["company_name"], province=c["province"], city=c["city"],
                lng=c["lng"], lat=c["lat"], status=D.STATUS_TEXT[c["company_status"]][0],
                riskTotal=risk_counts(cid)["total"], industry=c["industry"])
           for cid, c in D.COMPANIES.items()]
    by_province = defaultdict(int)
    for p in pts: by_province[p["province"]] += 1
    return jsonify(code=0, data=dict(points=pts, provinces=dict(by_province)))

# ============================================================
# 监控雷达（订阅 + 推送设置）
# ============================================================
@app.route("/api/monitor/settings", methods=["GET", "POST"])
@require_login
def api_monitor_settings():
    u = current_user()
    if request.method == "GET":
        subs = [dict(companyId=cid, companyName=D.COMPANIES[cid]["company_name"],
                     status=D.STATUS_TEXT[D.COMPANIES[cid]["company_status"]][0])
                for cid, users in D.MONITORS.items() if u["uid"] in users]
        return jsonify(code=0, data=dict(subscriptions=subs,
            settings=D.MONITOR_SETTINGS.get(u["uid"], dict(channels=["app"], types=[1, 2, 3]))))
    body = request.get_json(silent=True) or {}
    D.MONITOR_SETTINGS[u["uid"]] = dict(channels=body.get("channels", ["app"]), types=body.get("types", [1, 2, 3]))
    return jsonify(code=0, msg="推送设置已保存")

@app.route("/api/monitor/subscribe/<int:cid>", methods=["POST", "DELETE"])
@require_login
def api_monitor_sub(cid):
    u = current_user()
    if request.method == "POST":
        D.MONITORS.setdefault(cid, [])
        if u["uid"] not in D.MONITORS[cid]: D.MONITORS[cid].append(u["uid"])
        return jsonify(code=0, msg=f"已订阅【{D.COMPANIES[cid]['company_name']}】变更雷达")
    if cid in D.MONITORS and u["uid"] in D.MONITORS[cid]:
        D.MONITORS[cid].remove(u["uid"])
    return jsonify(code=0, msg="已取消订阅")

# ============================================================
# 开放 API 网关（ApiCode 风格 + 真实配额计费）
# ============================================================
OPEN_APIS = [
    dict(code=410,  name="企业工商信息", path="/api/open/company/{cid}", price=0.20),
    dict(code=411,  name="企业风险聚合", path="/api/open/risk/{cid}", price=0.20),
    dict(code=453,  name="股权结构图(穿透树)", path="/api/open/graph/{cid}", price=2.00),
    dict(code=886,  name="企业模糊搜索", path="/api/open/search?keyword=", price=0.10),
    dict(code=1074, name="企业三要素验证", path="/api/verify", price=0.10),
]
OPEN_INDEX = {a["code"]: a for a in OPEN_APIS}

def _openid(user):
    return f"qcc_{user['uid']}_{user['username']}"

def _find_user_by_key(key):
    for u, info in D.USERS.items():
        if _openid(dict(uid=info["uid"], username=u, role=info["role"])) == key:
            return dict(username=u, uid=info["uid"], role=info["role"])
    return None

def _open_consume(user, code):
    quota = open_quota(user)
    used = R.incr(f"qcc:api:quota:{user['uid']}:{TODAY()}", ttl=172800)
    if used > quota:
        return None, jsonify(error_code=42901, reason="quota exceeded",
                             result=dict(used=used, quota=quota, msg="今日开放API配额已用完"))
    api = OPEN_INDEX.get(code)
    return round(api["price"], 2) if api else 0, None

@app.route("/api/open/keys")
@require_login
def api_open_keys():
    u = current_user()
    used = int(R.kv.get(f"qcc:api:quota:{u['uid']}:{TODAY()}", 0))
    return jsonify(code=0, data=dict(apiKey=_openid(u), quota=open_quota(u), used=used,
                                     date=TODAY(), apis=OPEN_APIS))

def _open_response(code, result):
    return jsonify(error_code=0, reason="ok", result=result, bill=dict(apiCode=code))

@app.route("/api/open/company/<int:cid>")
def api_open_company(cid):
    u = _find_user_by_key(request.args.get("apiKey", ""))
    if not u: return jsonify(error_code=40101, reason="invalid api key"), 401
    bill, err = _open_consume(u, 410)
    if err: return err
    if cid not in D.COMPANIES: return jsonify(error_code=40401, reason="not found"), 404
    c = D.COMPANIES[cid]
    return _open_response(410, dict(name=c["company_name"], creditCode=c["credit_code"],
        legalPerson=c["legal_person"], regCapital=c["register_capital"],
        regStatus=D.STATUS_TEXT[c["company_status"]][0], estiblishTime=c["establish_time"],
        industry=c["industry"], regLocation=c["address"], contact=c.get("contact"), tags=c.get("tags")))

@app.route("/api/open/risk/<int:cid>")
def api_open_risk(cid):
    u = _find_user_by_key(request.args.get("apiKey", ""))
    if not u: return jsonify(error_code=40101, reason="invalid api key"), 401
    bill, err = _open_consume(u, 411)
    if err: return err
    return _open_response(411, risk_counts(cid))

@app.route("/api/open/graph/<int:cid>")
def api_open_graph(cid):
    u = _find_user_by_key(request.args.get("apiKey", ""))
    if not u: return jsonify(error_code=40101, reason="invalid api key"), 401
    bill, err = _open_consume(u, 453)
    if err: return err
    return _open_response(453, PENETRATION.get(cid, {}))

@app.route("/api/open/search")
def api_open_search():
    u = _find_user_by_key(request.args.get("apiKey", ""))
    if not u: return jsonify(error_code=40101, reason="invalid api key"), 401
    bill, err = _open_consume(u, 886)
    if err: return err
    _q = lambda n: (parse_qs(request.query_string.decode("utf-8", "ignore")).get(n) or [""])[0]
    kw = _q("keyword")
    res = [dict(id=cid, name=c["company_name"], creditCode=c["credit_code"],
                legalPerson=c["legal_person"], regStatus=D.STATUS_TEXT[c["company_status"]][0])
           for cid, c in D.COMPANIES.items() if kw and kw in c["company_name"]]
    return _open_response(886, dict(total=len(res), items=res))

# ============================================================
# 三要素核验
# ============================================================
@app.route("/api/verify")
def api_verify():
    _q = lambda n: (parse_qs(request.query_string.decode("utf-8", "ignore")).get(n) or [""])[0]
    name, code, lp = _q("name").strip(), _q("creditCode").strip(), _q("legalPerson").strip()
    if not (name and code and lp):
        return jsonify(code=40001, msg="参数错误：name/creditCode/legalPerson 必填")
    for cid, c in D.COMPANIES.items():
        if c["company_name"] == name and c["credit_code"] == code and c["legal_person"] == lp:
            return jsonify(code=0, data=dict(match=True, companyId=cid, msg="三要素一致"))
        if c["credit_code"] == code or c["company_name"] == name:
            detail = []
            if c["company_name"] != name: detail.append("企业名称不一致")
            if c["credit_code"] != code: detail.append("信用代码不一致")
            if c["legal_person"] != lp: detail.append("法定代表人不一致")
            return jsonify(code=0, data=dict(match=False, companyId=cid, detail=detail, msg="三要素校验不通过"))
    return jsonify(code=0, data=dict(match=False, msg="未找到匹配企业"))

# ============================================================
# 管理后台：模拟企业变更（变更落库 + 删缓存 + 雷达）
# ============================================================
@app.route("/api/admin/change/<int:cid>", methods=["POST"])
def api_change(cid):
    if cid not in D.COMPANIES:
        return jsonify(code=40401, msg="企业不存在"), 404
    c = D.COMPANIES[cid]
    D.CHANGE_LOG.append((cid, "登记事项变更（爬虫增量抓取）", "旧值", "新值（演示自动写入）", TODAY()))
    publish("company-change", dict(company_id=cid, field="register_capital",
                                   value=c["register_capital"], source="爬虫增量抓取"))
    R.delete(f"qcc:company:base:{cid}", f"qcc:graph:penetrate:{cid}",
             f"qcc:graph:controller:{cid}", f"qcc:graph:group:{cid}")
    return jsonify(code=0, msg=f"已触发【{c['company_name']}】变更：Kafka分发 -> 更新台账+变更记录落库 -> 删除脏缓存 -> 雷达推送")

@app.route("/api/stats")
def api_stats():
    return jsonify(code=0, data=dict(
        cacheHits=R.hits, cacheMisses=R.misses, cacheHitRate=R.hit_rate(),
        totalCompanies=len(D.COMPANIES), totalPersons=len(D.PERSONS),
        events=list(EVENTS)[:10],
        rateLimit=dict(limit=f"{RATE_LIMIT} 次/{RATE_WINDOW}秒/IP",
                       current={ip: len(w) for ip, w in list(rate_windows.items())[-5:]})))

@app.route("/")
def index():
    return send_from_directory("static", "index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
