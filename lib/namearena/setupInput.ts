const PURUISAISHI_TRIGGER_PREFIX = '/puruisaishi';
const PURUISAISHI_TRIGGER_TOKEN_SHA256 = '76bd8e09ecc39c5b926c40de89c0ad07940cba5867aa48821b5417975b6b3905';

export type NameArenaSetupInput = {
  names: string[];
  forcePuruisaishi: boolean;
};

function normalizeSetupLine(line: string): string {
  return line.trim().normalize('NFKC');
}

function looksLikePuruisaishiTriggerLine(line: string): boolean {
  const normalized = normalizeSetupLine(line).toLowerCase();
  return normalized === PURUISAISHI_TRIGGER_PREFIX || normalized.startsWith(`${PURUISAISHI_TRIGGER_PREFIX} `);
}

function parsePuruisaishiTriggerToken(line: string): string | null {
  const normalized = normalizeSetupLine(line);
  const lower = normalized.toLowerCase();
  if (!lower.startsWith(`${PURUISAISHI_TRIGGER_PREFIX} `)) return null;

  const token = normalized.slice(PURUISAISHI_TRIGGER_PREFIX.length).trim();
  if (!token || /\s/.test(token)) return null;
  return token;
}

async function sha256Hex(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('当前运行环境不支持安全摘要校验，无法使用普瑞赛斯调试暗号');
  }

  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function isPuruisaishiTriggerLine(line: string): Promise<boolean> {
  const token = parsePuruisaishiTriggerToken(line);
  if (!token) return false;
  return sha256Hex(token).then((hash) => hash === PURUISAISHI_TRIGGER_TOKEN_SHA256);
}

export async function parseNameArenaSetupInput(rawInput: string): Promise<NameArenaSetupInput> {
  const lines = rawInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const names: string[] = [];
  let forcePuruisaishi = false;

  for (const line of lines) {
    if (!looksLikePuruisaishiTriggerLine(line)) {
      names.push(line);
      continue;
    }

    if (await isPuruisaishiTriggerLine(line)) {
      forcePuruisaishi = true;
      continue;
    }

    throw new Error('普瑞赛斯调试指令校验失败');
  }

  return { names, forcePuruisaishi };
}
