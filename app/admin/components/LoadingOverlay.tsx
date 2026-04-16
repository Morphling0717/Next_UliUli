"use client";

import { Loader2 } from "lucide-react";

export function LoadingOverlay() {
  return (
    <div className="loading-overlay">
      <Loader2 className="w-10 h-10 text-[#2de2e6] animate-spin mb-4" />
      <div className="text-white font-mono tracking-widest">
        CONNECTING TO DATABASE...
      </div>
      <div className="text-gray-500 text-xs mt-2 font-mono">
        SYNCING CONFIGURATION FILES
      </div>
    </div>
  );
}
