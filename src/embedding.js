// MemoryPilot Embedding - 向量召回支持
// 接口：OpenAI 兼容 POST {base}/embeddings（Qwen3-Embedding、OpenAI、SiliconFlow 等均可）
// 配置：extensionSettings.MemoryPilot._global.mp_embedding_config（全局，跨聊天共用）
// 向量缓存：IndexedDB（key = 模型|维度|文本哈希，文本一变自动失效）；无 IndexedDB 时退化为内存缓存

export const EMBEDDING_CFG_KEY = 'mp_embedding_config';
const DB_NAME = 'MemoryPilotEmbeddings';
const DB_STORE = 'vectors';
const _EXT_NAME = 'MemoryPilot';

export const EMBEDDING_MODES = ['keyword', 'hybrid', 'vector'];

export const DEF_EMBEDDING_CFG = {
  enabled: true,           // 默认开启；未填模型名时 isEmbeddingReady 为 false，自动使用关键词召回
  mode: 'hybrid',          // keyword = 只用关键词；hybrid = 关键词 + 向量；vector = 只用向量
  url: 'https://api.openai.com/v1',
  key: '',
  model: '',
  models: [],              // 「拉取模型列表」得到的候选模型名，仅用于下拉展示
  dimensions: 0,           // 0 = 不传 dimensions 参数，使用模型默认维度
  threshold: 0.55,         // 余弦相似度达到该值即可在无关键词命中时召回
  weight: 0.35,            // hybrid 模式下向量分数所占比重
  queryChars: 1500,        // 每轮送去 embedding 的上下文字符数（取最近的一段）
  timeoutMs: 20000,
  batchSize: 16,
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);

export function normalizeEmbeddingBase(url) {
  return String(url ?? '').trim().replace(/\/+$/, '').replace(/\/embeddings$/i, '');
}

export function normalizeEmbeddingCfg(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : {};
  const mode = EMBEDDING_MODES.includes(src.mode) ? src.mode : DEF_EMBEDDING_CFG.mode;
  return {
    enabled: src.enabled !== false,
    mode,
    url: normalizeEmbeddingBase(src.url || DEF_EMBEDDING_CFG.url),
    key: String(src.key ?? '').trim(),
    model: String(src.model ?? '').trim(),
    models: Array.isArray(src.models) ? Array.from(new Set(src.models.map(m => String(m ?? '').trim()).filter(Boolean))) : [],
    dimensions: Math.max(0, Math.round(num(src.dimensions, DEF_EMBEDDING_CFG.dimensions))),
    threshold: clamp(num(src.threshold, DEF_EMBEDDING_CFG.threshold), 0, 1),
    weight: clamp(num(src.weight, DEF_EMBEDDING_CFG.weight), 0, 1),
    queryChars: clamp(Math.round(num(src.queryChars, DEF_EMBEDDING_CFG.queryChars)), 200, 8000),
    timeoutMs: clamp(Math.round(num(src.timeoutMs, DEF_EMBEDDING_CFG.timeoutMs)), 3000, 120000),
    batchSize: clamp(Math.round(num(src.batchSize, DEF_EMBEDDING_CFG.batchSize)), 1, 64),
  };
}

export function isEmbeddingReady(cfg) {
  const c = normalizeEmbeddingCfg(cfg);
  return c.enabled && c.mode !== 'keyword' && !!c.url && !!c.model;
}

function getGlobalStore(ctx, { create = true } = {}) {
  const c = ctx || globalThis.SillyTavern?.getContext?.();
  if (!c?.extensionSettings) return null;
  if (!create) return c.extensionSettings[_EXT_NAME]?._global || null;
  if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
  if (!c.extensionSettings[_EXT_NAME]._global) c.extensionSettings[_EXT_NAME]._global = {};
  return c.extensionSettings[_EXT_NAME]._global;
}

export function loadEmbeddingCfg(ctx) {
  try {
    // 只读不建：召回路径不应该在 extensionSettings 里凭空创建容器
    const store = getGlobalStore(ctx, { create: false });
    if (store && store[EMBEDDING_CFG_KEY] && typeof store[EMBEDDING_CFG_KEY] === 'object') {
      try { localStorage.setItem(EMBEDDING_CFG_KEY, JSON.stringify(store[EMBEDDING_CFG_KEY])); } catch {}
      return normalizeEmbeddingCfg(store[EMBEDDING_CFG_KEY]);
    }
  } catch {}
  try {
    const raw = localStorage.getItem(EMBEDDING_CFG_KEY);
    if (raw && raw.trim()) return normalizeEmbeddingCfg(JSON.parse(raw));
  } catch {}
  return normalizeEmbeddingCfg(DEF_EMBEDDING_CFG);
}

export function saveEmbeddingCfg(ctx, cfg) {
  const c = normalizeEmbeddingCfg(cfg);
  try { localStorage.setItem(EMBEDDING_CFG_KEY, JSON.stringify(c)); } catch {}
  const store = getGlobalStore(ctx);
  if (store) {
    store[EMBEDDING_CFG_KEY] = c;
    try { (ctx || globalThis.SillyTavern?.getContext?.())?.saveSettingsDebounced?.(); } catch {}
  }
  return c;
}

// ---------- 文本 / 哈希 ----------

export function memoryEmbeddingText(mem) {
  const event = String(mem?.event ?? '').trim();
  const summary = String(mem?.summary ?? '').trim();
  const kws = []
    .concat(Array.isArray(mem?.primaryKeywords) ? mem.primaryKeywords : (Array.isArray(mem?.keywords) ? mem.keywords : []))
    .concat(Array.isArray(mem?.entities) ? mem.entities : [])
    .map(k => String(k ?? '').trim()).filter(Boolean);
  const lines = [];
  if (event) lines.push(event);
  if (summary) lines.push(summary);
  if (kws.length) lines.push(`关键词：${Array.from(new Set(kws)).slice(0, 12).join('、')}`);
  return lines.join('\n');
}

export function hashText(text) {
  // FNV-1a 32bit ×2（不同种子）→ 16 位 hex，足够做缓存 key
  const s = String(text ?? '');
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c; h2 = Math.imul(h2, 0x27d4eb2f) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}

export function vectorCacheKey(cfg, text) {
  const c = normalizeEmbeddingCfg(cfg);
  return `${c.model}|${c.dimensions || 'd'}|${hashText(text)}`;
}

// ---------- 向量运算 ----------

export function l2normalize(vec) {
  const out = vec instanceof Float32Array ? vec : Float32Array.from(vec || []);
  let sum = 0;
  for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
  const n = Math.sqrt(sum);
  if (!n || !Number.isFinite(n)) return out;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return clamp(dot / Math.sqrt(na * nb), -1, 1);
}

// ---------- 远程调用 ----------

export async function embedTexts(texts, cfg, { signal, fetchImpl } = {}) {
  const c = normalizeEmbeddingCfg(cfg);
  const list = (Array.isArray(texts) ? texts : [texts]).map(t => String(t ?? ''));
  if (!list.length) return [];
  if (!c.url || !c.model) throw new Error('Embedding 接口 URL 或模型名未配置');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('当前环境没有 fetch');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => { try { controller.abort(); } catch {} }, c.timeoutMs) : null;
  if (signal && controller) {
    try { signal.addEventListener('abort', () => controller.abort(), { once: true }); } catch {}
  }
  const body = { model: c.model, input: list.map(t => (t.trim() ? t : ' ')) };
  if (c.dimensions > 0) body.dimensions = c.dimensions;
  try {
    const res = await doFetch(c.url + '/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: 'Bearer ' + c.key } : {}) },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${res.status}${detail ? ' ' + detail : ''}`);
    }
    const data = await res.json();
    const items = Array.isArray(data?.data) ? data.data.slice() : [];
    items.sort((x, y) => (Number(x?.index) || 0) - (Number(y?.index) || 0));
    if (items.length !== list.length) throw new Error(`接口返回 ${items.length} 条向量，期望 ${list.length} 条`);
    return items.map(it => {
      const emb = Array.isArray(it?.embedding) ? it.embedding : null;
      if (!emb || !emb.length) throw new Error('接口返回的 embedding 为空');
      return l2normalize(Float32Array.from(emb));
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- IndexedDB 缓存 ----------

let _dbPromise = null;
const _memoryFallback = new Map();

function hasIDB() {
  return typeof indexedDB !== 'undefined' && indexedDB && typeof indexedDB.open === 'function';
}

function openDB() {
  if (!hasIDB()) return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { console.warn('[MP] IndexedDB 打开失败，向量缓存退化为内存:', req.error); resolve(null); };
      req.onblocked = () => resolve(null);
    } catch (e) {
      console.warn('[MP] IndexedDB 不可用，向量缓存退化为内存:', e);
      resolve(null);
    }
  });
  return _dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetMany(keys) {
  const out = new Map();
  if (!keys.length) return out;
  const db = await openDB();
  if (!db) {
    for (const k of keys) if (_memoryFallback.has(k)) out.set(k, _memoryFallback.get(k));
    return out;
  }
  try {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const results = await Promise.all(keys.map(k => reqToPromise(store.get(k)).catch(() => null)));
    results.forEach((rec, i) => { if (rec && rec.vec) out.set(keys[i], rec.vec instanceof Float32Array ? rec.vec : Float32Array.from(rec.vec)); });
  } catch (e) {
    console.warn('[MP] 读取向量缓存失败:', e);
  }
  return out;
}

async function idbPutMany(records) {
  if (!records.length) return;
  const db = await openDB();
  if (!db) {
    for (const r of records) _memoryFallback.set(r.key, r.vec);
    return;
  }
  try {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    for (const r of records) store.put({ key: r.key, vec: r.vec, model: r.model, dim: r.vec.length, ts: Date.now() });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  } catch (e) {
    console.warn('[MP] 写入向量缓存失败:', e);
  }
}

export async function clearVectorCache() {
  _memoryFallback.clear();
  _queryCache.clear();
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  } catch (e) {
    console.warn('[MP] 清空向量缓存失败:', e);
  }
}

export async function countVectorCache() {
  const db = await openDB();
  if (!db) return _memoryFallback.size;
  try {
    const tx = db.transaction(DB_STORE, 'readonly');
    return Number(await reqToPromise(tx.objectStore(DB_STORE).count())) || 0;
  } catch {
    return 0;
  }
}

// ---------- 记忆向量 / 查询向量 ----------

/**
 * 为一批记忆取向量：命中缓存的直接返回，缺失的按 batchSize 分批调用接口并写回缓存。
 * 返回 { vectors: Map<memId, Float32Array>, cached, computed, failed, error }。
 * 任何一批失败都会记录 error，但已成功的部分仍然返回，调用方决定是否回退关键词。
 */
export async function getMemoryVectors(memories, cfg, { onProgress, maxNew = Infinity, signal, fetchImpl } = {}) {
  const c = normalizeEmbeddingCfg(cfg);
  const vectors = new Map();
  const stats = { vectors, cached: 0, computed: 0, failed: 0, error: null };
  const list = (Array.isArray(memories) ? memories : []).filter(m => m && m.id != null);
  if (!list.length) return stats;

  const entries = list.map(m => {
    const text = memoryEmbeddingText(m);
    return { id: String(m.id), text, key: vectorCacheKey(c, text) };
  }).filter(e => e.text);

  const cached = await idbGetMany(Array.from(new Set(entries.map(e => e.key))));
  const missing = [];
  const seenMissing = new Set();
  for (const e of entries) {
    const v = cached.get(e.key);
    if (v) { vectors.set(e.id, v); stats.cached++; continue; }
    if (!seenMissing.has(e.key)) { seenMissing.add(e.key); missing.push(e); }
  }

  const todo = missing.slice(0, Math.max(0, maxNew === Infinity ? missing.length : maxNew));
  stats.failed = missing.length - todo.length;
  for (let i = 0; i < todo.length; i += c.batchSize) {
    const batch = todo.slice(i, i + c.batchSize);
    try {
      const vecs = await embedTexts(batch.map(b => b.text), c, { signal, fetchImpl });
      const records = batch.map((b, j) => ({ key: b.key, vec: vecs[j], model: c.model }));
      await idbPutMany(records);
      for (const r of records) cached.set(r.key, r.vec);
      stats.computed += batch.length;
    } catch (e) {
      stats.failed += batch.length;
      stats.error = stats.error || e;
      // 一批失败通常意味着接口整体不可用，不再继续打剩余批次
      stats.failed += Math.max(0, todo.length - i - batch.length);
      break;
    }
    try { onProgress?.({ done: Math.min(i + batch.length, todo.length), total: todo.length }); } catch {}
  }
  for (const e of entries) {
    if (vectors.has(e.id)) continue;
    const v = cached.get(e.key);
    if (v) vectors.set(e.id, v);
  }
  return stats;
}

const _queryCache = new Map();
const QUERY_CACHE_MAX = 40;

export async function embedQuery(text, cfg, { signal, fetchImpl } = {}) {
  const c = normalizeEmbeddingCfg(cfg);
  const t = String(text ?? '').trim();
  if (!t) return null;
  const key = vectorCacheKey(c, 'Q|' + t);
  if (_queryCache.has(key)) return _queryCache.get(key);
  const [vec] = await embedTexts([t], c, { signal, fetchImpl });
  if (_queryCache.size >= QUERY_CACHE_MAX) {
    const first = _queryCache.keys().next().value;
    if (first !== undefined) _queryCache.delete(first);
  }
  _queryCache.set(key, vec);
  return vec;
}

/** 面板「测试连接」：发一条短文本，返回维度与耗时 */
export async function testEmbeddingConnection(cfg) {
  const started = Date.now();
  const [vec] = await embedTexts(['MemoryPilot embedding connectivity test'], cfg);
  return { dimensions: vec.length, ms: Date.now() - started };
}
