import fs from 'node:fs';
import path from 'node:path';
import {
  NO_WATER,
  SPECIALS,
  runBattle,
  sanitizeFileName,
  type BattleSpec,
} from '../shared/harness';

type ReviewSpec = BattleSpec & {
  forcePuruisaishi?: boolean;
  reviewFocus: string;
};

const OUT_DIR = path.join(process.cwd(), '.tmp', 'namearena-deep-audit', 'manual-logs');
const MAX_TURNS = Number.parseInt(process.env.NAMEARENA_MAX_TURNS ?? '1600', 10);

const specs: ReviewSpec[] = [
  { phase: 'no-water', label: 'no-water-baseline-a', names: NO_WATER, seed: 820000, reviewFocus: '无水 FFA、场外 OB、全角色阶段与召唤' },
  { phase: 'no-water', label: 'no-water-blue-eyes', names: NO_WATER, seed: 992003, reviewFocus: '青眼白龙卡片攻击与转移' },
  { phase: 'no-water', label: 'no-water-ra', names: NO_WATER, seed: 992022, reviewFocus: '翼神龙卡片攻击、多召唤同名编号' },
  { phase: 'no-water', label: 'no-water-owl-summons', names: NO_WATER, seed: 992085, reviewFocus: '鸮召唤物、过江协同、召唤物退场' },
  { phase: 'with-water', label: 'with-water-a', names: SPECIALS, seed: 810000, reviewFocus: '水人规格外处决、救子与阶段锁血' },
  { phase: 'with-water', label: 'with-water-b', names: SPECIALS, seed: 810007, reviewFocus: '含水 FFA 多角色交互' },
  { phase: 'puruisaishi', label: 'puruisaishi-no-water-a', names: NO_WATER, seed: 891000, forcePuruisaishi: true, reviewFocus: '普瑞赛斯两阶段、结晶、护盾与退场' },
  { phase: 'puruisaishi', label: 'puruisaishi-with-water-a', names: SPECIALS, seed: 890000, forcePuruisaishi: true, reviewFocus: '水人对普瑞赛斯事件的规格外规则' },
  { phase: '2v2', label: '2v2-yuzu-momo-vs-emote-owl', names: ['柚子@A', '萌月沫沫@A', '表情@B', '鸮@B'], seed: 1_420_011, reviewFocus: '临时组队、认主、柚子转阶段与鸮协同' },
  { phase: '2v2', label: '2v2-gacha-ting-vs-joker-tokusatsu', names: ['牢鳄@A', '小汀@A', '屑@B', '刺猬人@B'], seed: 1_420_037, reviewFocus: '召唤归属、脊髓剑、转移、反击与锁血' },
  { phase: '2v2', label: '2v2-water-gamer-vs-wt-succubus', names: ['水人@A', '玄凝@A', 'M1A2_abrams_sep@B', '克蕾儿丝菲尔@B'], seed: 1_420_074, reviewFocus: '水人救子、M1 备用载具与反击' },
  { phase: '3v3', label: '3v3-support-core', names: ['丝瓜uli@A', '柚子@A', '萌月沫沫@A', '兔卷卷@B', '表情@B', '鸮@B'], seed: 1_430_011, reviewFocus: '团队辅助、分摊、认主、场外 OB' },
  { phase: '3v3', label: '3v3-summon-core', names: ['牢鳄@A', '鸮@A', '刺猬人@A', '小汀@B', '屑@B', 'M1A2_abrams_sep@B'], seed: 1_430_037, reviewFocus: '双召唤体系、AOE、伤害转移与反击' },
  { phase: '3v3', label: '3v3-water-core', names: ['水人@A', '玄凝@A', '萌月沫沫@A', '柚子@B', '表情@B', '克蕾儿丝菲尔@B'], seed: 1_430_074, reviewFocus: '水人阵营、临时组队、认主与三阶段' },
  { phase: '4v4', label: '4v4-a', names: ['玄凝@A', '小汀@A', '牢鳄@A', '丝瓜uli@A', '兔卷卷@B', '刺猬人@B', '屑@B', '表情@B'], seed: 1_440_011, reviewFocus: '无水高密度组队交互' },
  { phase: '4v4', label: '4v4-b', names: ['克蕾儿丝菲尔@A', 'M1A2_abrams_sep@A', '柚子@A', '鸮@A', '水人@B', '玄凝@B', '萌月沫沫@B', '牢鳄@B'], seed: 1_440_037, reviewFocus: '含水高密度组队、NPC 与召唤' },
  { phase: '5v5', label: '5v5-a', names: ['玄凝@A', '小汀@A', '牢鳄@A', '丝瓜uli@A', '柚子@A', '兔卷卷@B', '刺猬人@B', '屑@B', '表情@B', '鸮@B'], seed: 1_450_011, reviewFocus: '10 人无水组队、阶段与状态密集结算' },
  { phase: '5v5', label: '5v5-b', names: ['水人@A', '克蕾儿丝菲尔@A', 'M1A2_abrams_sep@A', '萌月沫沫@A', '牢鳄@A', '玄凝@B', '小汀@B', '丝瓜uli@B', '刺猬人@B', '柚子@B'], seed: 1_450_037, reviewFocus: '10 人含水组队、救援与多层防御' },
  { phase: 'focused', label: 'crossing-and-redistribution', names: NO_WATER, seed: 992020, reviewFocus: '过江协同与伤害分摊的完整因果链' },
  { phase: 'focused', label: 'zhao-and-momo-share', names: NO_WATER, seed: 992087, reviewFocus: '赵云冲阵、沫沫均摊与召唤物承伤' },
];

export function main(): void {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Array<Record<string, unknown>> = [];

  specs.forEach((spec, index) => {
    const result = runBattle(spec, {
      checkInvariantsEachStep: true,
      maxTurns: MAX_TURNS,
      scanLogs: true,
      scanRosterNames: true,
      forcePuruisaishi: spec.forcePuruisaishi,
    });
    const fileName = `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(spec.label)}.log`;
    const filePath = path.join(OUT_DIR, fileName);
    const header = [
      `# ${spec.label}`,
      `# focus: ${spec.reviewFocus}`,
      `# seed: ${spec.seed}`,
      `# roster: ${spec.names.join(', ')}`,
      `# ended: ${result.ended}; timedOut: ${result.timedOut}; turns: ${result.turns}; logs: ${result.logCount}`,
      '',
    ];
    const body = result.logs.map((entry, line) => (
      `${String(line + 1).padStart(4, '0')} [T${entry.turn ?? '?'} R${entry.rootEventId ?? '-'} A${entry.actionId ?? '-'}] [${entry.type}] ${entry.text}`
    ));
    fs.writeFileSync(filePath, `${[...header, ...body].join('\n')}\n`, 'utf8');
    manifest.push({
      index: index + 1,
      label: spec.label,
      focus: spec.reviewFocus,
      seed: spec.seed,
      filePath,
      ended: result.ended,
      timedOut: result.timedOut,
      turns: result.turns,
      logCount: result.logCount,
      error: result.error,
      invariantErrors: result.invariantErrors,
      logIssues: result.logIssues,
    });
  });

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ battleCount: specs.length, outDir: OUT_DIR, manifestPath }, null, 2));
}
