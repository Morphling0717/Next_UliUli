"use client";

import { useEffect, useState } from "react";
import { WindChimeConnectionKeys } from "@windchime/embed/broadcast";
import { mailLiveClient } from "@/lib/windchime-client";

export function MailConnectionKeys({ topicId, topicTitle }: { topicId: string; topicTitle?: string }) {
  const [userCode, setUserCode] = useState("");
  useEffect(() => { const query = new URLSearchParams(window.location.search); queueMicrotask(() => setUserCode((query.get("userCode") || query.get("deviceCode") || "").slice(0, 32))); }, []);
  return <WindChimeConnectionKeys key={topicId} client={mailLiveClient} topicId={topicId} topicTitle={topicTitle} userCode={userCode} className="rounded-2xl border border-cyan-400/40 bg-black/60 p-5 text-sm text-cyan-100 shadow-[0_0_30px_rgba(45,226,230,0.12)] backdrop-blur-xl sm:p-6" />;
}
