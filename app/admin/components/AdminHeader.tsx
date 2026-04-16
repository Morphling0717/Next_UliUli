"use client";

import { ExternalLink, Save, Terminal } from "lucide-react";

interface AdminHeaderProps {
  onSave: () => void;
}

export function AdminHeader({ onSave }: AdminHeaderProps) {
  return (
    <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-2 font-mono">
          <Terminal className="text-[#2de2e6]" />
          SYSTEM_ADMIN
        </h1>
        <p className="text-gray-500 text-xs mt-1 font-mono">
          PROJECT BLUE MORPHO CONFIGURATION
        </p>
      </div>
      <div className="flex gap-3">
        <a
          href="/"
          target="_blank"
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition text-sm flex items-center gap-2"
        >
          <ExternalLink className="w-4 h-4" /> PREVIEW
        </a>
        <button
          onClick={onSave}
          className="px-6 py-2 bg-[#2de2e6] hover:bg-white text-black font-bold rounded-lg shadow-[0_0_20px_rgba(45,226,230,0.3)] transition flex items-center gap-2"
        >
          <Save className="w-4 h-4" /> SAVE CHANGES
        </button>
      </div>
    </header>
  );
}
