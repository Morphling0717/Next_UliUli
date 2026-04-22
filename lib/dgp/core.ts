/**
 * DGP 核心工具函数
 * Ported from legacy public/js/dgp/1_core.js (UMD / window.DGP.Core) to TS.
 *
 * 相较 legacy 版本：
 * - `deepClone` 从 JSON.parse(JSON.stringify()) 换为原生 structuredClone，
 *   速度快 3-10×，支持 Map/Set/Date/循环引用，内存占用更低。
 * - 新增 `escapeHtml`，用于把玩家输入（骑士代号等）安全地拼进
 *   引擎产出的 htmlText 里；后者在 React 中通过 dangerouslySetInnerHTML
 *   渲染，必须经过转义以防 XSS。
 */

/**
 * 从数组中均匀抽取一个元素。
 *
 * 可选 `rng` 参数：传入 `() => number`（例如 SeededRNG.next.bind(rng)）以支持
 * 可复现的确定性抽取；不传时使用 `Math.random`，与 legacy 行为完全兼容。
 */
export function getRandom<T>(arr: T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

// 结构化克隆兜底：极少数老浏览器/早期 Node (<17) 没有 structuredClone；
// 兜底走 JSON 路径以保持功能正确（代价是丢失 Map/Set/循环引用，但 DGP
// 的 Player/StageDef/BuckleDef 等数据结构都是纯 JSON，不受影响）。
const cloneImpl: <T>(v: T) => T =
  typeof globalThis.structuredClone === 'function'
    ? (globalThis.structuredClone as <T>(v: T) => T)
    : <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function deepClone<T>(obj: T): T {
  return cloneImpl(obj);
}

export function generateHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * 转义 HTML 特殊字符，用于安全地把不受信文本（例如玩家输入的骑士代号）
 * 拼进 DgpLogEntry.htmlText，后者会被 `dangerouslySetInnerHTML` 渲染。
 *
 * 不负责转义已经属于控制标记的字符串；只对**将被当作文本**的片段使用。
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const DgpCore = { getRandom, deepClone, generateHash, escapeHtml };
