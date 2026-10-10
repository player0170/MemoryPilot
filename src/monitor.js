import { loadRecallSnapshot } from './recall-monitor-state.js';

export async function openMonitor() {
  const panelId = 'mp_recall_monitor_panel';
  const styleId = 'mp_recall_monitor_style';
  const existing = document.getElementById(panelId);
  if (existing) {
    existing.remove();
    document.getElementById(styleId)?.remove();
    return;
  }
  document.getElementById('mp_main_panel')?.remove();
  document.getElementById('mp_main_style')?.remove();
  document.getElementById('mp_api_panel')?.remove();
  document.getElementById('mp_api_style')?.remove();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `#${panelId}{position:fixed;inset:0;z-index:10020;display:flex;justify-content:center;align-items:flex-start;padding:12px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#352f3c}#${panelId} .mask{position:absolute;inset:0;background:rgba(55,48,63,.22);backdrop-filter:blur(3px)}#${panelId} .card{position:relative;width:min(960px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:16px;box-shadow:0 18px 54px rgba(63,51,76,.18)}#${panelId} .top{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;background:#fff;border-bottom:1px solid #e8e3ed}#${panelId} .title{font-size:18px;font-weight:700}#${panelId} .close{border:0;background:transparent;font-size:22px;color:#756d7e;cursor:pointer}#${panelId} nav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e8e3ed}#${panelId} nav button,.btn{border:1px solid #d8d2df;border-radius:9px;background:#fff;color:#504858;padding:8px 12px;cursor:pointer}#${panelId} nav button.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181}#${panelId} .summary{padding:10px 14px;background:#f4f1f7;color:#655c6e;font-size:12px}#${panelId} details{margin:12px 14px;background:#fff;border:1px solid #e1dce7;border-radius:12px;overflow:hidden}#${panelId} summary{cursor:pointer;padding:13px 14px;font-weight:700;color:#493a57}#${panelId} .body{padding:12px;max-height:48vh;overflow:auto;font-size:13px;line-height:1.65}#${panelId} .item{padding:10px;margin-bottom:8px;background:#faf8fc;border:1px solid #e3dde9;border-radius:10px}#${panelId} .muted{color:#817888;text-align:center;padding:14px}#${panelId} .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:12px 14px}#${panelId} .setting{padding:8px;background:#faf8fc;border:1px solid #e7e1eb;border-radius:8px;color:#625a6b}@media(max-width:600px){#${panelId}{padding:0}#${panelId} .card{max-height:100dvh;border-radius:0}}`;
  const theme = window.MemoryPilot?.getSettings?.()?.panelTheme || 'dark';
  if (theme === 'dark') style.textContent += `#${panelId}{color:#ddd!important;color-scheme:dark}#${panelId} .mask{background:rgba(0,0,0,.55)!important}#${panelId} .card{background:#222327!important;border-color:rgba(255,255,255,.08)!important;box-shadow:0 16px 50px rgba(0,0,0,.5)!important}#${panelId} .top,#${panelId} nav{background:#292a2f!important;border-color:rgba(255,255,255,.08)!important}#${panelId} nav button{background:#303138!important;border-color:rgba(255,255,255,.12)!important;color:#c9c7d0!important}#${panelId} nav button.on{background:rgba(124,107,240,.25)!important;border-color:rgba(124,107,240,.5)!important;color:#c4b5fd!important}#${panelId} .summary{background:rgba(0,0,0,.25)!important;color:#aaa!important}#${panelId} details{background:rgba(255,255,255,.025)!important;border-color:rgba(255,255,255,.08)!important}#${panelId} summary{color:#ddd!important}#${panelId} .item,#${panelId} .setting{background:rgba(255,255,255,.03)!important;border-color:rgba(255,255,255,.08)!important;color:#ddd!important}#${panelId} .muted{color:#999!important}`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = panelId;
  root.innerHTML = `<div class="mask"></div><div class="card"><div class="top"><div class="title">MemoryPilot</div><button class="close" id="mpr_close" aria-label="关闭">×</button></div><nav><button data-tab="memory">记忆管理</button><button class="on" data-tab="monitor">召回监控</button><button data-tab="settings">设置</button></nav><div class="summary" id="mpr_summary">正在读取最近一次召回记录…</div><details open><summary>当前召回规则</summary><div class="body" id="mpr_rules"></div></details><details open><summary>最近一次用于匹配的聊天</summary><div class="body" id="mpr_sources"></div></details><details open><summary>最近一次召回结果</summary><div class="body" id="mpr_results"></div></details></div>`;
  document.body.appendChild(root);
  const byId = id => document.getElementById(id);
  const renderList = (title, list) => `<h4>${title}（${list.length}）</h4>${list.length ? list.map(item => `<article class="item"><b>${esc(item.event || '未命名记忆')}</b><div>${esc(item.summary || '')}</div>${item.reason ? `<small>${esc(item.reason)}</small>` : ''}</article>`).join('') : '<div class="muted">没有内容</div>'}`;
  const render = () => {
    const snap = loadRecallSnapshot();
    if (!snap) {
      byId('mpr_summary').textContent = '还没有召回记录。发送一条消息并生成回复后，可以在这里查看实际结果。';
      byId('mpr_rules').innerHTML = '<div class="muted">完成一次召回后，这里会显示本次使用的设置。</div>';
      byId('mpr_sources').innerHTML = '<div class="muted">暂无记录</div>';
      byId('mpr_results').innerHTML = '<div class="muted">暂无记录</div>';
      return;
    }
    const sources = Array.isArray(snap.sources) ? snap.sources : [];
    const pinned = Array.isArray(snap.pinned) ? snap.pinned : [];
    const recent = Array.isArray(snap.recent) ? snap.recent : [];
    const triggered = Array.isArray(snap.triggered) ? snap.triggered : [];
    const recentFloors = Number(snap.recentFloors || 0);
    const emb = snap.embedding && typeof snap.embedding === 'object' ? snap.embedding : null;
    const modeLabel = m => ({ keyword: '关键词', hybrid: '混合（关键词 + 向量）', vector: '纯向量' }[m] || '关键词');
    const embSetting = !emb || !emb.enabled
      ? '向量召回：关闭'
      : emb.active
        ? `向量召回：${esc(modeLabel(emb.mode))} · ${esc(emb.model || '')}（阈值 ${esc(Number(emb.threshold ?? 0).toFixed(2))}${emb.mode === 'hybrid' ? `，权重 ${esc(Number(emb.weight ?? 0).toFixed(2))}` : ''}）`
        : `向量召回：本轮未生效，已回退关键词（设置为 ${esc(modeLabel(emb.wantMode))}）`;
    const embNote = emb && emb.enabled
      ? `<div class="muted" style="margin-top:6px">${emb.active ? `记忆向量：缓存命中 ${esc(emb.cached || 0)} 条，本轮新计算 ${esc(emb.computed || 0)} 条${emb.failed ? `，失败 ${esc(emb.failed)} 条` : ''}。` : ''}${emb.note ? ` ${esc(emb.note)}` : ''}</div>`
      : '';
    const triggeredTitle = emb && emb.active ? (emb.mode === 'vector' ? '向量触发记忆' : '关键词 / 向量触发记忆') : '关键词触发记忆';
    byId('mpr_summary').textContent = `最近一次召回${snap.savedAt ? `（${new Date(snap.savedAt).toLocaleTimeString()}）` : ''}`;
    byId('mpr_rules').innerHTML = `<div>每 ${esc(snap.recallEvery || 1)} 轮重新匹配，读取最近 ${esc(snap.contextWindow || sources.length)} 条聊天。</div><div class="row"><div class="setting">最多召回 ${esc(snap.maxRecall || 6)} 条</div><div class="setting">命中后保留 ${esc(snap.stickyTurns ?? 5)} 轮</div><div class="setting">最近楼层记忆：${recentFloors > 0 ? `${esc(recentFloors)} 条` : '关闭'}</div><div class="setting">Anima 去重：${snap.animaDedupeEnabled === false ? '关闭' : '开启'}</div><div class="setting">小白 X 去重：${snap.xiaobaixDedupeEnabled === false ? '关闭' : '开启'}</div><div class="setting">${embSetting}</div></div>${embNote}`;
    // 展示经「文本过滤」处理后的实际匹配文本；旧快照没有 cleaned 字段时回退原文
    const cleaner = snap.cleaner && typeof snap.cleaner === 'object' ? snap.cleaner : null;
    const anyCleaned = sources.some(item => typeof item.cleaned === 'string');
    let cleanerHead = '';
    if (sources.length && !anyCleaned) {
      cleanerHead = '<div class="setting" style="margin-bottom:8px;color:#fbbf24">⚠ 这份召回记录由旧版本插件生成，没有保存过滤后的文本，下面显示的是聊天原文。请确认酒馆里的 MemoryPilot 已更新到 4.2.4 及以上并刷新页面，然后再发送一条消息，这里才会显示过滤后的结果。</div>';
    } else if (cleaner) {
      const rules = Array.isArray(cleaner.regexRules) ? cleaner.regexRules : [];
      const invalid = Array.isArray(cleaner.invalidRules) ? cleaner.invalidRules : [];
      const tags = Array.isArray(cleaner.blockTags) ? cleaner.blockTags : [];
      const prefixes = Array.isArray(cleaner.linePrefixes) ? cleaner.linePrefixes : [];
      if (cleaner.cleanForRecall === false) {
        cleanerHead = '<div class="setting" style="margin-bottom:8px;color:#fbbf24">⚠ 「召回匹配前清洗」已关闭，本轮按聊天原文匹配，文本过滤规则没有生效。可在 设置 → 文本过滤 → 作用范围 中开启。</div>';
      } else {
        const ruleList = rules.length ? rules.map(r => `<li><code>${esc(r)}</code>${invalid.includes(r) ? ' <span style="color:#f87171">（正则无效，已跳过）</span>' : ''}</li>`).join('') : '<li class="muted">（无）</li>';
        cleanerHead = `<details style="margin-bottom:8px"><summary class="muted">本轮生效的文本过滤规则：删除标签 ${esc(tags.length)} 个 · 删除整行前缀 ${esc(prefixes.length)} 个 · 正则 ${esc(rules.length)} 条${invalid.length ? ` · <span style="color:#f87171">${esc(invalid.length)} 条正则无效</span>` : ''}</summary><div class="body"><div class="muted">删除标签：${tags.length ? esc(tags.join('、')) : '（无）'}</div><div class="muted">删除整行前缀：${prefixes.length ? esc(prefixes.join('、')) : '（无）'}</div><div class="muted">正则规则（先于标签删除执行）：</div><ul style="margin:4px 0 0 18px;padding:0;word-break:break-all">${ruleList}</ul></div></details>`;
      }
    }
    byId('mpr_sources').innerHTML = sources.length ? cleanerHead + sources.map(item => {
      const hasCleaned = typeof item.cleaned === 'string';
      const shown = hasCleaned ? item.cleaned : item.raw;
      const changed = hasCleaned && String(item.cleaned).trim() !== String(item.raw || '').trim();
      const tag = hasCleaned ? (changed ? ' <span class="muted">（已应用文本过滤，已过滤 ' + Math.max(0, String(item.raw || '').length - String(item.cleaned).length) + ' 字）</span>' : ' <span class="muted">（文本过滤未改动此条）</span>') : ' <span style="color:#fbbf24">（原文，未经过滤）</span>';
      const orig = changed ? `<details><summary class="muted">查看原文</summary><div>${esc(item.raw || '（空）')}</div></details>` : '';
      return `<article class="item"><b>#${esc(item.floor)} ${esc(item.speaker)}</b>${tag}<div>${esc(shown || '（过滤后为空）')}</div>${orig}</article>`;
    }).join('') : '<div class="muted">本轮没有可用于匹配的聊天内容。</div>';
    byId('mpr_results').innerHTML = renderList('常驻记忆', pinned) + (recentFloors > 0 ? renderList('最近楼层记忆', recent) : '') + renderList(triggeredTitle, triggered);
  };
  byId('mpr_close').onclick = () => { root.remove(); style.remove(); };
  root.querySelector('[data-tab="memory"]').onclick = () => window.MemoryPilot?.openPanel?.('list');
  root.querySelector('[data-tab="settings"]').onclick = () => window.MemoryPilot?.openApiConfig?.();
  render();
}
