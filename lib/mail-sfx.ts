"use client";

/**
 * 用 Web Audio API 即时合成一个赛博风「信号已送达」音效。
 * 不依赖任何外部音频素材，避免网络加载与 404。
 *
 * 音效是两段短促正弦 beep：E5 → A5 上行小二度琶音，总时长 ~0.23s，
 * 音量较低（peak 0.12）不会扰人。
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  try {
    const w = window as unknown as {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

function beep(
  ac: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak = 0.12,
): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);
  // 快起缓落，避免"咔哒"爆音
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * 触发一次「信号已送达」音效。必须在用户 gesture 回调内调用，
 * 否则 Safari / iOS 可能会因为 autoplay 策略静默失败。
 */
export function playSentSfx(): void {
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === "suspended") {
    ac.resume().catch(() => {
      /* noop：浏览器拒绝 resume 时静默 */
    });
  }
  const t = ac.currentTime;
  beep(ac, 659.25, t + 0.0, 0.09); // E5
  beep(ac, 880.0, t + 0.07, 0.16); // A5
}
