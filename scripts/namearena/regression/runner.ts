import fs from 'fs';
import path from 'path';
import {
  buildRegressionSpecs,
  projectRoot,
  runBattle,
  sanitizeFileName,
  type BattleResult,
  type LogIssue,
} from '../shared/harness';
import { runCharacterHookCases } from './characterHookCases';
import { runArchitectureCases } from './architectureCases';
import { runDeathAccountingCases } from './deathAccountingCases';
import { assertFactoryMapping } from './factoryMapping';
import { runPuruisaishiCases } from './puruisaishiCases';
import { runOwlCases } from './owlCases';
import { runRuleContractCases } from './ruleContracts';
import { runSlackingIsolation } from './slackingCases';
import { runStatusClockCases } from './statusClockCases';
import { runStatusReworkCases } from './statusReworkCases';

const FAILURE_DIR = path.join(projectRoot, '.tmp', 'namearena-regression-failures');

type Failure = {
  index: number;
  result: BattleResult;
  file: string;
};

type FailureSummary = {
  label: string;
  phase: string;
  error: string | null;
  invariantErrors: string[];
  logIssues: LogIssue[];
  timedOut: boolean;
  file: string;
};

type RegressionSummary = {
  ok: boolean;
  factoryMappingCaseCount: number;
  ruleContractCount: number;
  slackingCaseCount: number;
  deathCaseCount: number;
  statusClockCaseCount: number;
  statusReworkCaseCount: number;
  characterHookCaseCount: number;
  puruisaishiCaseCount: number;
  owlCaseCount: number;
  architectureCaseCount: number;
  battleCount: number;
  failures: FailureSummary[];
};

function writeFailure(result: BattleResult, index: number): string {
  fs.mkdirSync(FAILURE_DIR, { recursive: true });
  const fileName = `${String(index).padStart(4, '0')}-${result.phase}-${result.label}`;
  const outPath = path.join(FAILURE_DIR, `${sanitizeFileName(fileName)}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return outPath;
}

export function main(): void {
  const factoryMappingCases = assertFactoryMapping();
  const ruleContractCases = runRuleContractCases();
  const slackingCases = runSlackingIsolation();
  const deathCases = runDeathAccountingCases();
  const statusClockCases = runStatusClockCases();
  const statusReworkCases = runStatusReworkCases();
  const characterHookCases = runCharacterHookCases();
  const puruisaishiCases = runPuruisaishiCases();
  const owlCases = runOwlCases();
  const architectureCases = runArchitectureCases();
  const specs = buildRegressionSpecs();
  const failures: Failure[] = [];

  specs.forEach((spec, index) => {
    const result = runBattle(spec);
    const hasFailure =
      result.error ||
      result.invariantErrors.length > 0 ||
      result.logIssues.length > 0 ||
      result.timedOut;
    if (hasFailure) {
      failures.push({ index, result, file: writeFailure(result, index) });
    }
  });

  const summary: RegressionSummary = {
    ok: failures.length === 0,
    factoryMappingCaseCount: factoryMappingCases.length,
    ruleContractCount: ruleContractCases.length,
    slackingCaseCount: slackingCases.length,
    deathCaseCount: deathCases.length,
    statusClockCaseCount: statusClockCases.length,
    statusReworkCaseCount: statusReworkCases.length,
    characterHookCaseCount: characterHookCases.length,
    puruisaishiCaseCount: puruisaishiCases.length,
    owlCaseCount: owlCases.length,
    architectureCaseCount: architectureCases.length,
    battleCount: specs.length,
    failures: failures.map((failure) => ({
      label: failure.result.label,
      phase: failure.result.phase,
      error: failure.result.error,
      invariantErrors: failure.result.invariantErrors,
      logIssues: failure.result.logIssues.slice(0, 5),
      timedOut: failure.result.timedOut,
      file: failure.file,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}
