"use client";

import { ExternalLink, RefreshCw, Save, Terminal } from "lucide-react";

interface AdminHeaderProps {
  onSave: () => void;
  onReload: () => void;
  currentVersion: number;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
  historyCount: number;
  editorName: string;
  onEditorNameChange: (value: string) => void;
}

function formatDateTime(value: string | null): string {
  if (!value) return "尚无保存记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function AdminHeader({
  onSave,
  onReload,
  currentVersion,
  lastUpdatedAt,
  lastUpdatedBy,
  historyCount,
  editorName,
  onEditorNameChange,
}: AdminHeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-mono text-3xl font-bold text-white">
            <Terminal className="text-[#2de2e6]" />
            SYSTEM_ADMIN
          </h1>
          <p className="mt-1 font-mono text-xs text-gray-500">
            PROJECT BLUE MORPHO CONFIGURATION
          </p>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-cyan-200">
              VERSION #{currentVersion}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300">
              BACKUPS {historyCount}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-gray-300">
              LAST SAVE {formatDateTime(lastUpdatedAt)}
              {lastUpdatedAt ? ` · ${lastUpdatedBy || "未知"}` : ""}
            </span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-105">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] tracking-[0.25em] text-cyan-300/80">
              EDITOR_NAME
            </span>
            <input
              type="text"
              value={editorName}
              onChange={(e) => onEditorNameChange(e.target.value)}
              placeholder="例如：ASUS / 丝瓜 / 运营"
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none transition focus:border-cyan-400/50 focus:bg-white/10"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <a
              href="/"
              target="_blank"
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" /> PREVIEW
            </a>
            <button
              onClick={onReload}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" /> RELOAD LATEST
            </button>
            <button
              onClick={onSave}
              className="flex items-center gap-2 rounded-lg bg-[#2de2e6] px-6 py-2 font-bold text-black shadow-[0_0_20px_rgba(45,226,230,0.3)] transition hover:bg-white"
            >
              <Save className="h-4 w-4" /> SAVE CHANGES
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
