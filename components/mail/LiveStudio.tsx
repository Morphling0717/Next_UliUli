"use client";
import { useEffect, useMemo, useState } from "react";
import { createWindChimeLiveClient } from "@windchime/embed/client";
import { WindChimeLiveControlPanel } from "@windchime/embed/broadcast";

export function LiveStudio({ topicId }: { topicId: string }) {
  const client = useMemo(() => createWindChimeLiveClient(), []);
  const [deviceCode,setDeviceCode] = useState<string|null>(null);
  useEffect(()=>{ const query=new URLSearchParams(location.search); setDeviceCode(query.get("userCode") || query.get("deviceCode") || ""); },[]);
  if (deviceCode === null) return null;
  return <WindChimeLiveControlPanel client={client} topicId={topicId}
    title="风铃 · 私人直播控制台" deviceCode={deviceCode}
    displayUrl={process.env.NEXT_PUBLIC_WINDCHIME_DISPLAY_URL}
    onBindGateway={async () => { location.assign("/mail/connect?topicId=" + encodeURIComponent(topicId)); }} />;
}

export function LiveStudioPage() {
  const [topics, setTopics] = useState<Array<{id:string;title:string}>>([]);
  const [topicId, setTopicId] = useState("default");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/mail/topics?view=admin", { cache: "no-store", signal: abort.signal })
      .then(async response => { if (!response.ok) throw Error("请先登录网站信箱后台"); return response.json(); })
      .then(data => { setTopics(data.items); const selected=new URLSearchParams(location.search).get("topicId"); if(selected && data.items.some((topic: {id:string})=>topic.id===selected)) setTopicId(selected); setLoaded(true); })
      .catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => abort.abort();
  }, []);
  return <main style={{padding:24, maxWidth:1440, margin:"0 auto"}}>
    <p><a href="/mail">返回信箱后台 / 登录</a></p>
    {error && <p role="alert">{error}</p>}
    {loaded && <><label>话题 <select value={topicId} onChange={async event => {
      const next = event.target.value;
      try {
        await createWindChimeLiveClient().action({topicId,action:"hide",expectedRevision:0,operationId:crypto.randomUUID()});
        setTopicId(next);
      } catch { setError("隐藏当前话题失败，请确认连接后再切换"); }
    }}>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
    <LiveStudio key={topicId} topicId={topicId} /></>}
  </main>;
}
