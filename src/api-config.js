// MemoryPilot API Config - auto-transformed

import { getChatScopeKey } from './chat-scope.js';
import { loadEmbeddingCfg, saveEmbeddingCfg, normalizeEmbeddingCfg, normalizeEmbeddingBase, DEF_EMBEDDING_CFG, testEmbeddingConnection, getMemoryVectors, clearVectorCache, countVectorCache } from './embedding.js';

export async function openApiConfig() {
(async () => {
  const PANEL = 'mp_api_panel';
  const STYLE = 'mp_api_style';
  const SKEY = 'mp_api_config';
  const META_NS = 'MemoryPilot';
  const $ = id => document.getElementById(id);
  const h = s => String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const ctx = window.SillyTavern?.getContext?.();
  const esc = s => String(s ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\"');

  const normalizeOpenAIBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
  const normalizeClaudeBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/v1\/messages$/i,'');
  const normalizeGeminiBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/models\/.*$/i,'');

  const defaultsByProvider = {
    openai: {
      label: 'OpenAI兼容',
      url: 'https://api.openai.com/v1',
      models: []
    },
    claude: {
      label: 'Claude原生',
      url: 'https://api.anthropic.com',
      models: ['claude-opus-4-6','claude-sonnet-4-5','claude-haiku-4-5']
    },
    gemini: {
      label: 'Gemini原生',
      url: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite']
    }
  };

  const metaRoot = () => { try { return ctx?.chatMetadata?.extensions?.[META_NS] || {}; } catch { return {}; } };
  // Storage: extensionSettings (server-synced, outside chat file)
  const _EXT_NAME = 'MemoryPilot';
  const _getStore = () => {
    const c = window.SillyTavern?.getContext?.();
    if (!c?.extensionSettings) return null;
    if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
    const ck = getChatScopeKey(c);
    if (!c.extensionSettings[_EXT_NAME][ck]) c.extensionSettings[_EXT_NAME][ck] = {};
    return c.extensionSettings[_EXT_NAME][ck];
  };
  const _getGlobalStore = () => {
    const c = window.SillyTavern?.getContext?.();
    if (!c?.extensionSettings) return null;
    if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
    if (!c.extensionSettings[_EXT_NAME]._global) c.extensionSettings[_EXT_NAME]._global = {};
    return c.extensionSettings[_EXT_NAME]._global;
  };
  let _saveTimer = null;
  const _saveDebounced = (immediate = false) => {
    clearTimeout(_saveTimer);
    if (immediate) {
      try { window.SillyTavern?.getContext?.()?.saveSettingsDebounced?.(); } catch {}
      return;
    }
    _saveTimer = setTimeout(() => {
      try { window.SillyTavern?.getContext?.()?.saveSettingsDebounced?.(); } catch {}
    }, 10000);
  };
  const syncMeta = async (patch, immediate) => {
    // Only save sticky state to extensionSettings, skip ephemeral stuff
    if (!patch) return;
    const dominated = ['turnCounter','recallEvery','mp_recall_pin','mp_recall_ctx','mp_pending_ops'];
    const dominated_set = new Set(dominated);
    const dominated_only = Object.keys(patch).every(k => dominated_set.has(k));
    if (dominated_only) return; // skip ephemeral-only patches
    const store = _getStore();
    if (!store) return;
    for (const [k, v] of Object.entries(patch)) {
      if (dominated_set.has(k)) continue;
      if (k === 'mp_memories' && Array.isArray(v)) continue; // memories stored separately
      store[k] = v;
    }
    _saveDebounced();
  };

  const load = async () => {
    // API 配置是跨浏览器的全局设置：服务端数据优先，localStorage 仅作缓存。
    try {
      const globalStore = _getGlobalStore();
      if (globalStore && globalStore[SKEY] && typeof globalStore[SKEY] === 'object') {
        try { localStorage.setItem(SKEY, JSON.stringify(globalStore[SKEY])); } catch {}
        return globalStore[SKEY];
      }
    } catch {}
    // 兼容旧版本按聊天/角色保存的配置，并自动迁移到全局。
    try {
      const legacyStore = _getStore();
      if (legacyStore && legacyStore[SKEY] && typeof legacyStore[SKEY] === 'object') {
        const migrated = legacyStore[SKEY];
        const globalStore = _getGlobalStore();
        if (globalStore) {
          globalStore[SKEY] = migrated;
          _saveDebounced(true);
        }
        try { localStorage.setItem(SKEY, JSON.stringify(migrated)); } catch {}
        return migrated;
      }
    } catch {}
    try { const meta = ctx.chatMetadata?.extensions?.['MemoryPilot']; if (meta && meta[SKEY]) return meta[SKEY]; } catch {}
    try { const r = localStorage.getItem(SKEY); if (r && r.trim()) return JSON.parse(r); } catch {}
    return {};
  };

  const save = async c => {
    const text = JSON.stringify(c || {});
    try { localStorage.setItem(SKEY, text); } catch {}
    const globalStore = _getGlobalStore();
    if (globalStore) {
      globalStore[SKEY] = c || {};
      _saveDebounced(true);
    }
  };

  if ($(PANEL)) { $(PANEL).remove(); $(STYLE)?.remove(); return; }
  try { document.getElementById('mp_main_panel')?.remove(); document.getElementById('mp_main_style')?.remove(); } catch {}
  try { document.getElementById('mp_recall_monitor_panel')?.remove(); document.getElementById('mp_recall_monitor_style')?.remove(); } catch {}

  const cfg = await load();
  const provider = cfg.provider || 'openai';
  const embCfg = loadEmbeddingCfg(ctx);
  const selectedTheme = window.MemoryPilot?.getSettings?.()?.panelTheme || 'dark';

  const st = document.createElement('style');
  st.id = STYLE;
  st.textContent = `
    #${PANEL} { position:fixed!important;inset:0!important;z-index:10002;display:grid!important;place-items:center!important;width:100vw!important;height:100vh!important;height:100dvh!important;margin:0!important;padding:max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)) 12px;box-sizing:border-box!important;overflow:hidden!important;transform:none!important;font-family:-apple-system,sans-serif;isolation:isolate; }
    #${PANEL} .mask { position:absolute;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px); }
    #${PANEL} .mp-dialog-card { position:relative!important;inset:auto!important;float:none!important;width:100%!important;max-width:760px!important;max-height:100%!important;margin:0!important;transform:none!important;box-sizing:border-box!important;background:#222327;border-radius:14px;border:1px solid rgba(255,255,255,0.08);padding:0;box-shadow:0 16px 48px rgba(0,0,0,0.5);overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y; }
    #${PANEL} h3 { margin:0 24px 16px 0;color:#fff;font-size:16px; }
    #${PANEL} .f { margin-bottom:12px; }
    #${PANEL} .f label { display:block;color:#aaa;font-size:11px;margin-bottom:3px; }
    #${PANEL} .f input, #${PANEL} .f select { width:100%;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:13px;box-sizing:border-box; }
    #${PANEL} .f input:focus, #${PANEL} .f select:focus { outline:none;border-color:rgba(124,107,240,0.5); }
    #${PANEL} .btn { padding:7px 14px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#ddd;font-size:12px;cursor:pointer; }
    #${PANEL} .btn:hover { background:rgba(255,255,255,0.1);color:#fff; }
    #${PANEL} .btn-p { background:rgba(124,107,240,0.25);border-color:rgba(124,107,240,0.4);color:#a5b4fc; }
    #${PANEL} .btn-p:hover { background:rgba(124,107,240,0.35); }
    #${PANEL} .hint { font-size:10px;color:#888;margin-top:3px;line-height:1.45; }
    #${PANEL} .row { display:flex;gap:8px;align-items:center;margin-bottom:12px; }
    #${PANEL} .close { position:absolute;top:12px;right:14px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%; }
    #${PANEL} .close:hover { color:#fff;background:rgba(255,255,255,0.08); }
    #${PANEL} .status { margin-top:10px;padding:8px 12px;border-radius:6px;font-size:12px; }
    #${PANEL} .status.ok { background:rgba(74,222,128,0.12);color:#4ade80; }
    #${PANEL} .status.err { background:rgba(248,113,113,0.12);color:#f87171; }
    #${PANEL} .topline{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
    #${PANEL} .topline h3{margin:0;color:#fff;font-size:18px}
    #${PANEL} .topactions{display:flex;align-items:center;gap:4px}
    #${PANEL} .help{width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:#aaa;font-size:17px;cursor:pointer}
    #${PANEL} .help:hover{background:rgba(255,255,255,.08);color:#fff}
    #${PANEL} .hubnav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#292a2f;border-bottom:1px solid rgba(255,255,255,.08)}
    #${PANEL} .hubtab{min-height:38px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#303138;color:#c9c7d0;font-size:12px;font-weight:600;cursor:pointer}
    #${PANEL} .hubtab.on{background:rgba(124,107,240,.25);border-color:rgba(124,107,240,.5);color:#c4b5fd}
    #${PANEL} .topline .close{position:static}
    #${PANEL} .settingsnav{display:flex;gap:6px;overflow-x:auto;padding:8px 14px;background:#26272c;border-bottom:1px solid rgba(255,255,255,.08);scrollbar-width:none}
    #${PANEL} .settingsnav::-webkit-scrollbar{display:none}
    #${PANEL} .settab{flex:0 0 auto;padding:7px 12px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#303138;color:#c9c7d0;font-size:11px;cursor:pointer}
    #${PANEL} .settab.on{background:rgba(124,107,240,.25);color:#c4b5fd;border-color:rgba(124,107,240,.5)}
    #${PANEL} .formbody{padding:16px 20px 20px}
    #${PANEL} .sectionintro{margin:0 0 14px;color:#ddd;font-size:13px;font-weight:700}
    @media(max-width:560px) {
      #${PANEL} { padding:max(8px, env(safe-area-inset-top)) 8px max(8px, env(safe-area-inset-bottom)) 8px; }
      #${PANEL} .mp-dialog-card { max-width:100%!important;padding:0;border-radius:10px; }
      #${PANEL} .row { flex-direction:column;align-items:stretch; }
      #${PANEL} .row .btn { width:100%; }
    }
    @media(max-width:420px) {
      #${PANEL} { padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0; }
      #${PANEL} .mp-dialog-card { border-radius:0;border-left:none;border-right:none;padding:14px 12px; }
      #${PANEL} h3 { font-size:15px; }
    }
  ` + (selectedTheme === 'light' ? `
    #${PANEL}{color:#352f3c;color-scheme:light}
    #${PANEL} .mask{background:rgba(55,48,63,.22)}
    #${PANEL} .mp-dialog-card{background:#f8f6fb;border-color:#ddd7e5;box-shadow:0 18px 54px rgba(63,51,76,.18);color:#352f3c}
    #${PANEL} .topline,#${PANEL} .hubnav{background:#fff;border-color:#e8e3ed}
    #${PANEL} h3{color:#302a37}
    #${PANEL} .hubtab{background:#faf9fb;border-color:#ded8e6;color:#625a6b}
    #${PANEL} .hubtab.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181}
    #${PANEL} .settingsnav{background:#f4f1f7;border-color:#e3dfe8}
    #${PANEL} .settab{background:#fff;border-color:#ddd7e5;color:#665e6f}
    #${PANEL} .settab.on{background:#e9e1f2;color:#694f85;border-color:#b9a7cd}
    #${PANEL} .f label{color:#5d5565}
    #${PANEL} .f input,#${PANEL} .f select{background:#fff!important;color:#342e3a!important;border-color:#d9d3e0!important}
    #${PANEL} .btn{background:#fff;border-color:#d8d2df;color:#504858}
  ` : '');
  document.head.appendChild(st);

  const root = document.createElement('div');
  root.id = PANEL;
  root.innerHTML = `
    <div class="mask"></div>
    <div class="mp-dialog-card">
      <div class="topline"><h3>MemoryPilot</h3><div class="topactions"><button class="help" id="mpa_help" aria-label="打开新手指引" title="新手指引">?</button><button class="close" id="mpa_close" aria-label="关闭">&times;</button></div></div>
      <nav class="hubnav" aria-label="MemoryPilot 主导航">
        <button class="hubtab" data-hub="memory">记忆管理</button>
        <button class="hubtab" data-hub="monitor">召回监控</button>
        <button class="hubtab on" data-hub="settings">设置</button>
      </nav>
      <nav class="settingsnav" aria-label="设置分类">
        <button class="settab on">API 配置</button>
        <button class="settab" data-open-panel="recall">召回设置</button>
        <button class="settab" data-open-panel="filter">文本过滤</button>
        <button class="settab" data-open-panel="data">数据管理</button>
      </nav>
      <div class="formbody">
      <div class="sectionintro">楼层总结与关键词处理 API</div>
      <h3>Memory Pilot - API 配置</h3>

      <div class="f">
        <label>Provider</label>
        <select id="mpa_provider">
          <option value="openai" ${provider==='openai'?'selected':''}>OpenAI兼容</option>
          <option value="claude" ${provider==='claude'?'selected':''}>Claude原生</option>
          <option value="gemini" ${provider==='gemini'?'selected':''}>Gemini原生</option>
        </select>
      </div>

      <div class="f"><label>API URL</label><input id="mpa_url" value="${h(cfg.url||defaultsByProvider[provider].url)}" placeholder=""></div>
      <div class="f"><label>API Key</label><input id="mpa_key" type="password" value="${h(cfg.key||'')}" placeholder=""></div>

      <div class="f" id="mpa_ver_wrap" style="display:${provider==='claude'?'block':'none'}">
        <label>Anthropic-Version</label>
        <input id="mpa_aver" value="${h(cfg.anthropicVersion||'2023-06-01')}" placeholder="2023-06-01">
      </div>

      <div class="f"><label>Max Output Tokens</label><input id="mpa_maxtok" value="${h(cfg.maxTokens==null?'':String(cfg.maxTokens))}" placeholder="留空则不传"></div>
      <div class="f"><label>Temperature</label><input id="mpa_temp" value="${h(cfg.temperature==null?'':String(cfg.temperature))}" placeholder="留空则不传"></div>
      <div class="f"><label>Top P</label><input id="mpa_topp" value="${h(cfg.topP==null?'':String(cfg.topP))}" placeholder="留空则不传"></div>
      <div class="f" id="mpa_topk_wrap"><label>Top K</label><input id="mpa_topk" value="${h(cfg.topK==null?'':String(cfg.topK))}" placeholder="Claude / Gemini 可用"></div>
      <div class="f" id="mpa_pp_wrap"><label>Presence Penalty</label><input id="mpa_pp" value="${h(cfg.presencePenalty==null?'':String(cfg.presencePenalty))}" placeholder="OpenAI兼容可用"></div>
      <div class="f" id="mpa_fp_wrap"><label>Frequency Penalty</label><input id="mpa_fp" value="${h(cfg.frequencyPenalty==null?'':String(cfg.frequencyPenalty))}" placeholder="OpenAI兼容可用"></div>

      <div class="row">
        <button class="btn" id="mpa_fetch">拉取模型列表</button>
        <span class="hint" id="mpa_fstat"></span>
      </div>

      <div class="f"><label>选择模型</label>
        <select id="mpa_model"><option value="">-- 请先拉取或手动填写 --</option></select>
      </div>

      <div class="f"><label>或手动输入模型名</label><input id="mpa_manual" value="${h(cfg.model||'')}" placeholder="model name"></div>
      <div class="hint" id="mpa_hint"></div>

      <button class="btn btn-p" id="mpa_save" style="width:100%;padding:10px;font-size:13px;">保存</button>
      <div id="mpa_status"></div>

      <div class="sectionintro" style="margin-top:26px;padding-top:18px;border-top:1px solid rgba(128,128,128,.25)">向量召回（Embedding）</div>
      <h3>Memory Pilot - Embedding 配置</h3>
      <div class="hint" style="margin-bottom:12px">用 OpenAI 兼容的 <code>/v1/embeddings</code> 接口（如 Qwen3-Embedding-8B、text-embedding-3、SiliconFlow 等）给记忆和最近上下文算向量，按余弦相似度召回。记忆向量缓存在浏览器 IndexedDB，文本不变不会重算；每个评估轮只额外调用一次接口。接口失败时自动回退关键词召回。</div>

      <div class="f"><label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="mpe_enabled" style="width:auto" ${embCfg.enabled ? 'checked' : ''}>启用向量召回</label></div>
      <div class="f"><label>召回模式</label>
        <select id="mpe_mode">
          <option value="hybrid" ${embCfg.mode==='hybrid'?'selected':''}>混合：关键词命中或相似度≥阈值均可召回，分数混合（推荐）</option>
          <option value="vector" ${embCfg.mode==='vector'?'selected':''}>纯向量：只看相似度，关键词不参与召回</option>
          <option value="keyword" ${embCfg.mode==='keyword'?'selected':''}>关键词：不调用 Embedding，与旧版完全一致</option>
        </select>
      </div>
      <div class="f"><label>Embedding API URL</label><input id="mpe_url" value="${h(embCfg.url||DEF_EMBEDDING_CFG.url)}" placeholder="https://api.openai.com/v1"></div>
      <div class="f"><label>Embedding API Key</label><input id="mpe_key" type="password" value="${h(embCfg.key||'')}" placeholder="可与上方主 API 不同"></div>
      <div class="row">
        <button class="btn" id="mpe_fetch">拉取模型列表</button>
        <span class="hint" id="mpe_fstat"></span>
      </div>
      <div class="f"><label>选择 Embedding 模型</label>
        <select id="mpe_model_sel">${(embCfg.models || []).length
          ? ['<option value="">-- 请选择 --</option>'].concat(embCfg.models.map(m => `<option value="${h(m)}" ${m===(embCfg.model||'')?'selected':''}>${h(m)}</option>`)).join('')
          : '<option value="">-- 请先拉取或手动填写 --</option>'}</select>
      </div>
      <div class="f"><label>或手动输入 Embedding 模型名</label><input id="mpe_model" value="${h(embCfg.model||'')}" placeholder="例如 Qwen/Qwen3-Embedding-8B 或 text-embedding-3-small"></div>
      <div class="row" style="align-items:flex-start">
        <div class="f" style="flex:1;margin:0"><label>维度 dimensions（0 = 不传）</label><input id="mpe_dims" type="number" min="0" step="1" value="${h(String(embCfg.dimensions||0))}"></div>
        <div class="f" style="flex:1;margin:0"><label>相似度阈值（0~1）</label><input id="mpe_threshold" type="number" min="0" max="1" step="0.01" value="${h(String(embCfg.threshold))}"></div>
        <div class="f" style="flex:1;margin:0"><label>混合模式向量权重（0~1）</label><input id="mpe_weight" type="number" min="0" max="1" step="0.05" value="${h(String(embCfg.weight))}"></div>
      </div>
      <div class="hint" style="margin-bottom:12px">阈值：关键词没命中时，相似度达到该值才会被向量召回，一般 0.45~0.65，越高越严。权重：混合模式下向量分数占比，其余为原关键词分数。换模型或改维度后会自动重新计算向量。</div>
      <div class="row" style="align-items:flex-start">
        <div class="f" style="flex:1;margin:0"><label>每轮送入的上下文字符数</label><input id="mpe_qchars" type="number" min="200" max="8000" step="100" value="${h(String(embCfg.queryChars))}"></div>
        <div class="f" style="flex:1;margin:0"><label>超时（毫秒）</label><input id="mpe_timeout" type="number" min="3000" max="120000" step="1000" value="${h(String(embCfg.timeoutMs))}"></div>
        <div class="f" style="flex:1;margin:0"><label>每批记忆数</label><input id="mpe_batch" type="number" min="1" max="64" step="1" value="${h(String(embCfg.batchSize))}"></div>
      </div>
      <div class="row">
        <button class="btn" id="mpe_test">测试连接</button>
        <button class="btn" id="mpe_index">为当前聊天记忆建立向量</button>
        <button class="btn" id="mpe_clear">清空向量缓存</button>
        <span class="hint" id="mpe_stat"></span>
      </div>
      <button class="btn btn-p" id="mpe_save" style="width:100%;padding:10px;font-size:13px;">保存 Embedding 配置</button>
      <div id="mpe_status"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('[data-hub="memory"]')?.addEventListener('click', () => window.MemoryPilot?.openPanel?.('list'));
  root.querySelector('[data-hub="monitor"]')?.addEventListener('click', () => window.MemoryPilot?.openMonitor?.());
  $('mpa_help').onclick = async () => { await window.MemoryPilot?.openPanel?.('list'); setTimeout(() => document.getElementById('mp_help')?.click(), 180); };
  root.querySelectorAll('[data-open-panel]').forEach(btn => btn.addEventListener('click', () => window.MemoryPilot?.openPanel?.('cfg', btn.getAttribute('data-open-panel'))));

  const applyProviderUI = (mode) => {
    const def = defaultsByProvider[mode] || defaultsByProvider.openai;
    $('mpa_hint').textContent =
      mode === 'openai' ? '用于 OpenAI 兼容网关，发送到 /chat/completions。'
      : mode === 'claude' ? 'Claude 原生会请求 /v1/messages，并附带 x-api-key 与 anthropic-version。'
      : 'Gemini 原生会请求 /models/{model}:generateContent，并使用 x-goog-api-key。';
    $('mpa_ver_wrap').style.display = mode === 'claude' ? 'block' : 'none';
    $('mpa_topk_wrap').style.display = (mode === 'claude' || mode === 'gemini') ? 'block' : 'none';
    $('mpa_pp_wrap').style.display = mode === 'openai' ? 'block' : 'none';
    $('mpa_fp_wrap').style.display = mode === 'openai' ? 'block' : 'none';
    if (!$('mpa_url').value.trim()) $('mpa_url').value = def.url;
    const models = Array.isArray(cfg.models) && cfg.provider===mode ? cfg.models : def.models;
    const sel = $('mpa_model');
    if (models?.length) {
      sel.innerHTML = ['<option value="">-- 请选择 --</option>'].concat(
        models.map(m => `<option value="${h(m)}" ${m===(cfg.model||'')?'selected':''}>${h(m)}</option>`)
      ).join('');
    } else {
      sel.innerHTML = '<option value="">-- 请先拉取或手动填写 --</option>';
    }
  };

  applyProviderUI(provider);

  const close = () => { $(PANEL)?.remove(); $(STYLE)?.remove(); };
  $('mpa_close').onclick = close;
  root.querySelector('.mask').onclick = close;

  $('mpa_provider').onchange = () => {
    const mode = $('mpa_provider').value;
    const def = defaultsByProvider[mode] || defaultsByProvider.openai;
    $('mpa_url').value = def.url;
    if (mode === 'claude' && !$('mpa_aver').value.trim()) $('mpa_aver').value = '2023-06-01';
    applyProviderUI(mode);
  };

  $('mpa_fetch').onclick = async () => {
    const mode = $('mpa_provider').value;
    const url = $('mpa_url').value.trim();
    const key = $('mpa_key').value.trim();
    if (!url || !key) { $('mpa_fstat').textContent = '请先填 URL 和 Key'; return; }
    $('mpa_fstat').textContent = '拉取中...';
    try {
      let models = [];
      if (mode === 'openai') {
        const res = await fetch(normalizeOpenAIBase(url) + '/models', {
          headers: { 'Authorization': 'Bearer ' + key }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        models = (data.data || []).map(m => m.id).filter(Boolean).sort();
      } else if (mode === 'claude') {
        const res = await fetch(normalizeClaudeBase(url) + '/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': $('mpa_aver').value.trim() || '2023-06-01'
          }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        models = (data.data || []).map(m => m.id || m.name).filter(Boolean);
      } else {
        const res = await fetch(normalizeGeminiBase(url) + '/models', {
          headers: { 'x-goog-api-key': key }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        models = (data.models || []).map(m => String(m.name || '').replace(/^models\//,'')).filter(Boolean);
      }

      if (!models.length) throw new Error('未返回模型');
      const sel = $('mpa_model');
      sel.innerHTML = ['<option value="">-- 请选择 --</option>'].concat(
        models.map(m => `<option value="${h(m)}">${h(m)}</option>`)
      ).join('');
      $('mpa_fstat').textContent = models.length + ' 个模型';
      cfg.models = models;
      cfg.provider = mode;
    } catch (e) {
      $('mpa_fstat').textContent = '失败: ' + e.message;
    }
  };

  $('mpa_save').onclick = async () => {
    const mode = $('mpa_provider').value;
    const rawUrl = $('mpa_url').value.trim();
    const normalizedUrl = mode === 'claude' ? normalizeClaudeBase(rawUrl) : mode === 'gemini' ? normalizeGeminiBase(rawUrl) : normalizeOpenAIBase(rawUrl);
    const c = {
      provider: mode,
      url: normalizedUrl,
      key: $('mpa_key').value.trim(),
      model: $('mpa_model').value || $('mpa_manual').value.trim(),
      models: cfg.models || defaultsByProvider[mode].models || [],
      maxTokens: $('mpa_maxtok').value.trim()==='' ? undefined : Number($('mpa_maxtok').value.trim()),
      temperature: $('mpa_temp').value.trim()==='' ? undefined : Number($('mpa_temp').value.trim()),
      topP: $('mpa_topp').value.trim()==='' ? undefined : Number($('mpa_topp').value.trim()),
      topK: $('mpa_topk').value.trim()==='' ? undefined : Number($('mpa_topk').value.trim()),
      presencePenalty: $('mpa_pp').value.trim()==='' ? undefined : Number($('mpa_pp').value.trim()),
      frequencyPenalty: $('mpa_fp').value.trim()==='' ? undefined : Number($('mpa_fp').value.trim()),
      anthropicVersion: $('mpa_aver')?.value?.trim?.() || '2023-06-01'
    };
    await save(c);
    $('mpa_status').innerHTML = '<div class="status ok">已保存，并同步到当前聊天文件</div>';
    toastr?.success?.('API 配置已保存');
  };

  // ===== Embedding 向量召回 =====
  let embModels = Array.isArray(embCfg.models) ? embCfg.models.slice() : [];
  const readEmbForm = () => normalizeEmbeddingCfg({
    enabled: !!$('mpe_enabled')?.checked,
    mode: $('mpe_mode')?.value,
    url: $('mpe_url')?.value,
    key: $('mpe_key')?.value,
    model: ($('mpe_model')?.value || '').trim() || $('mpe_model_sel')?.value || '',
    models: embModels,
    dimensions: $('mpe_dims')?.value,
    threshold: $('mpe_threshold')?.value,
    weight: $('mpe_weight')?.value,
    queryChars: $('mpe_qchars')?.value,
    timeoutMs: $('mpe_timeout')?.value,
    batchSize: $('mpe_batch')?.value,
  });
  const embStatus = (ok, text) => { const el = $('mpe_status'); if (el) el.innerHTML = `<div class="status ${ok ? 'ok' : 'err'}">${h(text)}</div>`; };
  const refreshEmbStat = async () => {
    try { const n = await countVectorCache(); if ($('mpe_stat')) $('mpe_stat').textContent = `已缓存 ${n} 条向量`; } catch {}
  };
  const loadCurrentMemories = () => {
    try {
      const store = _getStore();
      if (Array.isArray(store?.mp_memories)) return store.mp_memories;
    } catch {}
    try { const r = localStorage.getItem('mp_memories'); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; }
  };
  refreshEmbStat();

  // 下拉选中后同步到手动输入框，保存时以输入框为准
  $('mpe_model_sel').onchange = () => { const v = $('mpe_model_sel').value; if (v) $('mpe_model').value = v; };

  $('mpe_fetch').onclick = async () => {
    const url = normalizeEmbeddingBase($('mpe_url').value);
    const key = $('mpe_key').value.trim();
    if (!url || !key) { $('mpe_fstat').textContent = '请先填 Embedding URL 和 Key'; return; }
    $('mpe_fstat').textContent = '拉取中...';
    try {
      const res = await fetch(url + '/models', { headers: { 'Authorization': 'Bearer ' + key } });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      const models = (data.data || []).map(m => m.id).filter(Boolean).sort();
      if (!models.length) throw new Error('未返回模型');
      embModels = models;
      const cur = $('mpe_model').value.trim();
      $('mpe_model_sel').innerHTML = ['<option value="">-- 请选择 --</option>'].concat(
        models.map(m => `<option value="${h(m)}" ${m===cur?'selected':''}>${h(m)}</option>`)
      ).join('');
      $('mpe_fstat').textContent = models.length + ' 个模型（列表含全部模型，请选 embedding 类）';
    } catch (e) {
      $('mpe_fstat').textContent = '失败: ' + e.message;
    }
  };

  $('mpe_save').onclick = async () => {
    const c = readEmbForm();
    if (c.enabled && c.mode !== 'keyword' && !c.model) {
      embStatus(false, '已保存，但模型名为空：向量召回不会生效，将继续使用关键词召回。');
    } else {
      embStatus(true, c.enabled && c.mode !== 'keyword' ? `已保存：${c.mode === 'vector' ? '纯向量' : '混合'}模式，模型 ${c.model}` : '已保存：向量召回未启用，使用关键词召回。');
    }
    saveEmbeddingCfg(ctx, c);
    toastr?.success?.('Embedding 配置已保存');
  };

  $('mpe_test').onclick = async () => {
    const c = readEmbForm();
    if (!c.url || !c.model) { embStatus(false, '请先填写 Embedding URL 和模型名'); return; }
    $('mpe_stat').textContent = '测试中...';
    try {
      const r = await testEmbeddingConnection(c);
      embStatus(true, `连接成功：返回 ${r.dimensions} 维向量，耗时 ${r.ms} ms`);
    } catch (e) {
      embStatus(false, `连接失败：${e?.message || e}`);
    }
    refreshEmbStat();
  };

  $('mpe_index').onclick = async () => {
    const c = readEmbForm();
    if (!c.url || !c.model) { embStatus(false, '请先填写 Embedding URL 和模型名'); return; }
    const mems = loadCurrentMemories().filter(m => m && m.priority !== 'high');
    if (!mems.length) { embStatus(false, '当前聊天没有可建索引的非常驻记忆'); return; }
    $('mpe_index').disabled = true;
    $('mpe_stat').textContent = `建立中 0/${mems.length}...`;
    try {
      const r = await getMemoryVectors(mems, c, { onProgress: p => { $('mpe_stat').textContent = `建立中 ${p.done}/${p.total}...`; } });
      if (r.error && !r.computed && !r.cached) embStatus(false, `建立失败：${r.error?.message || r.error}`);
      else embStatus(!r.error, `向量索引完成：缓存命中 ${r.cached} 条，新计算 ${r.computed} 条${r.failed ? `，失败 ${r.failed} 条（${r.error?.message || ''}）` : ''}`);
    } catch (e) {
      embStatus(false, `建立失败：${e?.message || e}`);
    } finally {
      $('mpe_index').disabled = false;
      refreshEmbStat();
    }
  };

  $('mpe_clear').onclick = async () => {
    await clearVectorCache();
    embStatus(true, '向量缓存已清空，下次召回会重新计算');
    refreshEmbStat();
  };
})();
}
