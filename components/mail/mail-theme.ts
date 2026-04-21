/**
 * 赛博朋克主题 —— 覆盖 @windchime/embed 默认组件样式，
 * 让 Sender / Admin / Blocklist / QR 全部融入 UliUli 的霓虹蓝氛围。
 *
 * 使用 Tailwind v4 + `--neon-blue: #2de2e6` / `--dark-bg: #050508` CSS 变量。
 */

export const mailSenderTheme = {
  root: "w-full",
  panel:
    "relative overflow-hidden rounded-2xl border border-cyan-400/40 bg-black/80 p-6 text-white shadow-[0_0_40px_rgba(45,226,230,0.25)] backdrop-blur-xl sm:p-8 before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle_at_top_right,rgba(45,226,230,0.15),transparent_60%)]",
  header: "mb-6 flex items-start justify-between gap-4",
  title:
    "font-['Orbitron',sans-serif] text-2xl font-bold tracking-[0.12em] text-white drop-shadow-[0_0_8px_rgba(45,226,230,0.6)]",
  statusOpen:
    "rounded-full border border-cyan-400/60 bg-cyan-400/10 px-3 py-1 font-mono text-[10px] tracking-wider text-cyan-300",
  statusPaused:
    "rounded-full border border-rose-400/60 bg-rose-400/10 px-3 py-1 font-mono text-[10px] tracking-wider text-rose-300",
  tagline: "mb-5 text-sm text-gray-400",
  textarea:
    "w-full min-h-[160px] resize-y rounded-lg border border-cyan-500/30 bg-black/60 p-4 font-['Noto_Sans_SC',sans-serif] text-[15px] leading-relaxed text-white outline-none transition placeholder:text-gray-500 focus:border-cyan-400 focus:bg-black/80 focus:shadow-[0_0_0_3px_rgba(45,226,230,0.15)]",
  secondaryInput:
    "w-full rounded-lg border border-cyan-500/30 bg-black/60 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-cyan-400 focus:shadow-[0_0_0_3px_rgba(45,226,230,0.15)]",
  counter: "text-right font-mono text-xs text-cyan-400/70",
  primaryButton:
    "relative mt-4 w-full overflow-hidden rounded-lg border border-cyan-400 bg-cyan-400 px-6 py-3.5 font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.2em] text-black shadow-[0_0_20px_rgba(45,226,230,0.5)] transition-all hover:bg-white hover:text-black hover:shadow-[0_0_30px_rgba(45,226,230,0.8)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  primaryButtonDisabled:
    "pointer-events-none border-gray-600 bg-gray-700 text-gray-400 shadow-none",
  secondaryButton:
    "rounded-lg border border-cyan-500/40 bg-transparent px-4 py-2 font-mono text-xs text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-400/10",
  successBanner:
    "rounded-lg border border-emerald-400/60 bg-emerald-400/10 p-4 text-center text-sm text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.25)]",
  errorBanner:
    "mb-4 rounded-lg border border-rose-400/60 bg-rose-400/10 p-3 text-sm text-rose-300",
  turnstileWrap: "flex justify-center",
};

export const mailAdminTheme = {
  root: "w-full text-white",
  panel: "flex flex-col gap-4",
  header: "flex flex-wrap items-center justify-between gap-3",
  title:
    "font-['Orbitron',sans-serif] text-xl font-bold tracking-[0.12em] text-white drop-shadow-[0_0_8px_rgba(45,226,230,0.4)]",
  meta: "font-mono text-xs text-gray-400",
  toolbar:
    "flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/20 bg-black/50 p-3 backdrop-blur-md",
  tabActive:
    "rounded-md border border-cyan-400 bg-cyan-400 px-3 py-1.5 font-mono text-xs font-bold text-black shadow-[0_0_15px_rgba(45,226,230,0.4)]",
  tabInactive:
    "rounded-md border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-gray-400 hover:bg-white/10 hover:text-white",
  button:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/40 bg-black/60 px-3 py-1.5 font-mono text-xs text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-400/10",
  primaryButton:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-400 bg-cyan-400 px-3 py-1.5 font-mono text-xs font-bold text-black shadow-[0_0_15px_rgba(45,226,230,0.4)] transition hover:bg-white",
  dangerButton:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-400/60 bg-rose-400/10 px-3 py-1.5 font-mono text-xs text-rose-300 transition hover:bg-rose-400 hover:text-black",
  tableWrap:
    "overflow-hidden rounded-xl border border-cyan-500/20 bg-black/50 backdrop-blur-md",
  table: "w-full text-left text-sm text-gray-300",
  th: "border-b border-cyan-500/20 bg-cyan-500/5 px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-cyan-300",
  td: "border-b border-white/5 px-4 py-3",
  rowSelected: "bg-cyan-400/10",
  checkbox:
    "h-4 w-4 rounded border-cyan-500 bg-black text-cyan-400 focus:ring-cyan-400 focus:ring-offset-0",
  favoriteActive: "text-cyan-400",
  link: "text-cyan-400 hover:text-white hover:underline",
  muted: "text-gray-500",
  cardGrid: "flex w-full flex-col gap-4",
  card: "group relative flex flex-col overflow-hidden rounded-xl border border-cyan-500/20 bg-black/60 backdrop-blur-md transition-all duration-300 hover:border-cyan-400/60 hover:shadow-[0_0_24px_rgba(45,226,230,0.25)]",
  cardUnread:
    "border-cyan-400/60 shadow-[0_0_16px_rgba(45,226,230,0.3)]",
  cardFavorited:
    "border-cyan-300/80 shadow-[0_0_24px_rgba(45,226,230,0.35)]",
  badge:
    "inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300",
};

export const mailBlocklistTheme = {
  root: "w-full text-white",
  panel:
    "rounded-xl border border-rose-500/30 bg-black/50 p-4 backdrop-blur-md",
  header: "mb-4 flex items-center justify-between gap-3",
  title:
    "font-['Orbitron',sans-serif] text-lg font-bold tracking-[0.12em] text-rose-300",
  button:
    "inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-500/40 bg-black/60 px-3 py-1.5 font-mono text-xs text-rose-300 transition hover:border-rose-400 hover:bg-rose-400/10",
  tableWrap:
    "overflow-hidden rounded-lg border border-white/10 bg-black/40",
  table: "w-full text-left text-sm text-gray-300",
  th: "border-b border-white/10 bg-white/5 px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-rose-300",
  td: "border-b border-white/5 px-4 py-3",
  muted: "text-gray-500",
  badge:
    "inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] text-rose-300",
};

export const mailQrTheme = {
  root: "w-full",
  panel:
    "relative overflow-hidden rounded-2xl border border-cyan-400/40 bg-black/80 p-6 shadow-[0_0_40px_rgba(45,226,230,0.2)] backdrop-blur-xl sm:p-8",
  title:
    "mb-1 text-center font-['Orbitron',sans-serif] text-lg font-bold tracking-[0.15em] text-white drop-shadow-[0_0_8px_rgba(45,226,230,0.6)]",
  subtitle: "mb-6 text-center font-mono text-xs text-gray-400",
  canvasWrap:
    "relative mx-auto w-fit overflow-hidden rounded-xl border border-cyan-400/60 bg-white p-3 shadow-[0_0_20px_rgba(45,226,230,0.3)]",
  toolbar: "mt-5 flex flex-wrap items-center justify-center gap-3",
  button:
    "rounded-md border border-cyan-500/40 bg-black/60 px-4 py-2 font-mono text-xs text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-400/10",
};

export const mailPosterEditorTheme = {
  panel:
    "rounded-2xl border border-cyan-400/40 bg-black/60 p-5 shadow-[0_0_30px_rgba(45,226,230,0.15)] backdrop-blur-xl sm:p-6",
  title:
    "mb-3 font-['Orbitron',sans-serif] text-sm font-bold tracking-[0.15em] text-cyan-300",
  fieldList: "grid grid-cols-1 gap-3",
  label: "flex flex-col gap-1 font-mono text-[11px] uppercase tracking-wider text-gray-400",
  input:
    "rounded-md border border-cyan-500/30 bg-black/60 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20",
  textarea:
    "min-h-[60px] resize-y rounded-md border border-cyan-500/30 bg-black/60 px-3 py-2 text-sm leading-relaxed text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20",
  avatarPreview:
    "flex items-center gap-3 rounded-md border border-cyan-500/20 bg-black/40 p-2",
  avatarImg:
    "h-12 w-12 rounded-full border-2 border-cyan-400/60 object-cover shadow-[0_0_10px_rgba(45,226,230,0.3)]",
  avatarCaption: "truncate font-mono text-[11px] text-gray-500",
};
