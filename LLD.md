# 企业征信查询平台 系统详细设计说明书（LLD）

> **文档版本**：v1.0
> **文档状态**：基线（Baseline）
> **关联文档**：[SRS 需求规格说明书](./SRS.md) · [HLD 系统概要设计说明书](./HLD.md)
> **编写说明**：本文档为落地级设计，包含完整库表结构、ES 索引、Nebula 图库、Redis 全量 Key 规范，以及股权穿透、搜索、监控雷达、限流计费等核心模块的完整代码逻辑。可直接用于编码实现、面试背题与简历项目。

---

## 修订记录

| 版本 | 日期 | 修订人 | 说明 |
| --- | --- | --- | --- |
| v1.0 | 2026-10-29 | 架构组 | 首版基线，含全量表结构 + Redis 规范 + 核心代码逻辑 |

---

## 目录

1. 数据库详细设计（MySQL）
2. ES 索引详细设计
3. 图数据库 Nebula 详细设计
4. Redis 详细设计（全量 Key 规范）
5. 核心模块详细逻辑设计
   - 5.1 股权穿透（离线预计算 + 实时查询）
   - 5.2 企业搜索（ES）
   - 5.3 监控雷达（订阅推送）
   - 5.4 限流与计费
   - 5.5 缓存一致性与降级
6. 接口契约示例

---

## 1. 数据库详细设计（MySQL）

> 采用 **TiDB 分库分表**，按 `company_id` 取模分片；以下为企业域核心表，字符集 `utf8mb4`。

### 1.1 企业主体表 `company_info`

```sql
CREATE TABLE company_info (
    company_id      BIGINT       PRIMARY KEY COMMENT '企业唯一ID',
    credit_code     VARCHAR(30)  UNIQUE  COMMENT '统一社会信用代码',
    company_name    VARCHAR(200) NOT NULL COMMENT '企业名称',
    legal_person    VARCHAR(50)  COMMENT '法人',
    register_capital VARCHAR(50) COMMENT '注册资本',
    establish_time  DATE         COMMENT '成立日期',
    company_status  TINYINT      COMMENT '1存续 2注销 3吊销',
    industry        VARCHAR(50)  COMMENT '行业',
    province        VARCHAR(20)  COMMENT '省',
    city            VARCHAR(20)  COMMENT '市',
    address         TEXT         COMMENT '注册地址',
    crawl_time      DATETIME     COMMENT '抓取时间',
    update_time     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_name (company_name),
    INDEX idx_status (company_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='企业主体表';
```

### 1.2 股东投资表 `company_invest`

```sql
CREATE TABLE company_invest (
    id              BIGINT      PRIMARY KEY,
    company_id      BIGINT      NOT NULL COMMENT '被投资公司ID',
    invest_obj_name VARCHAR(200) COMMENT '投资对象名称',
    invest_obj_id   BIGINT      COMMENT '投资对象ID（企业/自然人）',
    share_ratio     DECIMAL(8,4) COMMENT '持股比例(%)',
    invest_amount   VARCHAR(50) COMMENT '认缴出资额',
    invest_type     TINYINT     COMMENT '1企业 2自然人',
    create_time     DATETIME    COMMENT '录入时间',
    INDEX idx_company (company_id),
    INDEX idx_obj (invest_obj_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='股东投资表';
```

### 1.3 高管任职表 `company_staff`

```sql
CREATE TABLE company_staff (
    id          BIGINT   PRIMARY KEY,
    company_id  BIGINT   NOT NULL COMMENT '企业ID',
    person_name VARCHAR(50)  COMMENT '姓名',
    position    VARCHAR(50)  COMMENT '职位',
    entry_time  DATE     COMMENT '任职开始',
    exit_time   DATE     COMMENT '任职结束',
    INDEX idx_company (company_id),
    INDEX idx_person (person_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='高管任职表';
```

### 1.4 司法风险表 `company_lawsuit`

```sql
CREATE TABLE company_lawsuit (
    id           BIGINT       PRIMARY KEY,
    company_id   BIGINT       NOT NULL COMMENT '企业ID',
    case_title   VARCHAR(255) COMMENT '案由/标题',
    case_type    VARCHAR(50)  COMMENT '案件类型',
    court_name   VARCHAR(100) COMMENT '法院',
    publish_date DATE         COMMENT '发布日期',
    case_status  TINYINT      COMMENT '1审理 2判决 3执行',
    INDEX idx_company (company_id),
    INDEX idx_date (publish_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='司法风险表';
```

### 1.5 用户订阅雷达表 `user_monitor`

```sql
CREATE TABLE user_monitor (
    id           BIGINT      PRIMARY KEY,
    user_id      BIGINT      NOT NULL COMMENT '用户ID',
    company_id   BIGINT      NOT NULL COMMENT '订阅企业ID',
    notify_type  INT         COMMENT '1变更 2诉讼 3新增专利（位标记）',
    create_time  DATETIME    COMMENT '订阅时间',
    UNIQUE KEY uk_user_company (user_id, company_id),
    INDEX idx_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户订阅雷达表';
```

### 1.6 API 调用计费表 `api_call_log`

```sql
CREATE TABLE api_call_log (
    id          BIGINT      PRIMARY KEY,
    user_id     BIGINT      NOT NULL COMMENT '调用方ID',
    api_path    VARCHAR(100) COMMENT '接口路径',
    call_time   DATETIME    COMMENT '调用时间',
    status      TINYINT     COMMENT '1成功 0失败',
    ip          VARCHAR(50) COMMENT '来源IP',
    INDEX idx_user_time (user_id, call_time),
    INDEX idx_time (call_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='API调用计费表';
```

### 1.7 用户与会员表（补充）

```sql
CREATE TABLE `user` (
    user_id     BIGINT      PRIMARY KEY,
    phone       VARCHAR(20) COMMENT '手机号(脱敏存储)',
    role        TINYINT     COMMENT '1普通 2VIP 3企业 4API 5ADMIN',
    vip_expire  DATETIME    COMMENT '会员到期时间',
    create_time DATETIME
) COMMENT='用户表';

CREATE TABLE member_plan (
    plan_id     INT      PRIMARY KEY,
    plan_name   VARCHAR(50) COMMENT '套餐名',
    quota_day   INT     COMMENT '每日API额度',
    price       DECIMAL(10,2)
) COMMENT='会员套餐表';
```

---

## 2. ES 索引详细设计

**索引名**：`company_search`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| company_id | long | 企业ID（keyword 存储） |
| company_name | text + ik_max_word | 企业名，分词检索 |
| company_name_pinyin | text | 拼音，智能纠错 |
| credit_code | keyword | 信用代码，精确匹配 |
| legal_person | text | 法人 |
| industry | keyword | 行业筛选 |
| province / city | keyword | 地区筛选 |
| company_status | integer | 状态筛选 |
| establish_time | date | 时间筛选 |

**能力**：分词检索、拼音纠错（`pinyin` 插件）、模糊匹配（`match` + `fuzziness`）、高亮（`highlight`）、多条件 `bool` 筛选。

---

## 3. 图数据库 Nebula 详细设计

### 3.1 节点（Vertex / Tag）

```sql
-- 企业节点
CREATE TAG Company (name string, industry string, status int);
-- 自然人节点
CREATE TAG Person (name string, id_card string);
```

### 3.2 边（Edge / EdgeType）

```sql
-- 持股关系：src 持有 dst 股份
CREATE EDGE HOLD_SHARE (ratio double, amount string);
-- 任职关系
CREATE EDGE WORK_AT (position string);
-- 对外投资
CREATE EDGE INVEST (amount string);
-- 分支机构
CREATE EDGE BRANCH (type int);
```

**示例查询（向下穿透找子公司）**：

```sql
MATCH (c:Company)-[e:HOLD_SHARE*1..5]->(sub:Company)
WHERE id(c) == "10000001" AND e.ratio >= 20
RETURN sub.name, e.ratio;
```

---

## 4. Redis 详细设计（全量 Key 规范）

> 统一前缀 `qcc:`，采用 `业务:子域:维度:{id}` 三段式命名。

### 4.1 企业基础缓存

| Key | 类型 | 说明 | TTL |
| --- | --- | --- | --- |
| `qcc:company:base:{cid}` | Hash | 企业主页聚合数据 | 动态（热5min/冷7d） |
| `qcc:company:risk:{cid}` | String(JSON) | 风险统计摘要 | 10min |

### 4.2 图谱预计算缓存（核心）

| Key | 类型 | 说明 |
| --- | --- | --- |
| `qcc:graph:penetrate:{cid}` | String(JSON) | 完整股权穿透树 |
| `qcc:graph:controller:{cid}` | String(JSON) | 最终实控人 |
| `qcc:graph:group:{cid}` | String(JSON) | 企业集团架构 |
| `qcc:graph:path:{cid1}:{cid2}` | String(JSON) | 两企业关联最短路径 |

### 4.3 热搜与排行

| Key | 类型 | 说明 |
| --- | --- | --- |
| `qcc:hot:search` | ZSet | 企业热度排行（score=热度） |

### 4.4 限流与计费

| Key | 类型 | 说明 |
| --- | --- | --- |
| `qcc:api:quota:{uid}:{date}` | String(INCR) | 每日 API 调用次数 |
| `qcc:rate:limit:{ip}` | ZSet | 滑动窗口限流（member=时间戳） |

### 4.5 变更标记缓存

| Key | 类型 | 说明 |
| --- | --- | --- |
| `qcc:dirty:company:{cid}` | String | 企业已变更标记，触发缓存淘汰 |

---

## 5. 核心模块详细逻辑设计

### 5.1 股权穿透（核心壁垒）

> **设计铁律**：用户查询**绝不实时递归**数据库/图库。所有穿透结果由离线（Spark 全量）+ 增量（单主体重算）预计算，写入 Redis，查询只读缓存。

#### 5.1.1 离线预计算（Spark 每日全量）

```java
// 每日凌晨跑批：基于 company_invest 全量重算股权穿透树
public class EquityPenetrationJob {
    public static void main(String[] args) {
        SparkSession spark = SparkSession.builder()
                .appName("equity-penetration").getOrCreate();

        // 1. 读取全量持股关系 (company_id -> invest_obj_id, ratio)
        Dataset<Row> edges = spark.read().jdbc(mysqlUrl, "company_invest", props);

        // 2. 构建有向图，计算每个企业的向上穿透链与加权控制比例
        //    控制比例 = Π(每层持股比例)，实控人 = 控制比例最高的自然人
        Map<Long, PenetrationTree> trees = buildPenetration(edges);

        // 3. 结果写 Redis（JSON 序列化）
        trees.forEach((cid, tree) -> {
            redis.set("qcc:graph:penetrate:" + cid, toJson(tree), TTL_7D);
            redis.set("qcc:graph:controller:" + cid, toJson(tree.controller), TTL_7D);
        });
    }

    // 加权控制权计算：沿持股链累乘
    static double controlRatio(List<Edge> chain) {
        return chain.stream().mapToDouble(e -> e.ratio / 100.0).reduce(1.0, (a, b) -> a * b);
    }
}
```

#### 5.1.2 增量重算（企业变更触发）

```java
// 监听 Kafka 企业变更事件，单主体局部重算
@KafkaListener(topics = "company-change")
public void onCompanyChange(CompanyChangeEvent ev) {
    long cid = ev.getCompanyId();
    // 仅重算该主体及其上游关联方，避免全量
    PenetrationTree tree = graphService.recompute(cid);
    redis.set("qcc:graph:penetrate:" + cid, toJson(tree), TTL_7D);
    redis.set("qcc:graph:controller:" + cid, toJson(tree.controller), TTL_7D);
    redis.set("qcc:dirty:company:" + cid, "1", TTL_1H); // 标记变更
}
```

#### 5.1.3 实时查询（只读缓存 + 降级）

```java
public PenetrationTree getPenetration(long cid) {
    String key = "qcc:graph:penetrate:" + cid;
    String json = redis.get(key);
    if (json != null) return fromJson(json, PenetrationTree.class);

    // 未命中：回源图库（超时保护）
    try {
        PenetrationTree tree = graphService.queryWithTimeout(cid, 500, TimeUnit.MILLISECONDS);
        redis.set(key, toJson(tree), TTL_5MIN);
        return tree;
    } catch (TimeoutException e) {
        // 降级：只返回直接股东，关闭多层穿透
        return graphService.directHoldersOnly(cid);
    }
}
```

#### 5.1.4 穿透树结构（返回模型）

```json
{
  "companyId": 10000001,
  "companyName": "示例科技集团有限公司",
  "controller": { "type": "PERSON", "name": "张三", "controlRatio": 0.412 },
  "children": [
    {
      "companyId": 10000002, "name": "子公司A", "ratio": 0.65,
      "children": [ { "companyId": 10000003, "name": "孙公司B", "ratio": 0.8, "children": [] } ]
    }
  ]
}
```

---

### 5.2 企业搜索（ES 唯一入口）

```java
public List<Long> searchCompany(String keyword, SearchFilter filter) {
    BoolQueryBuilder qb = QueryBuilders.boolQuery();
    // 分词 + 拼音纠错 + 模糊
    qb.should(QueryBuilders.matchQuery("company_name", keyword).boost(2.0f));
    qb.should(QueryBuilders.matchQuery("company_name_pinyin", keyword).fuzziness("AUTO"));
    qb.should(QueryBuilders.matchQuery("legal_person", keyword));
    // 筛选
    if (filter.getIndustry() != null) qb.filter(termQuery("industry", filter.getIndustry()));
    if (filter.getStatus() != null)   qb.filter(termQuery("company_status", filter.getStatus()));

    SearchResponse resp = esClient.prepareSearch("company_search")
            .setQuery(qb).setFrom(0).setSize(20)
            .highlighter(hl("company_name")).get();
    // 提取 company_id 列表返回
    return extractIds(resp);
}
```

---

### 5.3 监控雷达（订阅推送）

```java
// 企业发生变更 -> 查订阅用户 -> 推送
@KafkaListener(topics = "company-change")
public void onChange(CompanyChangeEvent ev) {
    List<Long> users = monitorMapper.selectUserIdsByCompany(ev.getCompanyId());
    for (Long uid : users) {
        NotifyMessage msg = NotifyMessage.build(ev, uid);
        if (matchNotifyType(uid, ev.getType())) {
            messageService.push(uid, msg); // App/短信/站内
        }
    }
}
```

---

### 5.4 限流与计费

```java
// 滑动窗口限流（IP 维度）
public boolean tryAcquire(String ip, int limit, int windowSec) {
    String key = "qcc:rate:limit:" + ip;
    long now = System.currentTimeMillis();
    long min = now - windowSec * 1000;
    jedis.zremrangeByScore(key, 0, min);              // 删除窗口外
    long count = jedis.zcard(key);
    if (count >= limit) return false;                 // 限流
    jedis.zadd(key, now, String.valueOf(now));
    jedis.expire(key, windowSec);
    return true;
}

// API 每日配额计费
public void countApi(Long uid, String date) {
    jedis.incr("qcc:api:quota:" + uid + ":" + date);
    jedis.expire("qcc:api:quota:" + uid + ":" + date, 86400 * 2);
}
```

---

### 5.5 缓存一致性与降级

**删缓存 + 懒加载一致性方案**（见 HLD 4.2）：

```java
// 数据更新：先更新 DB/图库，再删缓存，下次访问自动预热
@Transactional
public void updateCompany(Company c) {
    companyMapper.update(c);                 // 1. 更新 MySQL
    graphService.upsertVertex(c);            // 2. 更新图库
    redis.del("qcc:company:base:" + c.getId()); // 3. 删脏缓存
    kafkaTemplate.send("company-change", new CompanyChangeEvent(c.getId()));
}
```

**缓存穿透防护**：空值缓存（短 TTL）+ 布隆过滤器（企业 ID 白名单）。

```java
public CompanyBase getBase(long cid) {
    if (!bloomFilter.mightContain(cid)) return null; // 布隆过滤器拦截非法ID
    String json = redis.get("qcc:company:base:" + cid);
    if (json != null) {
        if (NULL_PLACEHOLDER.equals(json)) return null; // 空值缓存
        return fromJson(json);
    }
    CompanyBase base = companyMapper.select(cid);
    redis.set(key, base == null ? NULL_PLACEHOLDER : toJson(base), base == null ? 60 : dynamicTtl(cid));
    return base;
}
```

---

## 6. 接口契约示例

### 6.1 企业主页查询

```
GET /api/company/{companyId}
Response 200:
{
  "companyId": 10000001,
  "companyName": "示例科技集团有限公司",
  "legalPerson": "张三",
  "registerCapital": "5000万人民币",
  "establishTime": "2010-01-01",
  "companyStatus": 1,
  "riskSummary": { "lawsuit": 3, "dishonest": 0, "abnormal": 1 }
}
```

### 6.2 股权穿透查询

```
GET /api/company/{companyId}/penetration
Response 200: { 见 5.1.4 穿透树结构 }
```

### 6.3 开放 API 统一错误码

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| 40001 | 参数错误 |
| 40101 | 鉴权失败 |
| 42901 | 限流/配额不足 |
| 50001 | 服务内部错误 |

---

> **结论**：本 LLD 给出了从存储（MySQL/ES/Nebula/Redis）到核心模块（股权穿透、搜索、监控、限流、一致性）的落地级设计，配套可运行的代码骨架，可直接进入编码阶段。
