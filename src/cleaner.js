// MemoryPilot 文本过滤（统一规则版）
//
// 为什么要有这个文件：
// 文本过滤的 normalizeCleaner / applyCleaner 原来在 panel / recall-v32 / recall-v34 /
// summary-service 里各写了一份，而且分成「删除标签」「删除整行前缀」「正则」三个栏目，
// 用户很难分清先后顺序。现在合并成一个 `rules` 列表，每行一条规则：
//   - 纯英文（字母开头，只含字母 / 数字 / _ / -，如 think、details）
//     → 当作标签名，删除 <tag ...>…</tag> 整块（大小写不敏感，允许标签带属性）；
//   - 其它任何内容 → 直接当作正则使用（按 gim 执行，命中的内容替换为空格）。
// 规则按填写顺序执行，所有规则跑完后会再整体跑一遍，处理删掉标签之后才暴露出来的内容。
// 每条规则彼此独立：某一条编译失败或正文里没有可匹配内容，只影响它自己。
//
// 旧版配置（blockTags / linePrefixes / regexRules）在 normalizeCleaner 中自动迁移：
// 标签原样保留，整行前缀转换为 ^\s*前缀.*$ 正则，正则原样保留。

export const TAG_RULE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const DEF_CLEANER = Object.freeze({
  rules: Object.freeze([
    'think',
    'details',
    String.raw`^\s*affinity_change:.*$`,
    String.raw`^\s*mood_change:.*$`,
    String.raw`^\s*state_update:.*$`,
    '^____+$',
  ]),
  cleanForRecall: true,
  cleanForBatch: true,
});

const escapeRegExp = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normList = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map(x => String(x ?? '').trim()).filter(Boolean)));

// 旧版「删除指定开头的整行」→ 等价正则
export const prefixToRule = (prefix) => String.raw`^\s*` + escapeRegExp(String(prefix ?? '').trim()) + '.*$';

// 判断一条规则是「标签」还是「正则」
export const ruleKind = (rule) => (TAG_RULE_RE.test(String(rule ?? '').trim()) ? 'tag' : 'regex');

// 把一条规则编译成 RegExp；编译失败返回 null
export const compileRule = (rule) => {
  const r = String(rule ?? '').trim();
  if (!r) return null;
  try {
    if (ruleKind(r) === 'tag') return new RegExp('<\\s*' + r + '\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*' + r + '\\s*>', 'gi');
    return new RegExp(r, 'gim');
  } catch {
    return null;
  }
};

export function normalizeCleaner(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  let rules;
  if (Array.isArray(src.rules)) {
    rules = normList(src.rules);
  } else if (Array.isArray(src.blockTags) || Array.isArray(src.linePrefixes) || Array.isArray(src.regexRules)) {
    // 旧版三栏配置：按原来的执行顺序（正则 → 标签 → 整行）合并成一个列表；缺失的栏目补旧版默认值
    const regexRules = Array.isArray(src.regexRules) ? src.regexRules : ['^____+$'];
    const blockTags = Array.isArray(src.blockTags) ? src.blockTags : ['think', 'details'];
    const linePrefixes = Array.isArray(src.linePrefixes) ? src.linePrefixes : ['affinity_change:', 'mood_change:', 'state_update:'];
    rules = normList([...regexRules, ...blockTags, ...linePrefixes.map(prefixToRule)]);
  } else {
    rules = [...DEF_CLEANER.rules];
  }
  return {
    rules,
    cleanForRecall: src.cleanForRecall !== false,
    cleanForBatch: src.cleanForBatch !== false,
  };
}

export const newCleanerStats = () => ({ rules: {} });

// 列出无法编译的规则（只可能是正则），供监控 / 测试按钮提示
export const invalidCleanerRules = (cfg) => normalizeCleaner(cfg).rules.filter(rule => compileRule(rule) == null);

export function applyCleaner(input, cfg, stats = null) {
  let text = String(input ?? '');
  const conf = normalizeCleaner(cfg);
  const compiled = conf.rules.map(rule => ({ rule, re: compileRule(rule) })).filter(x => x.re);
  const bucket = stats && typeof stats === 'object' ? (stats.rules = stats.rules || {}) : null;
  const runAll = () => {
    for (const { rule, re } of compiled) {
      let hits = 0;
      try { text = text.replace(re, () => { hits++; return ' '; }); } catch {}
      if (bucket) bucket[rule] = (bucket[rule] || 0) + hits;
    }
  };
  runAll();
  // 再跑一遍：处理只有在标签删除之后才会暴露出来的内容（如 ^____+$）
  runAll();
  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
