import type {
  GachaEntry,
  JobDefinition,
  SkillDefinition,
  SkillStatusApplication,
  SkillTag,
  StatKey,
  SummonStats,
} from '../../../lib/namearena/types';
import { getStatusIdentityDefinition } from '../../../lib/namearena/statusRegistry';
import {
  assert,
  localProject,
  makeFighter,
} from '../shared/harness';

const STAT_KEYS: StatKey[] = ['atk', 'def', 'spd', 'agl', 'mag', 'res', 'wis'];
const JOB_NUMERIC_FIELDS = ['hp', ...STAT_KEYS] as const;
const SUMMON_STAT_KEYS = ['hp', ...STAT_KEYS] as const;
const SUMMON_STAT_KEY_SET = new Set<string>(SUMMON_STAT_KEYS);
const NUMERIC_SKILL_FIELDS = ['rate', 'mult', 'hits', 'minDamagePct', 'lifesteal', 'selfDmgPct', 'tributes', 'triggerAgain'] as const;
const VALID_SPELL_BLOCK_MODES = new Set(['precast', 'afterSetup', 'perHit']);

type NumericSkillField = typeof NUMERIC_SKILL_FIELDS[number];
type SkillOrGachaEntry = SkillDefinition | GachaEntry;

function getOptionalNumericField(entry: SkillOrGachaEntry, field: NumericSkillField): unknown {
  return (entry as Partial<Record<NumericSkillField, unknown>>)[field];
}

function assertFiniteNumber(value: unknown, owner: string, field: string): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value), `${owner}.${field} must be a finite number`);
}

function assertStatusExists(status: string | undefined, owner: string): void {
  if (!status) return;
  try {
    getStatusIdentityDefinition(status);
  } catch {
    assert(false, `${owner} references unknown status ${status}`);
  }
}

function assertTagExists(tag: SkillTag | string | undefined, owner: string): void {
  assert(tag && Object.values(localProject.data.SKILL_TAGS).includes(tag), `${owner} references unknown skill tag ${tag}`);
}

function assertStatusApplications(applications: readonly SkillStatusApplication[] | undefined, owner: string): void {
  applications?.forEach((application, index) => {
    assertStatusExists(application.identityId, `${owner}.statusApplications[${index}]`);
    ['potency', 'count', 'charges', 'remainingTurns'].forEach((field) => {
      const value = application[field as keyof SkillStatusApplication];
      if (value !== undefined) assertFiniteNumber(value, `${owner}.statusApplications[${index}]`, field);
    });
  });
}

function assertSummonStats(stats: SummonStats | undefined, owner: string): void {
  if (!stats) return;
  Object.entries(stats).forEach(([key, value]) => {
    assert(SUMMON_STAT_KEY_SET.has(key), `${owner}.stats references unknown summon stat ${key}`);
    assertFiniteNumber(value, owner, `stats.${key}`);
  });
}

function assertGachaEntry(entry: GachaEntry, owner: string): void {
  assert(typeof entry.text === 'string' && entry.text.length > 0, `${owner}.text must be a non-empty string`);
  if (entry.tag) assertTagExists(entry.tag, owner);
  assertStatusApplications(entry.statusApplications, owner);
  assertSummonStats(entry.stats, owner);
  if (entry.spellBlockMode) assert(VALID_SPELL_BLOCK_MODES.has(entry.spellBlockMode), `${owner}.spellBlockMode is invalid`);
  NUMERIC_SKILL_FIELDS.forEach((field) => {
    const value = getOptionalNumericField(entry, field);
    if (value !== undefined) assertFiniteNumber(value, owner, field);
  });
  if (entry.newSkill) assert(localProject.skills[entry.newSkill], `${owner} grants unknown skill ${entry.newSkill}`);
  if (entry.summonJob) assert(localProject.jobs[entry.summonJob], `${owner} summons unknown job ${entry.summonJob}`);
  if (entry.isSummon) {
    assert(entry.summonName, `${owner} isSummon entries must define summonName`);
    assert(entry.summonJob, `${owner} isSummon entries must define summonJob`);
  }
}

function assertSkillDefinition(skillId: string, skill: SkillDefinition): void {
  const owner = `skill ${skillId}`;
  assert(typeof skill.name === 'string' && skill.name.length > 0, `${owner} must have a display name`);
  assertTagExists(skill.tag, owner);
  assertStatusApplications(skill.statusApplications, owner);
  assertSummonStats(skill.stats, owner);
  if (skill.spellBlockMode) assert(VALID_SPELL_BLOCK_MODES.has(skill.spellBlockMode), `${owner}.spellBlockMode is invalid`);
  NUMERIC_SKILL_FIELDS.forEach((field) => {
    const value = getOptionalNumericField(skill, field);
    if (value !== undefined) assertFiniteNumber(value, owner, field);
  });
  if (skill.newSkill) assert(localProject.skills[skill.newSkill], `${owner} grants unknown skill ${skill.newSkill}`);
  if (skill.summonJob) assert(localProject.jobs[skill.summonJob], `${owner} summons unknown job ${skill.summonJob}`);
  if (skill.isSummon) {
    assert(skill.summonName, `${owner} isSummon skills must define summonName`);
    assert(skill.summonJob, `${owner} isSummon skills must define summonJob`);
  }

  if (Array.isArray(skill.pool)) {
    skill.pool.forEach((entry, index) => {
      if (typeof entry === 'string') {
        assert(skill.isRandomText, `${owner}.pool[${index}] is text but the skill is not marked isRandomText`);
        assert(entry.length > 0, `${owner}.pool[${index}] must be non-empty text`);
      } else {
        assertGachaEntry(entry, `${owner}.pool[${index}]`);
      }
    });
  }
}

function assertJobDefinition(jobId: string, job: JobDefinition): void {
  const owner = `job ${jobId}`;
  assert(typeof job.name === 'string' && job.name.length > 0, `${owner} must have a display name`);
  assert(typeof job.icon === 'string' && job.icon.length > 0, `${owner} must have an icon`);
  JOB_NUMERIC_FIELDS.forEach((key) => {
    assertFiniteNumber(job[key], owner, key);
    assert(job[key] > 0, `${owner}.${key} must be positive`);
  });
  assert(Array.isArray(job.skills), `${owner}.skills must be an array`);
  assert(new Set(job.skills).size === job.skills.length, `${owner}.skills must not contain duplicates`);
  job.skills.forEach((skillId) => {
    assert(localProject.skills[skillId], `${owner} references unknown skill ${skillId}`);
  });
}

function isGachaEntryLike(value: unknown): value is GachaEntry {
  return value !== null && typeof value === 'object' && 'text' in value;
}

function assertDataPools(): void {
  Object.entries(localProject.data).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry, index) => {
      if (!isGachaEntryLike(entry)) return;
      assertGachaEntry(entry, `data.${key}[${index}]`);
    });
  });
}

function assertStatusOwnership(): void {
  const chimeraPluginStatuses = new Set(
    (localProject.data.CHIMERA_PLUGIN_POOL ?? [])
      .flatMap((entry) => entry.statusApplications?.map((application) => application.identityId) ?? [])
      .filter((status): status is string => !!status),
  );
  const succubusCounterStatuses = new Set(
    (localProject.data.SUCCUBUS_COUNTER_POOL ?? [])
      .flatMap((entry) => entry.statusApplications?.map((application) => application.identityId) ?? [])
      .filter((status): status is string => !!status),
  );

  const assertOwnedStatus = (status: string | undefined, owner: string): void => {
    if (!status) return;
    if (status.startsWith('PLUG_')) {
      assert(chimeraPluginStatuses.has(status), `${owner} uses chimera plug status ${status} outside CHIMERA_PLUGIN_POOL`);
    }
    if (status.startsWith('CTR_')) {
      assert(succubusCounterStatuses.has(status), `${owner} uses counter stance ${status} outside SUCCUBUS_COUNTER_POOL`);
    }
  };

  Object.entries(localProject.data).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry, index) => {
      if (!isGachaEntryLike(entry)) return;
      const owner = `data.${key}[${index}]`;
      if (key === 'CHIMERA_PLUGIN_POOL' || key === 'SUCCUBUS_COUNTER_POOL') return;
      entry.statusApplications?.forEach((application) => assertOwnedStatus(application.identityId, owner));
    });
  });

  Object.entries(localProject.skills).forEach(([skillId, skill]) => {
    const owner = `skill ${skillId}`;
    if (skillId === 'chimera_install' || skillId === 'succubus_counter') return;
    skill.statusApplications?.forEach((application) => assertOwnedStatus(application.identityId, owner));
    if (Array.isArray(skill.pool)) {
      skill.pool.forEach((entry, index) => {
        if (typeof entry === 'string') return;
        entry.statusApplications?.forEach((application) => assertOwnedStatus(application.identityId, `${owner}.pool[${index}]`));
      });
    }
  });
}

function assertExclusiveSkillOwnership(): void {
  const exclusiveSkills = new Map<string, Set<string>>([
    ['bujin_chair', new Set(['MIRACLE_BUJIN'])],
    ['rainbow_fever', new Set(['MIRACLE_MONSTER_BUJIN'])],
    ['chimera_install', new Set(['CHIMERA'])],
    ['spinal_slash', new Set(['RED_FURY_SAMURAI', 'EXPLOSIVE_ANTI_CROC', 'GRUDGE_SUICIDER'])],
    ['slacking', new Set(['VIRTUAL_DIVA', 'VALO_JUNIOR', 'MY_BABY', 'Q_BUNNY', 'VERSATILE_RABBIT'])],
    ['summon_puppet_ting', new Set()],
    ['great_monster_victory', new Set()],
  ]);

  Object.entries(localProject.jobs).forEach(([jobId, job]) => {
    if (!job) return;
    job.skills.forEach((skillId) => {
      const allowedJobs = exclusiveSkills.get(skillId);
      if (!allowedJobs) return;
      assert(allowedJobs.has(jobId), `exclusive skill ${skillId} should not be on job ${jobId}`);
    });
  });
}

function assertSpecialMappings(): void {
  const expected = new Map<string, string>([
    ['水人', 'SLIME'],
    ['玄凝', 'HIGH_END_GAMER'],
    ['小汀', 'RED_FURY_SAMURAI'],
    ['牢鳄', 'GACHA_ADDICT'],
    ['克蕾儿丝菲尔', 'SUCCUBUS'],
    ['丝瓜uli', 'VIRTUAL_DIVA'],
    ['兔卷卷', 'Q_BUNNY'],
    ['刺猬人', 'TOKU_FAN'],
    ['屑', 'JOKE_KING'],
    ['M1A2_abrams_sep', 'WT_GRINDER'],
    ['表情', 'EMOTE_MAHORAGA'],
    ['柚子', 'YUZU_MIRROR_PARENT'],
    ['鸮', 'OWL_HEAVEN_AVATAR'],
    ['萌月沫沫', 'MOMO_BUBBLE_GOD'],
  ]);
  expected.forEach((jobId, name) => {
    assert(makeFighter(name).job === jobId, `${name} should map to ${jobId}`);
    assert(localProject.jobs[jobId], `${name} maps to missing job ${jobId}`);
  });
}

export function runRuleContractCases(): string[] {
  Object.entries(localProject.skills).forEach(([skillId, skill]) => assertSkillDefinition(skillId, skill));
  Object.entries(localProject.jobs).forEach(([jobId, job]) => {
    assert(job, `job ${jobId} must be registered`);
    assertJobDefinition(jobId, job);
  });
  assertDataPools();
  assertStatusOwnership();
  assertExclusiveSkillOwnership();
  assertSpecialMappings();

  return [
    'all jobs reference registered skills',
    'all skills and pool entries reference registered tags/statuses/jobs',
    'exclusive status prefixes stay in their owning systems',
    'exclusive special skills stay on their allowed owners',
    'special fighter names map to registered starter jobs',
  ];
}
