import { getChatScopeKey } from './chat-scope.js';

const SNAPSHOT_PREFIX = 'mp_recall_snapshot_';
const runtimeSnapshots = new Map();

// 群聊里 characterId / name2 会随发言成员变化，所以快照的作用域 key 必须由
// chat-scope 统一计算：否则召回时（正在生成的成员）写入的 key 和打开监控面板时
// （characterId 已被清空）读取的 key 不是同一个，监控页永远是空白。
function getScopeKey(ctx = globalThis.SillyTavern?.getContext?.()) {
  return getChatScopeKey(ctx);
}

export function loadRecallSnapshot() {
  try {
    const scopeKey = getScopeKey();
    if (runtimeSnapshots.has(scopeKey)) return runtimeSnapshots.get(scopeKey);
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + scopeKey);
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== 'object') return null;
    runtimeSnapshots.set(scopeKey, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export function saveRecallSnapshot(snapshot) {
  try {
    const scopeKey = getScopeKey();
    const saved = {
      ...snapshot,
      savedAt: Date.now(),
    };
    runtimeSnapshots.set(scopeKey, saved);
    localStorage.setItem(SNAPSHOT_PREFIX + scopeKey, JSON.stringify(saved));
  } catch (error) {
    console.warn('[MP] Failed to save recall monitor snapshot:', error);
  }
}

export function clearRecallSnapshot() {
  try {
    const scopeKey = getScopeKey();
    runtimeSnapshots.delete(scopeKey);
    localStorage.removeItem(SNAPSHOT_PREFIX + scopeKey);
  } catch {}
}
