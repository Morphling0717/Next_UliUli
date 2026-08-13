import { createHash } from 'node:crypto';
import {
  SPECIALS,
  combinations,
} from '../shared/harness';

export type DeepAuditFocus = 'prophet' | 'surtr';

export type DeepCoverageLineup = {
  focus: DeepAuditFocus;
  teamSize: number;
  teamA: string[];
  teamB: string[];
  mirror: boolean;
  obligations: string[];
};

export type DeepCoveragePlan = {
  focus: DeepAuditFocus;
  teamSize: number;
  candidateCount: number;
  selectedCount: number;
  canonicalCount: number;
  mirrorCount: number;
  obligationCount: number;
  uncovered: string[];
  fingerprint: string;
  lineups: DeepCoverageLineup[];
};

function pairKey(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join('+');
}

function sideOf(name: string, teamA: readonly string[], teamB: readonly string[]): 'A' | 'B' {
  if (teamA.includes(name)) return 'A';
  if (teamB.includes(name)) return 'B';
  throw new Error(`Coverage lineup is missing ${name}`);
}

function prophetObligations(
  teamSize: number,
  teamA: readonly string[],
  teamB: readonly string[],
): string[] {
  const yuzuSide = sideOf('柚子', teamA, teamB);
  const keys = new Set<string>([`prophet:size:${teamSize}`]);
  const participants = [...teamA, ...teamB];
  const others = participants.filter((name) => name !== '柚子');
  others.forEach((name) => {
    keys.add(
      `prophet:size:${teamSize}:role:${name}:${sideOf(name, teamA, teamB) === yuzuSide ? 'ally' : 'enemy'}`,
    );
  });
  for (let left = 0; left < others.length; left += 1) {
    for (let right = left + 1; right < others.length; right += 1) {
      const first = others[left]!;
      const second = others[right]!;
      keys.add(
        `prophet:pair:${pairKey(first, second)}:${sideOf(first, teamA, teamB) === sideOf(second, teamA, teamB) ? 'same' : 'opposed'}`,
      );
    }
  }
  return [...keys].sort();
}

function surtrObligations(
  teamSize: number,
  teamA: readonly string[],
  teamB: readonly string[],
): string[] {
  const gachaSide = sideOf('牢鳄', teamA, teamB);
  const owlSide = sideOf('鸮', teamA, teamB);
  const anchorRelation = gachaSide === owlSide
    ? 'joint-owners'
    : gachaSide === 'A'
      ? 'split-gacha-a'
      : 'split-owl-a';
  const keys = new Set<string>([
    `surtr:size:${teamSize}`,
    `surtr:size:${teamSize}:owners:${anchorRelation}`,
  ]);
  const participants = [...teamA, ...teamB];
  const others = participants.filter((name) => name !== '牢鳄' && name !== '鸮');
  others.forEach((name) => {
    const side = sideOf(name, teamA, teamB);
    keys.add(
      `surtr:size:${teamSize}:role:${name}:gacha-${side === gachaSide ? 'ally' : 'enemy'}:owl-${side === owlSide ? 'ally' : 'enemy'}`,
    );
  });
  for (let left = 0; left < others.length; left += 1) {
    for (let right = left + 1; right < others.length; right += 1) {
      const first = others[left]!;
      const second = others[right]!;
      keys.add(
        `surtr:pair:${pairKey(first, second)}:${sideOf(first, teamA, teamB) === sideOf(second, teamA, teamB) ? 'same' : 'opposed'}`,
      );
    }
  }
  return [...keys].sort();
}

function obligationsFor(
  focus: DeepAuditFocus,
  teamSize: number,
  teamA: readonly string[],
  teamB: readonly string[],
): string[] {
  return focus === 'prophet'
    ? prophetObligations(teamSize, teamA, teamB)
    : surtrObligations(teamSize, teamA, teamB);
}

function relevant(
  focus: DeepAuditFocus,
  teamA: readonly string[],
  teamB: readonly string[],
): boolean {
  if (focus === 'prophet') return teamA.includes('柚子') || teamB.includes('柚子');
  return (
    (teamA.includes('牢鳄') || teamB.includes('牢鳄')) &&
    (teamA.includes('鸮') || teamB.includes('鸮'))
  );
}

function lineupKey(teamA: readonly string[], teamB: readonly string[]): string {
  return `${[...teamA].sort().join('+')}::${[...teamB].sort().join('+')}`;
}

export function buildDeepCoveragePlan(
  focus: DeepAuditFocus,
  teamSize: number,
): DeepCoveragePlan {
  if (teamSize < 3 || teamSize > 5) {
    throw new Error(`Deep coverage only supports 3v3 through 5v5, got ${teamSize}v${teamSize}`);
  }
  const covered = new Set<string>();
  const allObligations = new Set<string>();
  const canonical: DeepCoverageLineup[] = [];
  let candidateCount = 0;
  for (const teamA of combinations(SPECIALS, teamSize)) {
    const teamASet = new Set(teamA);
    const remaining = SPECIALS.filter((name) => !teamASet.has(name));
    for (const teamB of combinations(remaining, teamSize)) {
      if (!relevant(focus, teamA, teamB)) continue;
      candidateCount += 1;
      const obligations = obligationsFor(focus, teamSize, teamA, teamB);
      obligations.forEach((key) => allObligations.add(key));
      if (!obligations.some((key) => !covered.has(key))) continue;
      canonical.push({
        focus,
        teamSize,
        teamA: [...teamA],
        teamB: [...teamB],
        mirror: false,
        obligations,
      });
      obligations.forEach((key) => covered.add(key));
    }
  }
  const lineups: DeepCoverageLineup[] = [];
  const seen = new Set<string>();
  const add = (lineup: DeepCoverageLineup) => {
    const key = lineupKey(lineup.teamA, lineup.teamB);
    if (seen.has(key)) return;
    seen.add(key);
    lineups.push(lineup);
  };
  canonical.forEach((lineup) => {
    add(lineup);
    add({
      ...lineup,
      teamA: [...lineup.teamB],
      teamB: [...lineup.teamA],
      mirror: true,
      obligations: obligationsFor(focus, teamSize, lineup.teamB, lineup.teamA),
    });
  });
  const uncovered = [...allObligations].filter((key) => !covered.has(key)).sort();
  if (lineups.length > 6000) {
    throw new Error(`${focus} ${teamSize}v${teamSize} selected ${lineups.length} lineups, above the 6000 hard cap`);
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(lineups.map((lineup) => ({
      teamA: lineup.teamA,
      teamB: lineup.teamB,
      mirror: lineup.mirror,
    }))))
    .digest('hex');
  return {
    focus,
    teamSize,
    candidateCount,
    selectedCount: lineups.length,
    canonicalCount: canonical.length,
    mirrorCount: lineups.filter((lineup) => lineup.mirror).length,
    obligationCount: allObligations.size,
    uncovered,
    fingerprint,
    lineups,
  };
}
