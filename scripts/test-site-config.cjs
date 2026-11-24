/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTsModule(relPath) {
  const fullPath = path.join(root, relPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: relPath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(errors.length, 0, `${relPath} transpilation failed`);

  const mod = { exports: {} };
  const fn = new vm.Script(
    `(function(exports, require, module) {\n${transpiled.outputText}\n})`,
    { filename: relPath },
  );
  fn.runInThisContext()(mod.exports, require, mod);
  return mod.exports;
}

const {
  DEFAULT_SITE_CONFIG,
  sanitizeEditableSiteConfig,
  withRuntimeSiteConfig,
} = loadTsModule('lib/site-config.ts');

// 1. Live production-like sparse config with accidental empty strings & runtime fields
const sparseProductionConfig = {
  hero: {
    code: 'PROJECT CODE: SIGUAULI',
    title: '“大家好。初次入梦，幸会”',
    followersText: '',
  },
  api: { bilibili: 'https://legacy.example/api' },
  model: {
    credits: [
      {
        label: 'OWNER',
        val: [{ name: '丝瓜ULI', link: '' }],
      },
    ],
  },
  live: {
    title: '直播状态',
    rules: ['优先点歌单内的歌曲', '  ', '舰长 无限点歌'],
  },
  games: {
    migratingTitle: 'DEAD FIELD',
    migratingDesc: 'DEAD FIELD',
  },
  notifications: {
    modelClicked: '',
    alreadyUnlocked: '',
    clickWarning: '',
    systemInitializing: 'DEAD FIELD',
  },
  activeTopics: [{ slug: 'x', title: 'X', description: null, startsAt: null, endsAt: null }],
  mailEnabled: false,
};

const sanitized = sanitizeEditableSiteConfig(sparseProductionConfig);

assert.equal(sanitized.hero.code, 'PROJECT CODE: SIGUAULI');
assert.equal(sanitized.hero.followersText, DEFAULT_SITE_CONFIG.hero.followersText);
assert.equal(sanitized.hero.statusText, DEFAULT_SITE_CONFIG.hero.statusText);
assert.equal(sanitized.hero.statsLoadingText, DEFAULT_SITE_CONFIG.hero.statsLoadingText);
assert.equal(sanitized.live.roomId, DEFAULT_SITE_CONFIG.live.roomId);
assert.equal(sanitized.live.gamePortalText, DEFAULT_SITE_CONFIG.live.gamePortalText);
assert.deepEqual(sanitized.live.rules, ['优先点歌单内的歌曲', '舰长 无限点歌']);
assert.equal(sanitized.model.credits[0].val[0].link, '', 'optional credit link may stay empty');
assert.equal(sanitized.notifications.modelClicked, DEFAULT_SITE_CONFIG.notifications.modelClicked);
assert.equal(sanitized.notifications.clickWarning, DEFAULT_SITE_CONFIG.notifications.clickWarning);
assert.equal(sanitized.song_ui.copyCommandPrefix, '点歌');
assert.equal(sanitized.mail.senderTitle, 'MAIL_BOX');
assert.equal(sanitized.seo.title, DEFAULT_SITE_CONFIG.seo.title);
assert.equal(sanitized.pwa.installTitle, DEFAULT_SITE_CONFIG.pwa.installTitle);
assert.equal(sanitized.offline.retryButton, DEFAULT_SITE_CONFIG.offline.retryButton);
assert.equal(sanitized.errors.retryText, DEFAULT_SITE_CONFIG.errors.retryText);

// Runtime derived & dead fields must be stripped from editable config
assert.equal('activeTopics' in sanitized, false);
assert.equal('mailEnabled' in sanitized, false);
assert.equal('api' in sanitized, false);
assert.equal('migratingTitle' in sanitized.games, false);
assert.equal('migratingDesc' in sanitized.games, false);
assert.equal('systemInitializing' in sanitized.notifications, false);

// 2. Runtime wrapper re-attaches /api/bilibili and live mail state without mutating editable
const runtime = withRuntimeSiteConfig(sanitized, {
  activeTopics: [{ slug: 't1', title: 'T1', description: null, startsAt: null, endsAt: null }],
  mailEnabled: false,
});
assert.equal(runtime.api.bilibili, '/api/bilibili');
assert.equal(runtime.mailEnabled, false);
assert.equal(runtime.activeTopics.length, 1);
assert.equal('activeTopics' in sanitized, false);

// 3. Explicit empty arrays on editable lists are preserved (delete-all works)
const clearedLists = sanitizeEditableSiteConfig({
  model: { details: [], credits: [] },
  live: { rules: [], links: [] },
  seo: { keywords: ['  丝瓜 ', '丝瓜', '', 'UliUli'] },
});
assert.deepEqual(clearedLists.model.details, []);
assert.deepEqual(clearedLists.model.credits, []);
assert.deepEqual(clearedLists.live.rules, []);
assert.deepEqual(clearedLists.live.links, []);
assert.deepEqual(clearedLists.seo.keywords, ['丝瓜', 'UliUli']);

// 4. Static audit on AdminTabContent.tsx to prevent regressions
const adminTabSource = fs.readFileSync(
  path.join(root, 'app/admin/components/AdminTabContent.tsx'),
  'utf8',
);
assert.equal(
  /updateNested\("song_ui",\s*"[^"]+",\s*""/.test(adminTabSource),
  false,
  'song_ui inputs must use updateConfig instead of broken updateNested(..., "")',
);
assert.equal(
  /value=\{config\.[^}]+\|\|\s*"[^"]+"/.test(adminTabSource),
  false,
  'AdminTabContent must not hardcode non-empty fallback strings inside controlled value={... || "..."}',
);

console.log('PASS site-config schema, sanitization, runtime fields, and AdminTabContent guards.');
