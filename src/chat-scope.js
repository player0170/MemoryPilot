// MemoryPilot chat scope key — single source of truth.
//
// 为什么要有这个文件：
// 作用域 key 原来在 storage / recall-v32 / recall-v34 / panel / api-config /
// summary-service / auto-summary / recall-monitor-state 里各写了一份，算法都是
// `${chatId}::${characterId 对应的角色}`。
// 单人聊天里 characterId / name2 全程不变，所以没问题；但群聊里 SillyTavern 会在
// 生成每个成员的回复前把 characterId / name2 改成「当前发言成员」，生成结束后又清空。
// 于是同一个群聊被拆成了多个互不相干的存储桶：
//   面板里建记忆 → `chatId::`
//   成员 A 发言触发召回 → `chatId::A.png`
//   成员 B 发言触发召回 → `chatId::B.png`
// 结果召回永远读到空数组，把 mp_recall_pin / mp_recall_ctx 写成空串后直接早退。
//
// 修复方式：群聊一律用群 id 作为作用域，完全不看 characterId / name2；
// 单人聊天保持原有算法不变，不影响已有数据。

const normalizeId = value => {
  const text = value == null ? '' : String(value).trim();
  return text && text !== 'null' && text !== 'undefined' ? text : '';
};

export function resolveContext(context) {
  if (context) return context;
  const st = globalThis.SillyTavern || globalThis.window?.SillyTavern;
  return st?.getContext?.() || null;
}

export function getChatBaseId(ctx) {
  return String(ctx?.chatId ?? ctx?.chatMetadata?.chat_file_name ?? '');
}

/**
 * 群 id 的三级探测：
 * 1. getContext().groupId（现行 SillyTavern 暴露的字段）
 * 2. selected_group（老字段 / 部分分支）
 * 3. 反查 ctx.groups：找 chat_id 或 chats 里包含当前 chatId 的群
 *    —— 即使前两个字段都没暴露，也能拿到稳定的群 id。
 */
export function getGroupId(ctx, base = getChatBaseId(ctx)) {
  const direct = normalizeId(ctx?.groupId) || normalizeId(ctx?.selected_group);
  if (direct) return direct;
  if (!base || !Array.isArray(ctx?.groups)) return '';
  const group = ctx.groups.find(item => (
    String(item?.chat_id ?? '') === base
    || (Array.isArray(item?.chats) && item.chats.some(chat => String(chat ?? '') === base))
  ));
  return normalizeId(group?.id);
}

export function getCharacterScope(ctx) {
  const charId = ctx?.characterId;
  const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
  return String(
    charObj?.avatar
    ?? charObj?.name
    ?? ctx?.chatMetadata?.character_name
    ?? ctx?.name2
    ?? ''
  );
}

export function isGroupChat(context) {
  const ctx = resolveContext(context);
  return !!getGroupId(ctx);
}

export function getChatScopeKey(context, { fallbackBase = 'default' } = {}) {
  const ctx = resolveContext(context);
  if (!ctx) return `${fallbackBase}::`;
  const base = getChatBaseId(ctx) || fallbackBase;
  const groupId = getGroupId(ctx, getChatBaseId(ctx));
  // 群聊：只认群 id，杜绝「当前发言成员」污染 key。
  if (groupId) return `${base}::group:${groupId}`;
  return `${base}::${getCharacterScope(ctx)}`;
}

/**
 * 找出同一个聊天下由旧版 key 规则产生的其他存储桶（群聊里就是各成员桶），
 * 供一次性合并迁移使用。`_mergedInto` 已标记过的桶不再参与。
 */
export function collectLegacyScopeKeys(store, currentKey, context) {
  const ctx = resolveContext(context);
  const base = getChatBaseId(ctx);
  if (!store || !base) return [];
  const prefix = `${base}::`;
  return Object.keys(store).filter(key => (
    key !== currentKey
    && key.startsWith(prefix)
    && store[key]
    && typeof store[key] === 'object'
    && !Array.isArray(store[key])
    && !store[key]._mergedInto
  ));
}
