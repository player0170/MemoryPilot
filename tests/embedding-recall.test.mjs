import assert from 'node:assert/strict';
import { runRecall as runRecallV32 } from '../src/recall-v32.js';
import { runRecall as runRecallV34 } from '../src/recall-v34.js';
import {
  normalizeEmbeddingCfg, cosineSimilarity, l2normalize, memoryEmbeddingText, vectorCacheKey,
  embedTexts, getMemoryVectors, clearVectorCache,
} from '../src/embedding.js';

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

// ===== 纯函数 =====
{
  const cfg = normalizeEmbeddingCfg({ enabled: true, mode: 'nonsense', url: 'https://x.test/v1/embeddings/', threshold: 2, weight: -1 });
  assert.equal(cfg.mode, 'hybrid', '非法 mode 应回落 hybrid');
  assert.equal(cfg.url, 'https://x.test/v1', 'URL 应去掉尾部 /embeddings 与斜杠');
  assert.equal(cfg.threshold, 1);
  assert.equal(cfg.weight, 0);
  assert.equal(normalizeEmbeddingCfg({}).enabled, true, '默认开启向量召回');
  assert.equal(normalizeEmbeddingCfg({ enabled: false }).enabled, false, '显式关闭应保留');
  assert.deepEqual(normalizeEmbeddingCfg({ models: ['a', ' b ', '', 'a', null] }).models, ['a', 'b'], '模型列表去空去重');

  const a = l2normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(a[0], a[1]) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-6);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0, '维度不一致返回 0');

  const m1 = { event: 'A', summary: 'B', primaryKeywords: ['k'] };
  const m2 = { event: 'A', summary: 'B 改', primaryKeywords: ['k'] };
  assert.notEqual(vectorCacheKey(cfg, memoryEmbeddingText(m1)), vectorCacheKey(cfg, memoryEmbeddingText(m2)), '文本变化 → 缓存 key 变化');
  assert.notEqual(vectorCacheKey({ ...cfg, model: 'a' }, 'x'), vectorCacheKey({ ...cfg, model: 'b' }, 'x'), '模型变化 → 缓存 key 变化');
}

// ===== embedTexts：请求格式 / 顺序 / 错误 =====
{
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    const n = captured.body.input.length;
    // 故意乱序返回，检查按 index 重排
    const data = Array.from({ length: n }, (_, i) => ({ index: n - 1 - i, embedding: [n - 1 - i, 1] }));
    return { ok: true, json: async () => ({ data }) };
  };
  const cfg = { enabled: true, mode: 'hybrid', url: 'https://x.test/v1', key: 'sk', model: 'emb-8b', dimensions: 2 };
  const vecs = await embedTexts(['a', 'b', 'c'], cfg, { fetchImpl });
  assert.equal(captured.url, 'https://x.test/v1/embeddings');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk');
  assert.equal(captured.body.model, 'emb-8b');
  assert.equal(captured.body.dimensions, 2);
  assert.deepEqual(captured.body.input, ['a', 'b', 'c']);
  assert.equal(vecs.length, 3);
  assert.ok(Math.abs(vecs[0][0] - 0) < 1e-6 && Math.abs(vecs[2][0] - 2 / Math.hypot(2, 1)) < 1e-6, '应按 index 重排并归一化');

  await assert.rejects(
    embedTexts(['a'], cfg, { fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key' }) }),
    /HTTP 401/,
  );
}

// ===== getMemoryVectors：缓存命中、分批、失败回退 =====
{
  await clearVectorCache();
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    const input = JSON.parse(init.body).input;
    return { ok: true, json: async () => ({ data: input.map((t, i) => ({ index: i, embedding: [t.length, 1] })) }) };
  };
  const cfg = { enabled: true, mode: 'hybrid', url: 'https://x.test/v1', model: 'm', batchSize: 2 };
  const mems = [
    { id: 'a', event: 'e1', summary: 's1' },
    { id: 'b', event: 'e2', summary: 's22' },
    { id: 'c', event: 'e3', summary: 's333' },
  ];
  const first = await getMemoryVectors(mems, cfg, { fetchImpl });
  assert.equal(first.vectors.size, 3);
  assert.equal(first.computed, 3);
  assert.equal(calls, 2, 'batchSize=2 → 3 条分 2 批');
  const second = await getMemoryVectors(mems, cfg, { fetchImpl });
  assert.equal(second.cached, 3, '第二次应全部命中缓存');
  assert.equal(calls, 2, '命中缓存不再请求');

  const failing = await getMemoryVectors([...mems, { id: 'd', event: 'new', summary: 'x' }], cfg, {
    fetchImpl: async () => { throw new Error('boom'); },
  });
  assert.equal(failing.cached, 3);
  assert.equal(failing.failed, 1);
  assert.ok(failing.error, '失败需要上报 error 但不抛出');
  assert.equal(failing.vectors.size, 3, '已缓存的向量仍然可用');
}

// ===== 召回集成 =====
// 用 2 维“玩具向量”模拟 embedding：文本里含「旅行」→ [1,0]，含「厨房」→ [0,1]，否则 [0.7,0.7]
const toyEmbed = (text) => {
  if (/旅行|旅游|出游/.test(text)) return [1, 0];
  if (/厨房|做饭/.test(text)) return [0, 1];
  return [0.7, 0.7];
};

const memories = [
  { id: 'kw-only', source: 'manual', event: '月光约定', summary: '月光下的旧车站约定仍然有效。', priority: 'medium', primaryKeywords: ['月光'], timestamp: 1 },
  { id: 'vec-only', source: 'manual', event: '出游计划', summary: '两人商量过要一起出游，去海边看日落。', priority: 'medium', primaryKeywords: ['海边日落'], timestamp: 2 },
  { id: 'no-kw', source: 'manual', event: '旅游攻略', summary: '她收藏了一份详细的旅游攻略。', priority: 'medium', primaryKeywords: [], timestamp: 3 },
  { id: 'unrelated', source: 'manual', event: '厨房事故', summary: '上周在厨房做饭时打翻了锅。', priority: 'medium', primaryKeywords: ['厨房'], timestamp: 4 },
  { id: 'pinned', source: 'manual', event: '核心设定', summary: '两人是青梅竹马。', priority: 'high', primaryKeywords: ['青梅竹马'], timestamp: 5 },
];

async function settle(runRecall, chatMetadata) {
  runRecall();
  for (let i = 0; i < 200 && chatMetadata.variables.mp_recall_ctx === undefined; i += 1) {
    await new Promise(r => setImmediate(r));
  }
}

async function execute(runRecall, { embedding = null, fetchImpl = null, chatText = '今晚在月光下谈谈旅行计划。' } = {}) {
  const chatMetadata = { extensions: { MemoryPilot: { turnCounter: 0, stickyState: {} } }, variables: {} };
  const _global = {};
  if (embedding) _global.mp_embedding_config = embedding;
  const context = {
    chatId: 'embedding-regression',
    name2: 'character',
    chat: [{ is_user: true, mes: chatText }],
    chatMetadata,
    extensionSettings: { MemoryPilot: { _global } },
    saveSettingsDebounced() {},
  };
  const scopeKey = 'embedding-regression::character';
  const storage = new MemoryStorage({
    mp_active_chat: scopeKey,
    mp_memories: JSON.stringify(memories),
    mp_recall_settings: JSON.stringify({ every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6, animaDedupe: false, xiaobaixDedupe: false }),
  });
  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.TavernHelper = undefined;
  const originalFetch = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb, delay, ...args) => originalSetTimeout(cb, Math.min(Number(delay) || 0, 1), ...args);
  try {
    await settle(runRecall, chatMetadata);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = originalFetch;
  }
  const snapRaw = storage.getItem('mp_recall_snapshot_' + scopeKey);
  return {
    pin: chatMetadata.variables.mp_recall_pin || '',
    ctx: chatMetadata.variables.mp_recall_ctx || '',
    lines: (chatMetadata.variables.mp_recall_ctx || '').split('\n').filter(Boolean),
    snapshot: snapRaw ? JSON.parse(snapRaw) : null,
  };
}

const toyFetch = async (url, init) => {
  const input = JSON.parse(init.body).input;
  return { ok: true, json: async () => ({ data: input.map((t, i) => ({ index: i, embedding: toyEmbed(t) })) }) };
};
const failingFetch = async () => { throw new Error('network down'); };
const EMB = { enabled: true, mode: 'hybrid', url: 'https://x.test/v1', key: 'k', model: 'toy', threshold: 0.9, weight: 0.35 };

for (const [version, runRecall] of [['v32', runRecallV32], ['v34', runRecallV34]]) {
  await clearVectorCache();

  // 1. 未开启：纯关键词，行为与旧版一致
  const keyword = await execute(runRecall, { fetchImpl: failingFetch });
  assert.deepEqual(keyword.lines, ['[月光约定] 月光下的旧车站约定仍然有效。'], `${version}: 未开启 Embedding 时只应按关键词召回`);
  assert.equal(keyword.snapshot.embedding.mode, 'keyword');
  assert.equal(keyword.snapshot.embedding.active, false);

  // 2. hybrid：关键词命中的保留，关键词没命中但相似度≥阈值的也能召回（含没有主关键词的记忆），不相关的不召回
  const hybrid = await execute(runRecall, { embedding: EMB, fetchImpl: toyFetch });
  const hybridEvents = hybrid.lines.map(l => l.match(/^\[(.+?)\]/)[1]);
  assert.ok(hybridEvents.includes('月光约定'), `${version}: hybrid 应保留关键词命中`);
  assert.ok(hybridEvents.includes('出游计划'), `${version}: hybrid 应按向量召回同义改写（出游 vs 旅行）`);
  assert.ok(hybridEvents.includes('旅游攻略'), `${version}: hybrid 应允许无主关键词记忆由向量召回`);
  assert.ok(!hybridEvents.includes('厨房事故'), `${version}: hybrid 不应召回不相关记忆`);
  assert.ok(!hybridEvents.includes('核心设定'), `${version}: 常驻不进 ctx`);
  assert.equal(hybrid.pin, '[核心设定] 两人是青梅竹马。');
  assert.equal(hybrid.snapshot.embedding.mode, 'hybrid');
  assert.equal(hybrid.snapshot.embedding.active, true);
  assert.equal(hybrid.snapshot.embedding.computed, 4, `${version}: 首轮应为 4 条非常驻记忆计算向量`);
  const vecReason = hybrid.snapshot.triggered.find(t => t.event === '出游计划')?.reason || '';
  assert.match(vecReason, /向量相似度/, `${version}: 监控原因应包含向量相似度`);
  assert.match(vecReason, /由向量召回/, `${version}: 关键词未命中时应标注由向量召回`);

  // 3. 第二轮：记忆向量命中缓存，不再重复 embedding 记忆
  const hybrid2 = await execute(runRecall, { embedding: EMB, fetchImpl: toyFetch });
  assert.equal(hybrid2.snapshot.embedding.cached, 4, `${version}: 第二轮记忆向量应全部命中缓存`);
  assert.equal(hybrid2.snapshot.embedding.computed, 0);

  // 4. vector：只看相似度——「月光约定」无相关向量不召回；「出游计划」「旅游攻略」召回
  const vector = await execute(runRecall, { embedding: { ...EMB, mode: 'vector' }, fetchImpl: toyFetch });
  const vectorEvents = vector.lines.map(l => l.match(/^\[(.+?)\]/)[1]);
  assert.deepEqual(vectorEvents.sort(), ['出游计划', '旅游攻略'], `${version}: vector 模式只按相似度召回`);
  assert.equal(vector.snapshot.embedding.mode, 'vector');

  // 5. 接口挂了：自动回退关键词，结果与未开启完全一致，并在监控里留下说明
  await clearVectorCache();
  const fallback = await execute(runRecall, { embedding: { ...EMB, mode: 'vector' }, fetchImpl: failingFetch });
  assert.deepEqual(fallback.lines, keyword.lines, `${version}: Embedding 失败应完全回退关键词召回`);
  assert.equal(fallback.snapshot.embedding.mode, 'keyword');
  assert.equal(fallback.snapshot.embedding.wantMode, 'vector');
  assert.match(fallback.snapshot.embedding.note, /回退关键词/, `${version}: 回退时监控应有说明`);

  // 6. 开启但模式选 keyword：不发请求
  let requests = 0;
  const kwMode = await execute(runRecall, { embedding: { ...EMB, mode: 'keyword' }, fetchImpl: async (...a) => { requests += 1; return toyFetch(...a); } });
  assert.equal(requests, 0, `${version}: keyword 模式不应调用 Embedding 接口`);
  assert.deepEqual(kwMode.lines, keyword.lines);

  // 7. 未配置模型名：不发请求，回退关键词
  const noModel = await execute(runRecall, { embedding: { ...EMB, model: '' }, fetchImpl: async (...a) => { requests += 1; return toyFetch(...a); } });
  assert.equal(requests, 0, `${version}: 配置不完整不应调用接口`);
  assert.deepEqual(noModel.lines, keyword.lines);
  assert.match(noModel.snapshot.embedding.note, /未配置完整/);
}

console.log('embedding-recall regression passed');
