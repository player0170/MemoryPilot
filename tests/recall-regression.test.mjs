import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runRecall as runRecallV32 } from '../src/recall-v32.js';
import { runRecall as runRecallV34 } from '../src/recall-v34.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

const injectedSummary = '月光下的旧车站约定仍然有效，双方决定下次见面继续讨论旅行计划。';

const memories = [
  {
    id: 'anima-1',
    source: 'anima_summary',
    event: 'Anima 总结',
    summary: injectedSummary,
    priority: 'medium',
    primaryKeywords: ['月光'],
    timestamp: 1,
  },
  {
    id: 'manual-1',
    source: 'manual',
    event: '手动记忆',
    summary: injectedSummary,
    priority: 'medium',
    primaryKeywords: ['月光'],
    timestamp: 2,
  },
];

async function settleRecall(runRecall) {
  runRecall();
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function execute(runRecall, {
  animaDedupe = false,
  helper = undefined,
  turnCounter = 0,
  every = 1,
  stickyState = {},
} = {}) {
  const chatMetadata = {
    extensions: {
      MemoryPilot: {
        turnCounter,
        stickyState,
      },
    },
    variables: {},
  };
  const context = {
    chatId: 'recall-regression',
    name2: 'character',
    chat: [{ is_user: true, mes: '今晚在月光下谈谈旅行计划。' }],
    chatMetadata,
    extensionSettings: { MemoryPilot: {} },
    saveSettingsDebounced() {},
  };
  const scopeKey = 'recall-regression::character';
  const storage = new MemoryStorage({
    mp_active_chat: scopeKey,
    mp_memories: JSON.stringify(memories),
    mp_recall_settings: JSON.stringify({
      every,
      alpha: 0.72,
      stickyTurns: 5,
      contextWindow: 8,
      maxRecall: 6,
      animaDedupe,
    }),
  });

  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.TavernHelper = helper;

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) =>
    originalSetTimeout(callback, Math.min(Number(delay) || 0, 1), ...args);
  try {
    await settleRecall(runRecall);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  return {
    pin: chatMetadata.variables.mp_recall_pin || '',
    ctx: chatMetadata.variables.mp_recall_ctx || '',
    storedSticky: context.extensionSettings.MemoryPilot[scopeKey]?.stickyState || {},
  };
}

const activeHelper = {
  async getChatWorldbookName() {
    return 'chat-worldbook';
  },
  async getWorldbook() {
    return [{
      name: '[ANIMA_Chat_History_Container]',
      enabled: true,
      content: `本轮 Anima 已注入：${injectedSummary}`,
    }];
  },
};

for (const [version, runRecall] of [['v32', runRecallV32], ['v34', runRecallV34]]) {
  const disabled = await execute(runRecall, { animaDedupe: false, helper: activeHelper });
  assert.equal(
    disabled.ctx,
    `[手动记忆] ${injectedSummary}\n[Anima 总结] ${injectedSummary}`,
    `${version}: 关闭 Anima 去重时应保持原召回结果与顺序`,
  );

  const unavailable = await execute(runRecall, { animaDedupe: true });
  assert.equal(unavailable.ctx, disabled.ctx, `${version}: Anima 不可用时应完全回退到原召回行为`);
  assert.equal(unavailable.pin, disabled.pin, `${version}: Anima 不可用时常驻记忆不应变化`);

  const noWorldbook = await execute(runRecall, {
    animaDedupe: true,
    helper: {
      async getChatWorldbookName() {
        return '';
      },
      async getWorldbook() {
        throw new Error('不应读取世界书');
      },
    },
  });
  assert.equal(noWorldbook.ctx, disabled.ctx, `${version}: 聊天世界书缺失时不应影响召回`);
  assert.equal(noWorldbook.pin, disabled.pin, `${version}: 聊天世界书缺失时常驻记忆不应变化`);

  const originalWarn = console.warn;
  console.warn = () => {};
  const readFailed = await execute(runRecall, {
    animaDedupe: true,
    helper: {
      async getChatWorldbookName() {
        return 'chat-worldbook';
      },
      async getWorldbook() {
        throw new Error('模拟读取失败');
      },
    },
  });
  console.warn = originalWarn;
  assert.equal(readFailed.ctx, disabled.ctx, `${version}: Anima 读取失败时应完全回退到原召回行为`);
  assert.equal(readFailed.pin, disabled.pin, `${version}: Anima 读取失败时常驻记忆不应变化`);

  const deduped = await execute(runRecall, { animaDedupe: true, helper: activeHelper });
  assert.equal(
    deduped.ctx,
    `[手动记忆] ${injectedSummary}`,
    `${version}: 只能移除已由 Anima 注入的 anima_summary，不能移除相同文本的手动记忆`,
  );

  const stickyState = {
    'anima-1': { event: 'Anima 总结', summary: injectedSummary, turnsLeft: 3 },
    'manual-1': { event: '手动记忆', summary: injectedSummary, turnsLeft: 3 },
  };
  const stickyDisabled = await execute(runRecall, {
    animaDedupe: false,
    helper: activeHelper,
    turnCounter: 1,
    every: 3,
    stickyState,
  });
  assert.equal(
    stickyDisabled.ctx,
    `[Anima 总结] ${injectedSummary}\n[手动记忆] ${injectedSummary}`,
    `${version}: 关闭去重时 sticky 内容与原行为一致`,
  );
  assert.equal(stickyDisabled.storedSticky['anima-1'].turnsLeft, 2, `${version}: 原 sticky 衰减轮数应保持不变`);
  assert.equal(stickyDisabled.storedSticky['manual-1'].turnsLeft, 2, `${version}: 原 sticky 衰减轮数应保持不变`);

  const stickyDeduped = await execute(runRecall, {
    animaDedupe: true,
    helper: activeHelper,
    turnCounter: 1,
    every: 3,
    stickyState,
  });
  assert.equal(
    stickyDeduped.ctx,
    `[手动记忆] ${injectedSummary}`,
    `${version}: sticky 期内也只过滤重复 Anima 记忆`,
  );
  assert.equal(stickyDeduped.storedSticky['anima-1'], undefined, `${version}: 重复 Anima 不应继续保留 sticky`);
  assert.equal(stickyDeduped.storedSticky['manual-1'].turnsLeft, 2, `${version}: 非 Anima sticky 仍按原逻辑衰减`);
}

// ===== 群聊作用域回归 =====
// 群聊里 SillyTavern 会在生成每个成员的回复前把 characterId / name2 改成该成员，
// 生成结束后又清空。旧版作用域 key 用的正是这两个字段，于是同一个群聊被拆成多个
// 存储桶，召回永远读到空数组并把注入变量写成空串。

const groupMemory = {
  id: 'group-1',
  source: 'manual',
  event: '会议室·三人共同决定',
  summary: '三人在会议室达成一致：明天一起去旧车站取回被寄存的行李箱，谁都不许提前走。',
  priority: 'medium',
  primaryKeywords: ['旧车站'],
  timestamp: 1,
};

const groupMembers = [
  { avatar: 'alice.png', name: 'Alice' },
  { avatar: 'bob.png', name: 'Bob' },
];

async function executeGroupTurn(runRecall, { storage, extensionSettings, speakerIndex }) {
  const chatMetadata = { extensions: { MemoryPilot: {} }, variables: {} };
  const speaker = speakerIndex == null ? null : groupMembers[speakerIndex];
  const context = {
    chatId: 'group-chat',
    groupId: 'group-1',
    groups: [{ id: 'group-1', chat_id: 'group-chat', chats: ['group-chat'] }],
    // 正在生成的成员：每轮都不一样，回复结束后被清空。
    characterId: speakerIndex ?? undefined,
    characters: groupMembers,
    name2: speaker?.name ?? '',
    chat: [{ is_user: true, mes: '我们明天真的要去旧车站吗？' }],
    chatMetadata,
    extensionSettings,
    saveSettingsDebounced() {},
  };

  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.TavernHelper = undefined;

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) =>
    originalSetTimeout(callback, Math.min(Number(delay) || 0, 1), ...args);
  try {
    await settleRecall(runRecall);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  return chatMetadata.variables.mp_recall_ctx || '';
}

const { getChatScopeKey } = await import('../src/chat-scope.js');

for (const [version, runRecall] of [['v32', runRecallV32], ['v34', runRecallV34]]) {
  const groupScopeKey = 'group-chat::group:group-1';
  // 记忆按群作用域存放在 extensionSettings 里（localStorage 缓存留空，强制走服务端同步来源）。
  const extensionSettings = {
    MemoryPilot: {
      [groupScopeKey]: {
        mp_memories: [groupMemory],
        mp_recall_settings: { every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6, animaDedupe: false, xiaobaixDedupe: false },
      },
    },
  };
  const storage = new MemoryStorage({ mp_active_chat: groupScopeKey });

  const expected = `[${groupMemory.event}] ${groupMemory.summary}`;
  const first = await executeGroupTurn(runRecall, { storage, extensionSettings, speakerIndex: 0 });
  assert.equal(first, expected, `${version}: 群聊第一个成员发言时应召回到群作用域的记忆`);

  const second = await executeGroupTurn(runRecall, { storage, extensionSettings, speakerIndex: 1 });
  assert.equal(second, expected, `${version}: 换成员发言后作用域不应漂移，召回结果必须一致`);

  const idle = await executeGroupTurn(runRecall, { storage, extensionSettings, speakerIndex: null });
  assert.equal(idle, expected, `${version}: 生成结束（characterId 被清空）后仍应命中同一作用域`);

  assert.equal(
    storage.getItem('mp_active_chat'),
    groupScopeKey,
    `${version}: 群聊内不应因发言成员变化被判定为切换聊天`,
  );
  assert.equal(
    Object.keys(extensionSettings.MemoryPilot).length,
    1,
    `${version}: 群聊不应再按发言成员派生出额外的存储桶`,
  );
}

// chat-scope 本身：群 id 的三级探测与单聊行为
assert.equal(
  getChatScopeKey({ chatId: 'c1', groupId: 'g1', characterId: 0, characters: [{ avatar: 'a.png' }], name2: 'A' }),
  'c1::group:g1',
  'groupId 存在时必须忽略当前发言成员',
);
assert.equal(
  getChatScopeKey({ chatId: 'c1', selected_group: 'g1', name2: 'A' }),
  'c1::group:g1',
  '应兼容 selected_group 字段',
);
assert.equal(
  getChatScopeKey({ chatId: 'c1', groups: [{ id: 'g1', chat_id: 'c1' }], name2: 'A' }),
  'c1::group:g1',
  'groupId / selected_group 都缺失时应能从 groups 反查',
);
assert.equal(
  getChatScopeKey({ chatId: 'c1', characterId: 0, characters: [{ avatar: 'solo.png' }], name2: 'Solo' }),
  'c1::solo.png',
  '单人聊天的作用域算法必须与旧版一致，避免已有数据失联',
);

// ===== 最近楼层记忆（recentFloors）=====
// 填 N 后：楼层号最大的 N 条非常驻记忆无需命中关键词即注入 ctx，且不占 maxRecall 名额；
// 同一条记忆不会再通过关键词召回或 sticky 重复发送。

const recentFloorMemories = [
  { id: 'pin-1', event: '常驻设定', summary: '主角对猫毛过敏。', priority: 'high', primaryKeywords: ['猫'], floorRange: [90, 99], timestamp: 9 },
  { id: 'old-1', event: '旧事件·车站', summary: '两人在旧车站第一次相遇。(#1-10)', priority: 'medium', primaryKeywords: ['旧车站'], timestamp: 1 },
  { id: 'mid-1', event: '中段·借伞', summary: '雨天在旧车站借伞。', priority: 'medium', primaryKeywords: ['旧车站'], floorRange: [20, 30], timestamp: 2 },
  { id: 'new-1', event: '最新·告别', summary: '在旧车站告别，约定再见。', priority: 'medium', primaryKeywords: ['旧车站'], floorRange: [41, 60], timestamp: 3 },
  { id: 'new-2', event: '最新·合并事件', summary: '合并后的多段事件。', priority: 'low', primaryKeywords: ['不会命中'], floorSegments: [[31, 40], [61, 70]], timestamp: 4 },
  { id: 'nofloor-1', event: '无楼层·手动', summary: '没有楼层范围的手动记忆，提到旧车站。', priority: 'medium', primaryKeywords: ['旧车站'], timestamp: 5 },
];

async function executeRecentFloors(runRecall, { recentFloors, maxRecall = 6, turnCounter = 0, every = 1, stickyState = {} }) {
  const chatMetadata = { extensions: { MemoryPilot: { turnCounter, stickyState } }, variables: {} };
  const context = {
    chatId: 'recent-floors',
    name2: 'character',
    chat: [{ is_user: true, mes: '我们再去一次旧车站吧。' }],
    chatMetadata,
    extensionSettings: { MemoryPilot: {} },
    saveSettingsDebounced() {},
  };
  const scopeKey = 'recent-floors::character';
  const storage = new MemoryStorage({
    mp_active_chat: scopeKey,
    mp_memories: JSON.stringify(recentFloorMemories),
    mp_recall_settings: JSON.stringify({ every, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall, recentFloors, animaDedupe: false, xiaobaixDedupe: false }),
  });
  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.TavernHelper = undefined;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, Math.min(Number(delay) || 0, 1), ...args);
  try {
    await settleRecall(runRecall);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  const lines = (chatMetadata.variables.mp_recall_ctx || '').split('\n').filter(Boolean);
  return {
    pin: chatMetadata.variables.mp_recall_pin || '',
    lines,
    storedSticky: context.extensionSettings.MemoryPilot[scopeKey]?.stickyState || {},
  };
}

const fmt = (m) => `[${m.event}] ${m.summary}`;
const byId = Object.fromEntries(recentFloorMemories.map(m => [m.id, m]));

for (const [version, runRecall] of [['v32', runRecallV32], ['v34', runRecallV34]]) {
  const off = await executeRecentFloors(runRecall, { recentFloors: 0 });
  assert.ok(!off.lines.includes(fmt(byId['new-2'])), `${version}: 关闭最近楼层记忆时，未命中关键词的记忆不应注入`);
  assert.ok(off.lines.includes(fmt(byId['new-1'])), `${version}: 关闭时关键词命中的记忆仍按原逻辑召回`);

  const two = await executeRecentFloors(runRecall, { recentFloors: 2 });
  assert.deepEqual(
    two.lines.slice(0, 2),
    [fmt(byId['new-2']), fmt(byId['nofloor-1'])],
    `${version}: 应按记忆列表顺序取最底部 2 条（不依赖原文楼层）并置于 ctx 最前`,
  );
  assert.equal(two.lines.filter(l => l === fmt(byId['nofloor-1'])).length, 1, `${version}: 最近楼层记忆不应再被关键词召回重复发送`);
  assert.ok(two.lines.includes(fmt(byId['new-1'])), `${version}: 不在最近 N 条里的关键词命中记忆仍应召回`);
  assert.ok(two.lines.includes(fmt(byId['mid-1'])), `${version}: 其他命中关键词的记忆仍应正常召回`);
  assert.ok(two.lines.includes(fmt(byId['old-1'])), `${version}: 仅在摘要中标注 (#1-10) 的旧记忆仍应参与关键词召回`);
  assert.equal(two.pin, fmt(byId['pin-1']), `${version}: 常驻记忆不受最近楼层记忆影响`);
  assert.ok(!two.lines.includes(fmt(byId['pin-1'])), `${version}: 常驻记忆不应被算作最近楼层记忆`);

  // 不占用 maxRecall：maxRecall=1 时，除了 2 条最近楼层记忆，关键词召回仍可给出 1 条
  const tight = await executeRecentFloors(runRecall, { recentFloors: 2, maxRecall: 1 });
  assert.equal(tight.lines.length, 3, `${version}: 最近楼层记忆不应占用「最大触发召回数」名额`);
  assert.deepEqual(tight.lines.slice(0, 2), [fmt(byId['new-2']), fmt(byId['nofloor-1'])], `${version}: 名额收紧时最近楼层记忆仍完整注入`);

  // 没有楼层范围的记忆不参与「最近楼层」，但可通过关键词召回
  const many = await executeRecentFloors(runRecall, { recentFloors: 10 });
  assert.deepEqual(
    many.lines,
    [fmt(byId['old-1']), fmt(byId['mid-1']), fmt(byId['new-1']), fmt(byId['new-2']), fmt(byId['nofloor-1'])],
    `${version}: 全部非常驻记忆（含原文楼层丢失的）应按列表顺序进入最近楼层记忆，且不重复`,
  );

  // 非评估轮：最近楼层记忆仍注入，sticky 中与之重复的条目被剔除
  const stickyState = {
    'new-1': { event: byId['new-1'].event, summary: byId['new-1'].summary, turnsLeft: 3 },
    'mid-1': { event: byId['mid-1'].event, summary: byId['mid-1'].summary, turnsLeft: 3 },
  };
  const nonEval = await executeRecentFloors(runRecall, { recentFloors: 2, turnCounter: 1, every: 3, stickyState });
  assert.deepEqual(
    nonEval.lines,
    [fmt(byId['new-2']), fmt(byId['nofloor-1']), fmt(byId['new-1']), fmt(byId['mid-1'])],
    `${version}: 非评估轮应先注入最近楼层记忆，再追加 sticky`,
  );
  assert.equal(nonEval.storedSticky['mid-1']?.turnsLeft, 2, `${version}: 非评估轮 sticky 衰减逻辑应保持不变`);
}

// ===== 文本过滤：用户正则需先于内置标签删除执行，并在监控快照中记录过滤结果 =====
// 用户规则 <Episode>\s*<details>…</details>\s*</Episode> 依赖内部 <details>，
// 如果先删掉 details 再跑正则，就永远匹配不上，导致监控里看起来“过滤完全没生效”。
// 故意把一条无效正则和一条正文里没有的规则放在最前面：它们不能影响后面规则的执行。
const cleanerRules = [
  '[unclosed',
  String.raw`<nothing>[\s\S]*?<\/nothing>`,
  String.raw`<Episode>\s*<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*<\/Episode>`,
  String.raw`<echo>[\s\S]*?<\/echo>`,
  String.raw`<danmu>[\s\S]*?<\/danmu>`,
  String.raw`<gossip>[\s\S]*?<\/gossip>`,
  String.raw`<letter>[\s\S]*?<\/letter>`,
];
// 统一规则列表：纯英文 = 标签（think / details），其它 = 正则。think 放最前、details 放最后，
// 验证顺序可控：Episode 规则在 details 之前执行，所以 details 已无可删内容（命中 0）。
const unifiedRules = ['think', ...cleanerRules, 'details'];
const noisyMessage = [
  '正文开头，提到旧车站。',
  '<think class="hidden">THINK_BODY</think>',
  '<Episode>', '<details>', '<summary>第三章</summary>', '章节 EPISODE_BODY', '</details>', '</Episode>',
  '<echo>ECHO_BODY</echo>',
  '<danmu>DANMU_A', 'DANMU_B</danmu>',
  '<gossip>GOSSIP_BODY</gossip>',
  '<letter>LETTER_BODY</letter>',
  'affinity_change: +5 PREFIX_LINE',
  '正文结尾。',
].join('\n');

async function executeCleaner(runRecall, cleanerCfg) {
  const chatMetadata = { extensions: { MemoryPilot: { turnCounter: 0, stickyState: {} } }, variables: {} };
  const context = {
    chatId: 'cleaner-order',
    name2: 'character',
    chat: [{ is_user: false, name: 'Char', mes: noisyMessage }],
    chatMetadata,
    extensionSettings: { MemoryPilot: {} },
    saveSettingsDebounced() {},
  };
  const storage = new MemoryStorage({
    mp_active_chat: 'cleaner-order::character',
    mp_memories: JSON.stringify(recentFloorMemories),
    mp_recall_settings: JSON.stringify({ every: 1, alpha: 0.72, stickyTurns: 5, contextWindow: 8, maxRecall: 6, recentFloors: 0, animaDedupe: false, xiaobaixDedupe: false }),
    mp_text_clean_cfg: JSON.stringify(cleanerCfg),
  });
  globalThis.window = globalThis;
  globalThis.localStorage = storage;
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.TavernHelper = undefined;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, Math.min(Number(delay) || 0, 1), ...args);
  try {
    await settleRecall(runRecall);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  const snapRaw = [...storage.values.entries()].find(([k]) => k.startsWith('mp_recall_snapshot_'))?.[1];
  return snapRaw ? JSON.parse(snapRaw) : null;
}

for (const [version, runRecall] of [['v32', runRecallV32], ['v34', runRecallV34]]) {
  // 新版统一规则
  const snap = await executeCleaner(runRecall, { rules: unifiedRules, cleanForRecall: true, cleanForBatch: true });
  assert.ok(snap, `${version}: 应保存召回监控快照`);
  const src = snap.sources?.[0];
  assert.equal(typeof src?.cleaned, 'string', `${version}: 快照中的聊天应带有过滤后文本 cleaned`);
  assert.equal(src.raw, noisyMessage, `${version}: 快照应保留聊天原文`);
  for (const marker of ['THINK_BODY', 'EPISODE_BODY', '第三章', 'ECHO_BODY', 'DANMU_A', 'DANMU_B', 'GOSSIP_BODY', 'LETTER_BODY', '<Episode>', '</Episode>']) {
    assert.ok(!src.cleaned.includes(marker), `${version}: 过滤后文本不应再包含 ${marker}`);
  }
  assert.ok(src.cleaned.includes('PREFIX_LINE'), `${version}: 没有填整行规则时不应删除 affinity_change 行`);
  assert.ok(src.cleaned.includes('正文开头，提到旧车站。') && src.cleaned.includes('正文结尾。'), `${version}: 过滤不应误删正文`);
  assert.equal(snap.cleaner?.cleanForRecall, true, `${version}: 快照应记录召回前清洗开关`);
  assert.deepEqual(snap.cleaner?.rules, unifiedRules, `${version}: 快照应记录本轮生效的统一规则列表`);
  assert.deepEqual(snap.cleaner?.invalidRules, ['[unclosed'], `${version}: 快照应标出无法编译的正则规则`);
  const stats = snap.cleaner?.stats;
  assert.ok(stats && typeof stats.rules === 'object', `${version}: 快照应记录每条规则的命中次数`);
  assert.equal(stats.rules['[unclosed'], undefined, `${version}: 无效正则不应有命中记录`);
  assert.equal(stats.rules[String.raw`<nothing>[\s\S]*?<\/nothing>`], 0, `${version}: 正文里没有的规则命中 0 次`);
  assert.equal(stats.rules.think, 1, `${version}: 纯英文规则 think 应按标签删除（允许带属性），命中 1 次`);
  for (const rule of cleanerRules.slice(2)) {
    assert.equal(stats.rules[rule], 1, `${version}: 前面的无效/未命中规则不应影响后续规则，${rule} 应命中 1 次`);
  }
  assert.equal(stats.rules.details, 0, `${version}: details 已被前面的 Episode 正则一起删掉，标签规则命中 0 次`);

  // 旧版三栏配置应自动迁移：regexRules → 标签 → 整行前缀（转成 ^\s*前缀.*$）
  const legacySnap = await executeCleaner(runRecall, { blockTags: ['think', 'details'], linePrefixes: ['affinity_change:'], regexRules: cleanerRules, cleanForRecall: true, cleanForBatch: true });
  const legacySrc = legacySnap.sources?.[0];
  assert.deepEqual(legacySnap.cleaner?.rules, [...cleanerRules, 'think', 'details', String.raw`^\s*affinity_change:.*$`], `${version}: 旧版三栏配置应合并为统一规则列表`);
  for (const marker of ['THINK_BODY', 'EPISODE_BODY', 'ECHO_BODY', 'LETTER_BODY', 'PREFIX_LINE']) {
    assert.ok(!legacySrc.cleaned.includes(marker), `${version}: 迁移后的旧配置仍应删除 ${marker}`);
  }
  assert.ok(legacySrc.cleaned.includes('正文结尾。'), `${version}: 迁移后的旧配置不应误删正文`);
  assert.equal(legacySnap.cleaner?.stats?.rules[String.raw`^\s*affinity_change:.*$`], 1, `${version}: 整行前缀迁移成的正则应命中 1 次`);

  // 「只保留」白名单：填写后删除规则整体失效，只保留白名单标签 / 正则命中的内容
  const keepSnap = await executeCleaner(runRecall, { keepTags: ['echo', 'summary', String.raw`<letter>([\s\S]*?)<\/letter>`, '[unclosed'], rules: unifiedRules, cleanForRecall: true, cleanForBatch: true });
  const keepSrc = keepSnap.sources?.[0];
  assert.equal(keepSnap.cleaner?.mode, 'keep', `${version}: 填写只保留白名单后快照应记录 keep 模式`);
  assert.deepEqual(keepSnap.cleaner?.keepTags, ['echo', 'summary', String.raw`<letter>([\s\S]*?)<\/letter>`, '[unclosed'], `${version}: 快照应记录白名单规则`);
  assert.deepEqual(keepSnap.cleaner?.invalidRules, ['[unclosed'], `${version}: 只保留模式下无效规则应来自白名单`);
  assert.equal(keepSrc.cleaned, '第三章\n\nECHO_BODY\n\nLETTER_BODY', `${version}: 只保留模式应按原文顺序只拼接白名单命中的内容（summary 在 echo 之前）`);
  for (const marker of ['正文开头', 'THINK_BODY', 'EPISODE_BODY', 'DANMU_A', 'GOSSIP_BODY', 'PREFIX_LINE', '<echo>', '<letter>']) {
    assert.ok(!keepSrc.cleaned.includes(marker), `${version}: 只保留模式下白名单之外的内容 ${marker} 不应出现`);
  }
  assert.equal(keepSnap.cleaner?.stats?.mode, 'keep', `${version}: stats 应标记 keep 模式`);
  assert.equal(keepSnap.cleaner?.stats?.rules.echo, 1, `${version}: 白名单标签 echo 应命中 1 次`);
  assert.equal(keepSnap.cleaner?.stats?.rules.summary, 1, `${version}: 白名单标签 summary 应命中 1 次`);
  assert.equal(keepSnap.cleaner?.stats?.rules.think, undefined, `${version}: 只保留模式下删除规则不应执行`);
}

// cleaner.js 默认规则：旧版默认的标签 / 整行前缀 / 正则都还在
{
  const { DEF_CLEANER, normalizeCleaner, applyCleaner, ruleKind } = await import('../src/cleaner.js');
  assert.deepEqual(normalizeCleaner(undefined).rules, [...DEF_CLEANER.rules], '空配置应得到默认规则');
  assert.deepEqual(DEF_CLEANER.rules.map(ruleKind), ['tag', 'tag', 'regex', 'regex', 'regex', 'regex'], '默认规则类型：think / details 为标签，其余为正则');
  const out = applyCleaner('开头\n<think>T</think>\n<details><summary>s</summary>D</details>\nmood_change: happy\n______\n结尾', undefined);
  for (const marker of ['<think>', 'T</think>', '<details>', 'D</details>', 'mood_change', 'happy', '______']) {
    assert.ok(!out.includes(marker), `默认规则应删除 think / details 整块、mood_change 整行和下划线行，不应残留 ${marker}`);
  }
  assert.ok(out.startsWith('开头') && out.endsWith('结尾'), '默认规则不应误删正文');

  // 「只保留」白名单：默认为空（不启用）；填写后只保留标签内部内容，其它全部丢弃，删除规则不再生效
  const { cleanerMode, activeCleanerRules } = await import('../src/cleaner.js');
  assert.deepEqual(normalizeCleaner(undefined).keepTags, [], '白名单默认为空');
  assert.equal(cleanerMode(undefined), 'remove', '白名单为空时是删除模式');
  const keepCfg = { keepTags: ['content', 'summary'], rules: ['think'] };
  assert.equal(cleanerMode(keepCfg), 'keep', '填写白名单后是只保留模式');
  assert.deepEqual(activeCleanerRules(keepCfg), ['content', 'summary'], '只保留模式下生效规则是白名单');
  const keepStats = { rules: {} };
  const kept = applyCleaner('开头废话\n<think>T</think>\n<CONTENT lang="zh">正文一</CONTENT>\n<echo>E</echo>\n<summary>摘要</summary>\n<content>正文二</content>\n结尾废话', keepCfg, keepStats);
  assert.equal(kept, '正文一\n\n摘要\n\n正文二', '只保留 content / summary 内部内容，按原文顺序拼接，标签大小写不敏感且允许属性');
  assert.equal(keepStats.mode, 'keep');
  assert.deepEqual(keepStats.rules, { content: 2, summary: 1 }, '白名单逐条统计命中次数，删除规则 think 不执行');
  assert.equal(applyCleaner('没有任何标签的消息', keepCfg), '', '一条白名单都没命中时结果为空');
  assert.equal(applyCleaner('<a>x</a> 正文 <summary>s</summary>', { keepTags: ['正文'] }), '正文', '白名单正则保留匹配到的文字');
  assert.equal(applyCleaner('<think>T</think>正文', { keepTags: [], rules: ['think'] }), '正文', '清空白名单后恢复删除模式');
}

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
assert.doesNotMatch(indexSource, /MemoryPilotRecallInterceptor/, '不应保留生成前召回拦截器');
assert.match(indexSource, /MESSAGE_RECEIVED[\s\S]*?await runRecall\(\)/, '召回应继续由 MESSAGE_RECEIVED 触发');

for (const filename of ['recall-v32.js', 'recall-v34.js']) {
  const source = await readFile(new URL(`../src/${filename}`, import.meta.url), 'utf8');
  assert.match(source, /export async function runRecall\(\)/, `${filename}: 入口签名应保持原样`);
  assert.match(source, /turnCounter <= 1 \|\| turnCounter % RECALL_EVERY === 0/, `${filename}: 轮次公式应保持原样`);
  assert.match(source, /const recent = chat\.slice\(-CTX_MSGS\)/, `${filename}: 上下文范围应保持原样`);
  assert.match(source, /const currentFloorRange = recent\.length \? \[chat\.length - recent\.length \+ 1, chat\.length\] : null/, `${filename}: 楼层范围计算应保持原样`);
  assert.match(source, /floorRangeDistance\(memFloorRange, currentFloorRange\)/, `${filename}: 楼层距离计算应保持原样`);
  assert.match(source, /nextSticky\[m\.id\] = \{ event: m\.event, summary: m\.summary, turnsLeft: STICKY_TURNS \}/, `${filename}: sticky 保存结构应保持原样`);
}

console.log('recall regression tests passed');
