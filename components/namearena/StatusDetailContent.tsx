import type {
  StatusPresentationDetail,
  StatusPresentationFact,
} from "@/lib/namearena/statusPresentation";

function DetailFacts({ facts }: { facts: StatusPresentationFact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-slate-400">
      {facts.map((fact) => (
        <div key={`${fact.label}:${fact.value}`} className="flex min-w-0 gap-1">
          <dt className="shrink-0 text-slate-500">{fact.label}</dt>
          <dd className="min-w-0 break-words text-slate-300">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusDetailContent({ detail }: { detail: StatusPresentationDetail }) {
  return (
    <div className="mt-3 min-w-0 text-left text-sm leading-6 text-slate-200">
      <p className="m-0 break-words text-slate-200">{detail.summary}</p>

      {detail.effects.length > 0 ? (
        <section className="mt-3" aria-label={detail.groupKind === "multi_source" ? "来源贡献" : "效果"}>
          <h4 className="mb-1.5 text-xs font-black text-slate-400">
            {detail.groupKind === "multi_source" ? "来源贡献" : "效果"}
          </h4>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {detail.effects.map((effect) => (
              <div key={effect.key} className="grid min-w-0 gap-0.5 py-2 sm:grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] sm:gap-x-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <strong className="break-words text-sm font-black text-white">{effect.name}</strong>
                  {effect.valueLabel ? (
                    <span className="font-mono text-xs text-cyan-200">{effect.valueLabel}</span>
                  ) : null}
                  {effect.isCurrentAttribution ? (
                    <span className="text-[11px] font-bold text-amber-200">当前结算归属</span>
                  ) : null}
                </div>
                <div className="min-w-0">
                  {effect.description ? (
                    <p className="m-0 break-words text-sm leading-6 text-slate-200">{effect.description}</p>
                  ) : null}
                  <DetailFacts facts={effect.facts} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {detail.sharedFacts.length > 0 ? (
        <footer className="mt-3 border-t border-white/10 pt-2">
          <DetailFacts facts={detail.sharedFacts} />
        </footer>
      ) : null}
    </div>
  );
}
