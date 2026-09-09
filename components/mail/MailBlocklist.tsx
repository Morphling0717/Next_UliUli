"use client";
import { useWindChimeBlocklist } from "@windchime/embed/react";
import { mailClient } from "@/lib/windchime-client";
import { mailBlocklistTheme as t } from "./mail-theme";
import { formatBeijing } from "./mail-time";
export function MailBlocklist() {
  const list = useWindChimeBlocklist(mailClient);
  return (
    <div className={t.root}>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="bg-gradient-to-br from-slate-700 to-slate-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:from-slate-200 dark:to-slate-400">
          BLOCKLIST · 黑名单（全局）
        </h2>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={t.button}
            disabled={list.isLoading}
            onClick={() => void list.reload()}
          >
            {list.isLoading ? "加载中…" : "刷新"}
          </button>
        </div>
      </header>
      {(list.error || list.mutationError) && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-900 dark:text-red-100"
        >
          {list.error?.message || list.mutationError?.message}
        </p>
      )}
      <div className={`${t.tableWrap} overflow-x-auto`}>
        <table className={t.table}>
          <thead>
            <tr>
              {["标签", "拉黑时间", "样例", ""].map((label, i) => (
                <th key={i} className={t.th}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.items.length ? (
              <tr>
                <td colSpan={4} className={`${t.td} py-16 text-center`}>
                  <span className={`${t.muted} text-[15px]`}>
                    {list.isLoading ? "加载中…" : "暂无被拉黑的发送者。"}
                  </span>
                </td>
              </tr>
            ) : (
              list.items.map((item) => (
                <tr key={item.hash}>
                  <td className={t.td}>
                    <span className={t.badge} title={item.hash}>
                      {item.label || item.hash.slice(0, 12)}
                    </span>
                  </td>
                  <td className={`${t.td} whitespace-nowrap ${t.muted}`}>
                    {formatBeijing(item.blockedAt)}
                  </td>
                  <td className={t.td}>
                    <span className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
                      {item.sampleText || "—"}
                    </span>
                  </td>
                  <td className={t.td}>
                    <button
                      type="button"
                      className={t.button}
                      disabled={list.pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "解除屏蔽这个发送者？已删除的历史信件不会恢复。",
                          )
                        )
                          void list.unblock(item.hash).catch(() => {});
                      }}
                    >
                      解除拉黑
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
