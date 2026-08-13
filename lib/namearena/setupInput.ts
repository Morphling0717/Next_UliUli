import type { MajorNpcEventKind } from './types';

const PURUISAISHI_TRIGGER_PREFIX = '/puruisaishi';
const PURUISAISHI_TRIGGER_TOKEN_SHA256 = '76bd8e09ecc39c5b926c40de89c0ad07940cba5867aa48821b5417975b6b3905';
const HEROBRINE_TRIGGER_PREFIX = '/herobrine';
const HEROBRINE_TRIGGER_TOKEN_SHA256 = 'ddeb836908397158f96d71aaf951c3e82dfe97e748c1d6b477c5d2ea4f1b736d';

export type NameArenaSetupInput = {
  names: string[];
  forcePuruisaishi: boolean;
  forcedMajorNpcEvent?: MajorNpcEventKind;
};

function normalizeSetupLine(line: string): string {
  return line.trim().normalize('NFKC');
}

function looksLikeNpcTriggerLine(line: string): boolean {
  const normalized = normalizeSetupLine(line).toLowerCase();
  return [
    PURUISAISHI_TRIGGER_PREFIX,
    HEROBRINE_TRIGGER_PREFIX,
  ].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
}

function parseTriggerToken(line: string, prefix: string): string | null {
  const normalized = normalizeSetupLine(line);
  const lower = normalized.toLowerCase();
  if (!lower.startsWith(`${prefix} `)) return null;

  const token = normalized.slice(prefix.length).trim();
  if (!token || /\s/.test(token)) return null;
  return token;
}

async function sha256Hex(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('当前运行环境不支持安全摘要校验，无法使用重大 NPC 调试暗号');
  }

  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function isPuruisaishiTriggerLine(line: string): Promise<boolean> {
  const token = parseTriggerToken(line, PURUISAISHI_TRIGGER_PREFIX);
  if (!token) return false;
  return sha256Hex(token).then((hash) => hash === PURUISAISHI_TRIGGER_TOKEN_SHA256);
}

export async function isHerobrineTriggerLine(line: string): Promise<boolean> {
  const token = parseTriggerToken(line, HEROBRINE_TRIGGER_PREFIX);
  if (!token) return false;
  return sha256Hex(token).then((hash) => hash === HEROBRINE_TRIGGER_TOKEN_SHA256);
}

export async function parseNameArenaSetupInput(rawInput: string): Promise<NameArenaSetupInput> {
  const lines = rawInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const names: string[] = [];
  let forcePuruisaishi = false;
  let forcedMajorNpcEvent: MajorNpcEventKind | undefined;

  for (const line of lines) {
    if (!looksLikeNpcTriggerLine(line)) {
      names.push(line);
      continue;
    }

    if (await isPuruisaishiTriggerLine(line)) {
      if (forcedMajorNpcEvent && forcedMajorNpcEvent !== 'puruisaishi') {
        throw new Error('同一局只能强制一种重大 NPC 事件');
      }
      forcePuruisaishi = true;
      forcedMajorNpcEvent = 'puruisaishi';
      continue;
    }
    if (await isHerobrineTriggerLine(line)) {
      if (forcedMajorNpcEvent && forcedMajorNpcEvent !== 'herobrine') {
        throw new Error('同一局只能强制一种重大 NPC 事件');
      }
      forcedMajorNpcEvent = 'herobrine';
      continue;
    }

    throw new Error('重大 NPC 事件调试指令校验失败');
  }

  return { names, forcePuruisaishi, forcedMajorNpcEvent };
}
