/* eslint-disable @typescript-eslint/no-require-imports -- Node 20 CommonJS test runner. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile this pure module in memory. No builds, network, dependencies, or temp files.
const filename = path.join(__dirname, '../lib/bilibili-payload.ts');
const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = { exports: {} };
vm.runInThisContext(`(function(module, exports) { ${javascript}\n})`, { filename })(compiled, compiled.exports);
const { normalizeBilibiliPayload: normalize, LATEST_BILIBILI_VIDEO_LIMIT } = compiled.exports;

const user = { name: 'Public creator', fans: 42, is_live: false, live_title: 'Public live title' };
function video(index, extra = {}) {
  return {
    title: `Video ${index}`, pic: `https://i0.hdslb.com/${index}.jpg`,
    url: `https://www.bilibili.com/video/BVtest${index}`, bvid: `BVtest${index}`,
    length: '04:32', date: '2026-09-09', play: index, ...extra,
  };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

test('latest fifteen use precise publication seconds, sort before limiting, and never mutate input', () => {
  const order = [4, 19, 7, 2, 17, 0, 18, 1, 13, 5, 16, 8, 12, 9, 3, 15, 6, 14, 11, 10];
  const input = freeze({ success: true, user: { ...user }, videos: order.map((index) => video(index, { created: 1788912000 + index })) });
  const before = JSON.stringify(input);
  const result = normalize(input);
  assert.equal(LATEST_BILIBILI_VIDEO_LIMIT, 15);
  assert.equal(result.video_count, 15);
  assert.deepEqual(result.videos.map((item) => item.title), Array.from({ length: 15 }, (_, index) => `Video ${19 - index}`));
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(result.videos, input.videos);
  assert.notEqual(result.user, input.user);
  assert.ok(result.videos.every((item) => item.date === '2026-09-09'));
});

test('seconds, milliseconds and numeric strings retain ordering within the same displayed day', () => {
  const result = normalize({ user, videos: [
    video('older', { created: 1788912001, date: '2099-01-01' }),
    video('newer', { created: '1788912002500' }),
    video('middle', { created: null, pubdate: '1788912002' }),
  ] });
  assert.deepEqual(result.videos.map((item) => item.title), ['Video newer', 'Video middle', 'Video older']);
  assert.deepEqual(result.videos.map((item) => item.created), [1788912002.5, 1788912002, 1788912001]);
  assert.equal(result.videos[2].date, '2026-09-09');
});

test('equal timestamps and missing dates keep their original order; missing dates are last', () => {
  const result = normalize({ user, videos: [
    video('missing-a', { date: null }), video('same-a', { created: 1788912000 }),
    video('missing-b', { date: 'not a date' }), video('same-b', { created: 1788912000 }),
    video('invalid-calendar', { date: '2026-02-30' }),
  ] });
  assert.deepEqual(result.videos.map((item) => item.title), [
    'Video same-a', 'Video same-b', 'Video missing-a', 'Video missing-b', 'Video invalid-calendar',
  ]);
  assert.equal(result.videos[2].date, '');
  assert.equal(result.videos[2].created, undefined);
});

test('legacy local dates and ISO offsets are displayed in Asia/Shanghai without machine-timezone dependence', () => {
  const result = normalize({ success: true, user, videos: [
    video('iso', { date: '2026-08-08T18:05:00.000Z' }),
    video('legacy', { date: '2026/8/8' }),
    video('local-time', { date: '2026-08-09 02:05:01' }),
    video('offset', { date: '2026-08-09T02:05:02+08:00' }),
  ] });
  assert.deepEqual(result.videos.map((item) => item.title), ['Video offset', 'Video local-time', 'Video iso', 'Video legacy']);
  assert.deepEqual(result.videos.map((item) => item.date), ['2026-08-09', '2026-08-09', '2026-08-09', '2026-08-08']);
  assert.equal(result.videos[3].created, Date.parse('2026-08-08T00:00:00+08:00') / 1000);
});

test('duration seconds use MM:SS/HH:MM:SS and old formatted strings remain intact', () => {
  const lengths = [272, 12133, 0, '9', '4:32', '01:02:03', '89:59', {}, null];
  const result = normalize({ user, videos: lengths.map((length, index) => video(index, { length })) });
  assert.deepEqual(result.videos.map((item) => item.length), ['04:32', '03:22:13', '00:00', '00:09', '4:32', '01:02:03', '89:59', '', '']);
});

test('sections-only schema maps profile/live and cover/duration/created_at', () => {
  const input = {
    success: true, partial: true, version: '3.2.0',
    sections: {
      profile: { ok: true, data: {
        profile: { name: 'Creator', avatar: 'https://i0.hdslb.com/avatar.jpg' },
        statistics: { followers: 0, following: 17 },
        live: { is_live: true, title: 'Stream', url: 'https://live.bilibili.com/1', cover: 'https://i0.hdslb.com/live.jpg', area: 'Singer', parent_area: 'Virtual' },
      } },
      videos: { ok: true, data: { items: [{ title: 'Section video', cover: '//i0.hdslb.com/cover.jpg', bvid: 'BVsection', duration: 61, created_at: '2026-08-08T18:00:00Z' }] } },
      dynamics: { ok: false, error: { message: 'Optional section unavailable' } },
    },
  };
  const before = JSON.stringify(input);
  const result = normalize(freeze(input));
  assert.deepEqual(result.user, { name: 'Creator', face: 'https://i0.hdslb.com/avatar.jpg', fans: 0, attention: 17, is_live: true, live_title: 'Stream', live_url: 'https://live.bilibili.com/1', live_cover: 'https://i0.hdslb.com/live.jpg', live_area: 'Singer', live_area_parent: 'Virtual' });
  assert.equal(result.partial, true);
  assert.equal(result.videos[0].pic, 'https://i0.hdslb.com/cover.jpg');
  assert.equal(result.videos[0].length, '01:01');
  assert.equal(result.videos[0].date, '2026-08-09');
  assert.equal(result.videos[0].url, 'https://www.bilibili.com/video/BVsection');
  assert.equal(JSON.stringify(input), before);
});

test('legacy cache shape remains usable and absent followers are never fabricated', () => {
  const result = normalize({ user: { name: 'Creator', is_live: false, live_title: 'Preserved' }, videos: [video(1)], stale: true });
  assert.equal(result.success, true);
  assert.equal(result.stale, true);
  assert.equal('fans' in result.user, false);
  assert.equal(result.user.live_title, 'Preserved');
  assert.equal(result.videos[0].length, '04:32');
  const nullFans = normalize({ user: { name: 'Creator', fans: null }, videos: [] });
  assert.equal(nullFans.user.fans, null);
  assert.equal(nullFans.video_count, 0);
});

test('malformed videos are omitted instead of crashing pic.replace; all-malformed is a failure', () => {
  const input = { user, videos: [null, {}, video(1, { pic: 42 }), video(2, { title: [] }), video(3, { url: 'javascript:alert(1)', bvid: null }), video(4)] };
  const result = normalize(input);
  assert.deepEqual(result.videos.map((item) => item.title), ['Video 4']);
  assert.equal(result.partial, true);
  assert.doesNotThrow(() => result.videos.forEach((item) => item.pic.replace(/^http:/, 'https:')));
  assert.throws(() => normalize({ user, videos: [null, {}] }), /no usable videos/);
});

test('HTTP 200 failure objects and failed required sections never become a success cache', () => {
  const invalid = [null, [], {}, { error: 'failed' }, { success: true }, { success: false, user, videos: [] },
    { user: {}, videos: [] }, { user, videos: null },
    { success: true, user, videos: [], sections: { profile: { ok: false }, videos: { ok: false } } },
    { success: true, partial: true, user, videos: [], sections: { profile: { ok: true }, videos: { ok: false } } },
    { success: true, partial: true, user, videos: [video(1)], sections: { profile: { ok: true }, videos: { ok: false } } },
    { success: true, user, videos: [], sections: { profile: { ok: false }, videos: { ok: true, data: { items: [] } } } },
  ];
  for (const payload of invalid) assert.throws(() => normalize(payload), /Unusable Bilibili payload/);
});

test('a successful explicit empty submission list is allowed', () => {
  const result = normalize({ success: true, user, videos: [], sections: { profile: { ok: true }, videos: { ok: true, data: { items: [] } } } });
  assert.deepEqual(result.videos, []);
  assert.equal(result.video_count, 0);
});

test('successful section items take precedence over an empty legacy alias and normalization is idempotent', () => {
  const result = normalize({ success: true, user, videos: [], sections: {
    profile: { ok: true },
    videos: { ok: true, data: { items: [video(1, { created: 1788912000123, length: 272 })] } },
  } });
  assert.equal(result.video_count, 1);
  assert.equal(result.videos[0].created, 1788912000.123);
  assert.deepEqual(normalize(result), result);
});

test('optional captured real upstream response matches the current public proxy schema', { skip: !process.env.BILIBILI_PAYLOAD_FIXTURE }, () => {
  const fixture = JSON.parse(fs.readFileSync(process.env.BILIBILI_PAYLOAD_FIXTURE, 'utf8'));
  const result = normalize(freeze(fixture));
  assert.equal(result.success, true);
  assert.equal(result.video_count, 15);
  assert.deepEqual(result.user, fixture.user);
  assert.equal(result.videos[0].bvid, fixture.videos[0].bvid);
  assert.equal(result.videos[0].length, '04:32');
  assert.equal(result.videos[2].date, '2026-07-28');
  assert.equal(result.videos[3].length, '03:22:13');
  assert.ok(result.videos.every((item, index) => !index || result.videos[index - 1].created >= item.created));
});
