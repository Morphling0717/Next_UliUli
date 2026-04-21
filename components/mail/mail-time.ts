/**
 * 北京时间（Asia/Shanghai）与 UTC ISO 串的互转工具。
 *
 * 项目约定（方案 §9）：
 * - 所有主播可见的时间输入 / 展示 = 北京时间
 * - DB 列永远存 UTC Z 串
 * - 前端表单用 `<input type="datetime-local">`（无时区），把它**按北京时间理解**
 */

/**
 * HTML `datetime-local` 值（形如 `2026-06-15T15:00`，**无时区**）→ UTC ISO Z 串。
 *
 * 核心：把输入理解为北京时间 → 等价为 `localInput+08:00` → Date 构造 → toISOString
 */
export function beijingLocalToUtcIso(local: string): string {
  if (!local) return "";
  // datetime-local 可能是 YYYY-MM-DDTHH:mm 或 YYYY-MM-DDTHH:mm:ss
  // 补齐秒（如没有）并拼 +08:00
  const withSeconds = /\d{2}:\d{2}:\d{2}$/.test(local) ? local : `${local}:00`;
  const d = new Date(`${withSeconds}+08:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/**
 * UTC ISO Z 串 → HTML `datetime-local` 值（按北京时间显示）。
 *
 * 用 Intl.DateTimeFormat 的 'sv-SE' locale（瑞典，YYYY-MM-DD HH:MM 格式）
 * + Asia/Shanghai 时区；再把空格替换为 `T` 适配 `datetime-local`。
 */
export function utcIsoToBeijingLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** 给表单初值用：当前北京时间的 `datetime-local` 值 */
export function nowAsBeijingLocal(): string {
  return utcIsoToBeijingLocal(new Date().toISOString());
}

/** 给表单初值用：当前北京时间 + N 天 */
export function plusDaysAsBeijingLocal(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return utcIsoToBeijingLocal(d.toISOString());
}

/** UTC ISO → 友好的北京时间字符串（例如 "2026-06-15 15:00"） */
export function formatBeijing(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
