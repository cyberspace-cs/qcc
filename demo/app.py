# -*- coding: utf-8 -*-
"""
企业征信查询平台（对标企查查）演示版后端
按照 HLD/LLD 文档实现核心链路：
  - ES 检索模拟（分词/拼音纠错/高亮/筛选）
  - Redis 模拟（缓存命中统计、动态TTL、热搜ZSet、滑动窗口限流、布隆过滤器、空值缓存）
  - 股权穿透（预计算结果缓存，只读缓存不实时递归）
  - Kafka 事件总线模拟（企业变更 -> 更新DB -> 删缓存 -> 推送监控雷达）
"""
import time, difflib, threading, json
from collections import defaultdict, deque
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

# ============================================================
# 1. 模拟数据层（MySQL 台账 + Nebula 图谱的预计算结果）
# ============================================================
COMPANIES = {
    10000001: dict(company_name="星辰控股集团有限公司", credit_code="91330100MA2STAR000",
        legal_person="张三", register_capital="50000万人民币", establish_time="2010-01-01",
        company_status=1, industry="投资与资产管理", province="浙江省", city="杭州市",
        address="杭州市西湖区星辰大道1号星辰中心A座", pinyin="xingchen konggu jituan"),
    10000002: dict(company_name="星辰智科有限公司", credit_code="91330106MA2STAR001",
        legal_person="李四", register_capital="8000万人民币", establish_time="2015-06-18",
        company_status=1, industry="软件和信息技术服务业", province="浙江省", city="杭州市",
        address="杭州市西湖区星辰大道1号星辰中心B座", pinyin="xingchen zhike"),
    10000003: dict(company_name="星辰数字科技有限公司", credit_code="91440300MA2STAR002",
        legal_person="王五", register_capital="12000万人民币", establish_time="2017-03-22",
        company_status=1, industry="软件和信息技术服务业", province="广东省", city="深圳市",
        address="深圳市南山区科技园星辰大厦18层", pinyin="xingchen shuzi keji"),
    10000004: dict(company_name="云帆信息技术有限公司", credit_code="91310115MA3YUNFA01",
        legal_person="赵六", register_capital="3000万人民币", establish_time="2012-09-10",
        company_status=1, industry="软件和信息技术服务业", province="上海市", city="上海市",
        address="上海市浦东新区张江高科技园区云帆路100号", pinyin="yunfan xinxi jishu"),
    10000005: dict(company_name="华芯半导体有限公司", credit_code="91320594MA4HUAXIN01",
        legal_person="陈明", register_capital="80000万人民币", establish_time="2018-11-05",
        company_status=1, industry="计算机、通信和其他电子设备制造业", province="江苏省", city="苏州市",
        address="苏州工业园区华芯路88号", pinyin="huaxin bandati"),
    10000006: dict(company_name="澜海生物医药有限公司", credit_code="91310112MA5LANHAI01",
        legal_person="周芸", register_capital="15000万人民币", establish_time="2014-04-25",
        company_status=1, industry="医药制造业", province="上海市", city="上海市",
        address="上海市闵行区澜海路500号生命科学园3栋", pinyin="lanhai shengwuyiyao"),
    10000007: dict(company_name="磐石建设工程有限公司", credit_code="91330110MA6PANSHI01",
        legal_person="吴强", register_capital="20000万人民币", establish_time="2008-07-01",
        company_status=1, industry="土木工程建筑业", province="浙江省", city="杭州市",
        address="杭州市拱墅区磐石路2号", pinyin="panshi jianshe gongcheng"),
    10000008: dict(company_name="极光新能源科技有限公司", credit_code="91440300MA7JIGUANG1",
        legal_person="孙立", register_capital="30000万人民币", establish_time="2019-12-12",
        company_status=1, industry="电气机械和器材制造业", province="广东省", city="深圳市",
        address="深圳市宝安区极光工业园", pinyin="jiguang xinnengyuan"),
    10000009: dict(company_name="锦绣文旅发展有限公司", credit_code="91330105MA8JINXIU01",
        legal_person="郑洁", register_capital="6000万人民币", establish_time="2011-05-20",
        company_status=2, industry="公共设施管理业", province="浙江省", city="杭州市",
        address="杭州市上城区锦绣街9号", pinyin="jinxiu wenlv"),
    10000010: dict(company_name="驰远物流股份有限公司", credit_code="91310000MA9CHIYUA01",
        legal_person="冯坤", register_capital="45000万人民币", establish_time="2005-03-15",
        company_status=1, industry="道路运输业", province="上海市", city="上海市",
        address="上海市青浦区驰远大道1号", pinyin="chiyuan wuliu"),
}

STATUS_TEXT = {1: ("存续", "green"), 2: ("注销", "gray"), 3: ("吊销", "red")}

# 股东投资表 company_invest（企业视角的对外投资）
INVEST = [
    # (company_id, invest_obj_name, invest_obj_id, share_ratio, invest_amount, invest_type)
    (10000001, "星辰智科有限公司",   10000002, 65.0,   "5200万人民币", 1),
    (10000001, "星辰数字科技有限公司", 10000003, 55.0,   "6600万人民币", 1),
    (10000002, "星辰数字科技有限公司", 10000003, 20.0,   "2400万人民币", 1),
    (10000003, "极光新能源科技有限公司", 10000008, 40.0, "12000万人民币", 1),
    (10000004, "星辰数字科技有限公司", 10000003, 5.0,    "600万人民币",  1),
]

# 高管任职表 company_staff
STAFF = [
    (10000001, "张三", "董事长", "2010-01-01", None), (10000001, "李四", "董事、总经理", "2015-06-18", None),
    (10000001, "王五", "监事", "2017-03-22", None),
    (10000002, "李四", "执行董事", "2015-06-18", None), (10000002, "钱七", "财务负责人", "2016-01-01", None),
    (10000003, "王五", "董事长兼总经理", "2017-03-22", None), (10000003, "周芸", "董事", "2019-01-01", None),
    (10000004, "赵六", "执行董事兼总经理", "2012-09-10", None),
    (10000005, "陈明", "董事长", "2018-11-05", None),
    (10000006, "周芸", "董事长兼首席科学家", "2014-04-25", None),
    (10000008, "孙立", "董事长兼总经理", "2019-12-12", None),
]

# 自然人股东（图库 Person 节点 + HOLD_SHARE 边）
PERSON_SHARE = [
    (10000001, "张三", 41.2), (10000001, "李四", 20.0),
    (10000004, "赵六", 70.0), (10000005, "陈明", 45.0), (10000005, "李四", 10.0),
    (10000006, "周芸", 60.0), (10000008, "王五", 30.0),
]

# 司法风险表 company_lawsuit
LAWSUITS = [
    (10000007, "买卖合同纠纷", "民事案件", "杭州市拱墅区人民法院", "2025-11-03", 2),
    (10000007, "建设工程施工合同纠纷", "民事案件", "浙江省高级人民法院", "2026-02-17", 1),
    (10000009, "劳动争议", "民事案件", "杭州市上城区人民法院", "2024-08-09", 2),
    (10000010, "机动车交通事故责任纠纷", "民事案件", "上海市青浦区人民法院", "2025-05-21", 2),
    (10000002, "计算机软件开发合同纠纷", "民事案件", "杭州市西湖区人民法院", "2026-01-12", 1),
]
# 行政处罚
PENALTIES = [
    (10000009, "未按规定公示年度报告", "杭州市市场监督管理局", "2024-06-30", "列入经营异常名录"),
    (10000010, "超限运输行政处罚", "上海市交通委员会执法总队", "2025-09-14", "罚款3万元"),
]

# 知识产权（专利/软著/商标摘要）
IP = {
    10000002: [("专利", "一种基于知识图谱的企业关联关系挖掘方法", "2024-11-20", "已授权"),
               ("软著", "星辰股权穿透分析系统V3.0", "2025-03-02", "已登记"),
               ("商标", "XINGCHEN AI", "2023-08-15", "已注册")],
    10000003: [("专利", "一种分布式图数据库查询优化方法", "2025-06-11", "实质审查"),
               ("软著", "星辰数据中台管理平台V2.1", "2024-09-30", "已登记")],
    10000005: [("专利", "一种车规级芯片封装结构", "2025-01-08", "已授权"),
               ("专利", "低功耗存储控制器及其控制方法", "2024-05-16", "已授权")],
    10000006: [("专利", "一种靶向蛋白降解剂及其应用", "2025-10-02", "实质审查")],
    10000008: [("专利", "一种光伏储能一体化控制装置", "2025-04-19", "已授权")],
}

# 监控雷达订阅表 user_monitor（模拟：用户->订阅企业）
MONITORS = {10000001: [1001, 1002], 10000002: [1001], 10000005: [1003], 10000007: [1001, 1002, 1003]}

# ---- 股权穿透：Spark 离线预计算结果（LLD 5.1.4 穿透树结构） ----
def _precompute_penetration():
    """模拟每日凌晨 Spark 全量重算：企业 -> 向下穿透树 + 实控人"""
    trees = {}
    def build(cid):
        node = dict(companyId=cid, name=COMPANIES[cid]["company_name"], children=[])
        for (owner, obj_name, obj_id, ratio, amount, t) in INVEST:
            if owner == cid:
                child = build(obj_id)
                child["ratio"] = ratio / 100.0
                node["children"].append(child)
        return node
    def controller(node, carried=1.0, best=None):
        """实控人：自然人持股沿链累乘，取控制比例最高者（简化模型）"""
        for (cid, name, ratio) in PERSON_SHARE:
            if cid == node["companyId"]:
                r = carried * ratio / 100.0
                if best is None or r > best["controlRatio"]:
                    best = dict(type="PERSON", name=name, controlRatio=round(r, 4))
        for ch in node["children"]:
            best = controller(ch, carried * ch["ratio"], best)
        return best
    for cid in COMPANIES:
        tree = build(cid)
        trees[cid] = dict(companyId=cid, companyName=COMPANIES[cid]["company_name"],
                          controller=controller(tree), children=tree["children"])
    return trees

PENETRATION = _precompute_penetration()

BLOOM = set(COMPANIES.keys())          # 布隆过滤器（简化：合法企业ID白名单）
NULL_PLACEHOLDER = "@@NULL@@"

# ============================================================
# 2. Redis 模拟（KV + ZSet + 命中统计 + 滑动窗口限流）
# ============================================================
class FakeRedis:
    def __init__(self):
        self.kv, self.ttl = {}, {}
        self.zsets = defaultdict(dict)          # name -> {member: score}
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
    def zincrby(self, name, member, delta=1):
        with self.lock: self.zsets[name][member] = self.zsets[name].get(member, 0) + delta
    def zrevrange(self, name, top=10):
        with self.lock:
            return sorted(self.zsets[name].items(), key=lambda x: -x[1])[:top]
    def hit_rate(self):
        total = self.hits + self.misses
        return round(self.hits * 100.0 / total, 1) if total else 0.0

R = FakeRedis()

# 滑动窗口限流：qcc:rate:limit:{ip}（LLD 5.4）
RATE_LIMIT, RATE_WINDOW = 20, 60
rate_windows = defaultdict(deque)
def try_acquire(ip):
    now, win = time.time(), rate_windows[ip]
    while win and win[0] < now - RATE_WINDOW: win.popleft()
    if len(win) >= RATE_LIMIT: return False
    win.append(now); return True

# ============================================================
# 3. Kafka 事件总线模拟 + 监控雷达推送
# ============================================================
EVENTS = deque(maxlen=50)
def publish(topic, payload):
    EVENTS.appendleft(dict(topic=topic, payload=payload, ts=time.strftime("%Y-%m-%d %H:%M:%S")))
    # 订阅雷达：仅 company-change 事件触发推送（避免 radar-notify 自身再递归）
    if topic != "company-change":
        return
    notified = MONITORS.get(payload.get("company_id"), [])
    if notified:
        publish("radar-notify", {"company_id": payload["company_id"],
                                 "users": notified, "msg": f"您关注的企业【{COMPANIES[payload['company_id']]['company_name']}】发生工商变更"})

# ============================================================
# 4. API 实现
# ============================================================
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

# ---- ES 检索模拟（LLD 5.2：分词 + 拼音纠错 + 模糊 + 高亮 + 筛选） ----
def highlight(text, kw):
    if kw and kw in text:
        return text.replace(kw, f"<em>{kw}</em>")
    return text

@app.route("/api/search")
def api_search():
    t0 = time.time()
    # 兼容不同客户端编码：直接按 UTF-8 解析原始 query_string（防止 latin-1 乱码）
    from urllib.parse import parse_qs
    _q = lambda n: (parse_qs(request.query_string.decode("utf-8", "ignore")).get(n) or [""])[0]
    kw = _q("keyword").strip()
    industry, status = _q("industry"), _q("status")
    if not kw:
        return jsonify(code=40001, msg="参数错误：keyword 必填")
    R.zincrby("qcc:hot:search", kw)                      # 热搜 ZSet

    results, scored = [], []
    for cid, c in COMPANIES.items():
        hay = c["company_name"] + " " + c["pinyin"] + " " + c["legal_person"] + " " + c["credit_code"]
        score = 2.0 if kw in c["company_name"] else 1.2 if kw in hay else 0.0
        if score > 0:
            scored.append((score, cid))
    scored.sort(reverse=True)

    suggestion = None
    if not scored:  # 拼音纠错 / 你是不是要找
        pool = [c["company_name"] for c in COMPANIES.values()] + [c["pinyin"] for c in COMPANIES.values()]
        close = difflib.get_close_matches(kw.lower(), [p.lower() for p in pool], n=1, cutoff=0.6)
        if close:
            for cid, c in COMPANIES.items():
                if close[0] in (c["company_name"].lower(), c["pinyin"]):
                    suggestion = dict(cid=cid, name=c["company_name"]); break

    for score, cid in scored:
        c = COMPANIES[cid]
        if industry and c["industry"] != industry: continue
        if status and str(c["company_status"]) != status: continue
        results.append(dict(companyId=cid, companyName=highlight(c["company_name"], kw),
            legalPerson=highlight(c["legal_person"], kw), creditCode=c["credit_code"],
            registerCapital=c["register_capital"], establishTime=c["establish_time"],
            industry=c["industry"], province=c["province"], city=c["city"],
            status=c["company_status"], statusText=STATUS_TEXT[c["company_status"]][0]))
    cost = round((time.time() - t0) * 1000, 1)
    return jsonify(code=0, data=results, suggestion=suggestion, costMs=cost, total=len(results))

# ---- 企业主页（LLD 5.5：布隆过滤器 + 空值缓存 + 动态TTL + 命中统计） ----
@app.route("/api/company/<int:cid>")
def api_company(cid):
    t0 = time.time()
    if not request.args.get("skip_rate") and not try_acquire(request.remote_addr or "test"):
        return jsonify(code=42901, msg="限流/配额不足：IP 触发滑动窗口限流（20次/分钟）"), 429
    if cid not in BLOOM:                                  # 布隆过滤器拦截
        return jsonify(code=0, data=None, msg="布隆过滤器拦截：非法企业ID"), 404
    key = f"qcc:company:base:{cid}"
    cached = R.get(key)
    if cached == NULL_PLACEHOLDER:
        return jsonify(code=0, data=None, costMs=round((time.time()-t0)*1000, 1))
    if cached:
        return jsonify(code=0, data=json.loads(cached), cache="HIT",
                       costMs=round((time.time()-t0)*1000, 1))
    time.sleep(0.045)                                     # 模拟回源 MySQL+聚合延迟
    c = COMPANIES.get(cid)
    if not c:
        R.set(key, NULL_PLACEHOLDER, ttl=60)              # 空值缓存防穿透
        return jsonify(code=0, data=None, cache="NULL_CACHE", costMs=round((time.time()-t0)*1000, 1))
    lawsuits = [l for l in LAWSUITS if l[0] == cid]
    penalties = [p for p in PENALTIES if p[0] == cid]
    data = dict(**c, companyId=cid,
        statusText=STATUS_TEXT[c["company_status"]][0], statusColor=STATUS_TEXT[c["company_status"]][1],
        shareholders=[dict(name=n, ratio=r, type="自然人股东") for (o, n, r) in PERSON_SHARE if o == cid]
                   + [dict(name=n, ratio=r, type="企业法人股东") for (owner, n, obj, r, a, t) in INVEST if obj == cid],
        staff=[dict(name=n, position=p, entry=s, exit=e) for (o, n, p, s, e) in STAFF if o == cid],
        invests=[dict(name=n, ratio=r, amount=a) for (owner, n, obj, r, a, t) in INVEST if owner == cid],
        riskSummary=dict(lawsuit=len(lawsuits), penalty=len(penalties), abnormal=1 if c["company_status"] == 2 else 0),
        lawsuits=[dict(title=t, ctype=ct, court=co, date=d, status=s) for (o, t, ct, co, d, s) in lawsuits],
        penalties=[dict(reason=rs, org=og, date=dt, result=rr) for (o, rs, og, dt, rr) in penalties],
        ips=IP.get(cid, []))
    # 动态TTL：热搜企业短TTL，冷门长TTL（HLD 性能优化）
    hot = dict(R.zsets.get("qcc:hot:search", {}))
    ttl = 300 if hot.get(c["company_name"], 0) >= 3 else 7 * 86400
    R.set(key, json.dumps(data, ensure_ascii=False), ttl=ttl)
    return jsonify(code=0, data=data, cache="MISS->DB", ttl=ttl, costMs=round((time.time()-t0)*1000, 1))

# ---- 股权穿透（LLD 5.1.3：只读预计算缓存，超时降级思路见文档） ----
@app.route("/api/graph/<int:cid>")
def api_graph(cid):
    t0 = time.time()
    key = f"qcc:graph:penetrate:{cid}"
    cached = R.get(key)
    if cached:
        return jsonify(code=0, data=json.loads(cached), cache="HIT",
                       source="Spark 预计算 -> Redis", costMs=round((time.time()-t0)*1000, 1))
    tree = PENETRATION.get(cid)
    if tree is None:
        return jsonify(code=40401, msg="无该企业的穿透数据"), 404
    R.set(key, json.dumps(tree, ensure_ascii=False), ttl=7 * 86400)
    return jsonify(code=0, data=tree, cache="MISS->预计算回源",
                   source="Spark 预计算 -> Redis", costMs=round((time.time()-t0)*1000, 1))

@app.route("/api/hot")
def api_hot():
    return jsonify(code=0, data=[dict(kw=k, score=s) for k, s in R.zrevrange("qcc:hot:search", 10)])

@app.route("/api/stats")
def api_stats():
    return jsonify(code=0, data=dict(
        cacheHits=R.hits, cacheMisses=R.misses, cacheHitRate=R.hit_rate(),
        totalCompanies=len(COMPANIES), events=list(EVENTS)[:10],
        rateLimit=dict(limit=f"{RATE_LIMIT} 次/{RATE_WINDOW}秒/IP",
                       current={ip: len(w) for ip, w in list(rate_windows.items())[-5:]})))

# ---- 管理后台：模拟企业变更（HLD 4.2 数据更新流程） ----
@app.route("/api/admin/change/<int:cid>", methods=["POST"])
def api_change(cid):
    if cid not in COMPANIES:
        return jsonify(code=40401, msg="企业不存在"), 404
    c = COMPANIES[cid]
    c["register_capital"] = c["register_capital"]  # 占位：真实场景为爬虫写入新数据
    # 1.爬虫抓取变更 -> 2.Kafka分发 -> 3.更新MySQL/图库(已同步) -> 4.删除脏缓存 -> 5.下次访问自动预热
    publish("company-change", dict(company_id=cid, field="register_capital",
                                   value=c["register_capital"], source="爬虫增量抓取"))
    R.delete(f"qcc:company:base:{cid}", f"qcc:graph:penetrate:{cid}",
             f"qcc:graph:controller:{cid}", f"qcc:graph:group:{cid}")
    return jsonify(code=0, msg=f"已触发企业【{c['company_name']}】变更流程：Kafka分发 -> 更新台账 -> 删除脏缓存 -> 雷达推送")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
