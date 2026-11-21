// 缓存策略表：按「这份数据多久会变、变了后果多严重」分类，而不是所有接口一个 TTL。
//
// 判断依据：
//   - 内容由不可变标识决定（sha / id）→ 可以长缓存，变了也是新 key
//   - 用户会主动改 → 短 TTL + 写操作立即失效
//   - 影响钱的结论 → 不缓存或极短，宁可多请求一次
//
// 所有 TTL 都是"最多可信多久"，不是"多久后才刷新"：
// 到点就重新请求，读不到缓存时静默回源，用户无感。

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const TTL = {
  // 原件页图：内容由「文档 sha + 页码」唯一确定，永不变更。
  // 0 = 不按时间过期，只靠 build 版本线和 LRU 管。
  pageImage: 0,

  // 解析产物（每笔交易的行明细 / 原件正文）：
  // 只有重新解析才会变，半个月足够；重新解析时会被 dropCase 主动清掉。
  docRows: 15 * DAY,
  docText: 15 * DAY,

  // 核对页主数据：用户会增删交易、改归属，缓存要短，
  // 并且每次写操作后主动失效，不能靠 TTL 兜底。
  caseView: 60 * 1000,

  // 客户档案列表：新建/删除不频繁，5 分钟够用。
  clientList: 5 * MIN,

  // 客户详情：偶尔变（名称、归属），10 分钟。
  clientDetail: 10 * MIN,

  // 解析预设、渠道枚举这类几乎不变的字典：1 天。
  presets: DAY,

  // 任务列表 / 积分 / 当前用户：高频变化，原则不落盘。
  // 这里给一个极短值只用于同一渲染周期内去重，不写 IndexedDB。
  volatile: 5 * 1000,
};

// 落盘（写 IndexedDB）的白名单：只有"值得跨刷新复用"的才写。
// 高频变化的写盘只会让 LRU 变脏，还会拖慢淘汰。
export const PERSIST = {
  pageImage: true,
  docRows: true,
  docText: true,
  caseView: false,
  clientList: true,
  clientDetail: true,
  presets: true,
  volatile: false,
};

/** 统一的 key 命名：前缀即失效粒度，前缀越短影响越大。 */
export const KEY = {
  page: (sha, page) => `page:${sha || "nosha"}:${page}`,
  docRows: (cid, did) => `rows:${cid}:${did}`,
  docText: (cid, did) => `text:${cid}:${did}`,
  caseView: (cid, sig) => `case:${cid}:${sig}`,
  clientList: (sig) => `clients:${sig}`,
  clientDetail: (cid) => `client:${cid}`,
  presets: () => "presets",
};

/** 某个客户的解析产物前缀：重新解析 / 删除客户时整片清掉。 */
export const docPrefix = (cid) => `rows:${cid}:`;
export const textPrefix = (cid) => `text:${cid}:`;
/** 某个客户的全部缓存前缀（删除客户时用）。 */
export const casePrefix = (cid) => `case:${cid}`;
