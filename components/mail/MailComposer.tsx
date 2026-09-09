"use client";
import { useEffect, useRef } from "react";
import {
  useWindChimeSubmission,
  useWindChimeTurnstile,
} from "@windchime/embed/react";
import type { WindChimeRateLimit } from "@windchime/embed/core";
import { mailClient } from "@/lib/windchime-client";
import { mailSenderTheme as t } from "./mail-theme";
import { Mail, Send } from "lucide-react";

type Props = {
  title: string;
  tagline: string;
  statusOpenLabel: string;
  statusPausedLabel: string;
  pausedMessage: string;
  placeholder: string;
  nicknamePlaceholder: string;
  linkPlaceholder: string;
  successMessage: string;
  rateLimit: WindChimeRateLimit;
  turnstileSiteKey?: string;
  enabled?: boolean;
  topicSlug?: string;
  onSent?: () => void;
};
export function MailComposer(props: Props) {
  const { turnstileSiteKey, enabled = true, onSent } = props;
  const submission = useWindChimeSubmission({
    client: mailClient,
    topicSlug: props.topicSlug,
    enabled,
    requireTurnstile: !!turnstileSiteKey,
    rateLimit: props.rateLimit,
    senderFingerprintKey: "windchime:fp",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const challengeRef = useRef<HTMLDivElement>(null);
  const challenge = useWindChimeTurnstile(challengeRef, {
    siteKey: turnstileSiteKey,
    theme: "dark",
    onToken: submission.setTurnstileToken,
  });
  const { success, clearSuccess } = submission;
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => clearSuccess(), 4500);
    return () => window.clearTimeout(timer);
  }, [success, clearSuccess]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await submission.submit()) onSent?.();
    challenge.reset();
  };
  return (
    <div className={t.root} data-mail-composer>
      <section className={t.panel}>
        <header className={t.header}>
          <div className="flex items-center gap-2">
            <Mail aria-hidden className="h-6 w-6 text-cyan-400" />
            <h2 className={t.title}>{props.title}</h2>
          </div>
          <span className={enabled ? t.statusOpen : t.statusPaused}>
            {enabled ? props.statusOpenLabel : props.statusPausedLabel}
          </span>
        </header>
        <p className={t.tagline}>{props.tagline}</p>
        {!enabled && <p className={t.errorBanner}>{props.pausedMessage}</p>}
        <form onSubmit={submit} noValidate>
          <label className="block">
            <span className="sr-only">称呼</span>
            <input
              name="nickname"
              type="text"
              autoComplete="nickname"
              value={submission.nickname}
              onChange={(e) => submission.setNickname(e.target.value)}
              maxLength={32}
              placeholder={props.nicknamePlaceholder}
              disabled={!enabled || submission.sending}
              className={t.secondaryInput}
            />
          </label>
          <label className="block">
            <span className="sr-only">相关链接</span>
            <input
              name="link"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={submission.linkRaw}
              onChange={(e) => submission.setLinkRaw(e.target.value)}
              maxLength={500}
              placeholder={props.linkPlaceholder}
              disabled={!enabled || submission.sending}
              className={t.secondaryInput}
            />
          </label>
          <label className="block">
            <span className="sr-only">信件正文</span>
            <textarea
              ref={textareaRef}
              name="message"
              autoComplete="off"
              value={submission.text}
              onChange={(e) => submission.setText(e.target.value)}
              placeholder={props.placeholder}
              maxLength={1000}
              disabled={!enabled || submission.sending}
              className={t.textarea}
            />
          </label>
          <div className={t.counter}>{submission.text.length} / 1000</div>
          {turnstileSiteKey && (
            <div ref={challengeRef} className={t.turnstileWrap} />
          )}
          <button
            type="submit"
            disabled={!submission.canSubmit}
            className={`${t.primaryButton} ${!submission.canSubmit ? t.primaryButtonDisabled : ""}`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {submission.sending ? (
                <>
                  <span
                    aria-hidden
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                  发送中…
                </>
              ) : (
                <>
                  {enabled ? "SEND SIGNAL" : "暂不接信"}
                  <Send aria-hidden className="h-4 w-4" />
                </>
              )}
            </span>
          </button>
        </form>
        {submission.success && (
          <div role="status" className={t.successBanner}>
            <p className="mb-3">{props.successMessage}</p>
            <button
              type="button"
              className={t.secondaryButton}
              onClick={() => {
                submission.clearSuccess();
                textareaRef.current?.focus();
              }}
            >
              再写一条
            </button>
          </div>
        )}
        {(submission.error || challenge.error) && (
          <p role="alert" className={t.errorBanner}>
            {submission.error?.message || challenge.error?.message}
          </p>
        )}
      </section>
    </div>
  );
}
