/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the real route and payload normalizer in memory. No server, SQLite,
// network, real credentials, generated files, or additional dependencies are used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const CACHE_KEY = 'bilibili.last_success.v2';
const SOURCE_A = 'https://old-proxy.example/api?mid=123';
const SOURCE_B = 'https://new-proxy.example/api?mid=123&page_size=15';
const NOW = Date.parse('2026-09-09T12:00:00Z');
const sourceKey = (url) => crypto.createHash('sha256').update(url).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(label, count = 24) {
  return {
    success: true,
    user: { name: `Fixture ${label}`, fans: 42, is_live: false, face: 'https://i0.hdslb.com/fixture.jpg' },
    // Deliberately oldest first: the actual helper must sort before limiting.
    videos: Array.from({ length: count }, (_, index) => ({
      title: `${label}-${index}`, pic: 'https://i0.hdslb.com/fixture.jpg',
      url: `https://www.bilibili.com/video/BVfixture${index}`,
      pubdate: 1_788_912_000 + index * 60, length: 61, play: index,
    })),
  };
}
const envelope = (url, label, age = 240_000, count = 24) => ({
  sourceKey: sourceKey(url), fetchedAt: NOW - age, data: fixture(label, count),
});
const upstream = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => clone(data),
});

const compiled = new Map();
for (const filename of ['app/api/bilibili/route.ts', 'lib/bilibili-payload.ts']) {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${filename}: TypeScript transpilation failed`);
  compiled.set(filename, result.outputText);
}

function harness({ url = SOURCE_B, rows = [], cache, fetch: implementation } = {}) {
  let now = NOW;
  let nextTimer = 0;
  const timers = new Map();
  const records = new Map(rows);
  const calls = { fetch: [], get: [], run: [], warnings: [] };
  let fetchImplementation = implementation || (() => upstream(fixture('fresh')));
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const db = {
    async get(sql, values) {
      assert.match(sql, /SELECT value FROM global_config WHERE key = \?/);
      calls.get.push([...values]);
      return records.has(values[0]) ? { value: records.get(values[0]) } : undefined;
    },
    async run(sql, values) {
      assert.match(sql, /INSERT INTO global_config/);
      assert.match(sql, /ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value/);
      assert.equal(values.length, 2);
      calls.run.push({ sql, values: [...values] });
      records.set(values[0], values[1]);
    },
  };
  const context = vm.createContext({
    process: { env: { BILIBILI_API_URL: url } },
    Date: Clock, URL, AbortController,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    console: { warn: (...args) => calls.warnings.push(args) },
    fetch: async (requestedUrl, options) => {
      calls.fetch.push({ url: requestedUrl, options });
      return fetchImplementation(requestedUrl, options);
    },
  });
  if (cache) context.__bilibiliCache = clone(cache);
  const modules = new Map();
  function load(filename, fresh = false) {
    if (!fresh && modules.has(filename)) return modules.get(filename);
    const loaded = { exports: {} };
    const requireStub = (name) => {
      if (name === 'node:crypto') return crypto;
      if (name === '@/lib/db') return db;
      if (name === '@/lib/bilibili-payload') return load('lib/bilibili-payload.ts');
      if (name === 'next/server') return { NextResponse: {
        json(data, init = {}) {
          return { status: init.status || 200, headers: new Headers(init.headers), json: async () => clone(data) };
        },
      } };
      throw new Error(`Unexpected route dependency: ${name}`);
    };
    const wrapper = new vm.Script(`(function(exports, require, module) {\n${compiled.get(filename)}\n})`, { filename });
    wrapper.runInContext(context)(loaded.exports, requireStub, loaded);
    modules.set(filename, loaded.exports);
    return loaded.exports;
  }
  return {
    context, records, calls, timers,
    route: load('app/api/bilibili/route.ts'),
    reload(nextUrl) {
      context.process.env.BILIBILI_API_URL = nextUrl;
      return load('app/api/bilibili/route.ts', true);
    },
    setFetch(next) { fetchImplementation = next; },
    advance(milliseconds) { now += milliseconds; },
    fireTimeout() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'an upstream timeout must be scheduled');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    async waitForFetch(count) {
      for (let attempt = 0; calls.fetch.length < count && attempt < 30; attempt++) await tick();
      assert.equal(calls.fetch.length, count, 'expected upstream attempts to have started');
    },
    async idle() {
      await context.__bilibiliRefresh?.promise.catch(() => {});
      await tick();
      assert.equal(timers.size, 0, 'completed upstream attempts must clear their timers');
    },
  };
}

async function assertVideos(response, label, count = 24, cacheHeader) {
  assert.equal(response.status, 200);
  if (cacheHeader) assert.equal(response.headers.get('x-uliuli-cache'), cacheHeader);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.user.name, `Fixture ${label}`);
  assert.equal(data.user.fans, 42);
  assert.equal(data.user.is_live, false);
  assert.equal(data.videos.length, Math.min(count, 15));
  assert.equal(data.video_count, Math.min(count, 15));
  assert.deepEqual(data.videos.map((video) => video.title),
    Array.from({ length: Math.min(count, 15) }, (_, index) => `${label}-${count - index - 1}`));
  return data;
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('legacy cache is ignored; fresh results use one atomic source-tagged envelope', async () => {
  const legacy = JSON.stringify(fixture('legacy'));
  const h = harness({ rows: [['bilibili.last_success', legacy], ['bilibili.last_success_at', '2020-01-01'], ['site.sentinel', 'unchanged']] });
  await assertVideos(await h.route.GET(), 'fresh', 24, 'upstream');
  await h.idle();
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.fetch[0].url, SOURCE_B);
  assert.equal(h.calls.fetch[0].options.cache, 'no-store');
  assert.ok(h.calls.get.every(([key]) => key === CACHE_KEY));
  assert.equal(h.calls.run.length, 1);
  assert.equal(h.calls.run[0].values[0], CACHE_KEY);
  const saved = JSON.parse(h.records.get(CACHE_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['data', 'fetchedAt', 'sourceKey']);
  assert.equal(saved.sourceKey, sourceKey(SOURCE_B));
  assert.equal(saved.fetchedAt, NOW);
  assert.equal(saved.data.videos.length, 15);
  assert.equal(h.records.get('bilibili.last_success'), legacy);
  assert.equal(h.records.get('site.sentinel'), 'unchanged');
});

test('a different source cannot reuse memory, persisted cache, or refresh backoff', async () => {
  const old = envelope(SOURCE_A, 'old');
  const h = harness({ rows: [[CACHE_KEY, JSON.stringify(old)]], cache: old });
  h.context.__bilibiliRefreshBlockedUntil = { sourceKey: sourceKey(SOURCE_A), until: NOW + 90_000 };
  await assertVideos(await h.route.GET(), 'fresh', 24, 'upstream');
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(JSON.parse(h.records.get(CACHE_KEY)).sourceKey, sourceKey(SOURCE_B));
  await h.idle();
});

test('new source failure returns 502 and retains the old source cache without serving it', async () => {
  const saved = JSON.stringify(envelope(SOURCE_A, 'old'));
  const h = harness({ rows: [[CACHE_KEY, saved]], fetch: () => upstream({}, 503) });
  const response = await h.route.GET();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { success: false, error: 'Bilibili upstream unavailable' });
  assert.equal(h.calls.fetch.length, 2);
  assert.equal(h.calls.run.length, 0);
  assert.equal(h.records.get(CACHE_KEY), saved);
  await h.idle();
});

test('same-source persisted data is normalized before stale delivery and survives failed refresh', async () => {
  const saved = JSON.stringify(envelope(SOURCE_B, 'retained'));
  const h = harness({ rows: [[CACHE_KEY, saved]], fetch: () => upstream({}, 503) });
  const data = await assertVideos(await h.route.GET(), 'retained', 24, 'db-stale');
  assert.equal(data.stale, true);
  assert.equal(data.staleAt, new Date(NOW - 240_000).toISOString());
  await h.idle();
  assert.equal(h.calls.fetch.length, 2);
  assert.equal(h.calls.run.length, 0);
  assert.equal(h.records.get(CACHE_KEY), saved);
  await assertVideos(await h.route.GET(), 'retained', 24, 'memory-stale');
  assert.equal(h.calls.fetch.length, 2, 'refresh backoff avoids a new attempt');
  h.advance(60_001);
  h.setFetch(() => upstream(fixture('recovered', 7)));
  await assertVideos(await h.route.GET(), 'retained', 24, 'memory-stale');
  await h.idle();
  const recovered = await assertVideos(await h.route.GET(), 'recovered', 7, 'memory-hit');
  assert.equal(recovered.stale, undefined);
  assert.equal(h.calls.run.length, 1);
});

test('fresh memory data is normalized to 15 without network or database access', async () => {
  const h = harness({ cache: envelope(SOURCE_B, 'memory', 1_000) });
  await assertVideos(await h.route.GET(), 'memory', 24, 'memory-hit');
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.get.length, 0);
  assert.equal(h.calls.run.length, 0);
});

test('concurrent cold requests share one actual upstream attempt and one cache write', async () => {
  const pending = deferred();
  const h = harness({ fetch: () => pending.promise });
  const requests = Array.from({ length: 20 }, () => h.route.GET());
  await h.waitForFetch(1);
  pending.resolve(upstream(fixture('coalesced')));
  for (const response of await Promise.all(requests)) await assertVideos(response, 'coalesced', 24, 'upstream');
  assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.calls.run.length, 1);
  await h.idle();
});

test('concurrent stale requests share background refresh and retain their immediate stale result', async () => {
  const pending = deferred();
  const h = harness({ cache: envelope(SOURCE_B, 'previous'), fetch: () => pending.promise });
  const responses = await Promise.all(Array.from({ length: 12 }, () => h.route.GET()));
  for (const response of responses) await assertVideos(response, 'previous', 24, 'memory-stale');
  assert.equal(h.calls.fetch.length, 1);
  pending.resolve(upstream(fixture('background')));
  await h.idle();
  await assertVideos(await h.route.GET(), 'background', 24, 'memory-hit');
  assert.equal(h.calls.run.length, 1);
});

test('HTTP 200 malformed and failed payloads are rejected without poisoning cache', async () => {
  for (const invalid of [{}, { success: false }, { success: true, user: {}, videos: [] }, { success: true, user: { fans: 1 }, videos: [{}] }]) {
    const h = harness({ fetch: () => upstream(invalid) });
    assert.equal((await h.route.GET()).status, 502);
    assert.equal(h.calls.fetch.length, 2);
    assert.equal(h.calls.run.length, 0);
    assert.equal(h.records.has(CACHE_KEY), false);
    assert.equal(h.context.__bilibiliCache, undefined);
    await h.idle();
  }
});

test('invalid background payload cannot replace the last usable memory or database result', async () => {
  const good = envelope(SOURCE_B, 'good');
  const saved = JSON.stringify(good);
  const h = harness({ rows: [[CACHE_KEY, saved]], cache: good, fetch: () => upstream({}) });
  await assertVideos(await h.route.GET(), 'good', 24, 'memory-stale');
  await h.idle();
  assert.equal(h.calls.fetch.length, 2);
  assert.equal(h.records.get(CACHE_KEY), saved);
  assert.equal(h.context.__bilibiliCache.data.user.name, 'Fixture good');
  assert.equal(h.calls.run.length, 0);
});

test('empty video lists are valid and do not manufacture stale videos', async () => {
  const h = harness({ fetch: () => upstream(fixture('empty', 0)) });
  await assertVideos(await h.route.GET(), 'empty', 0, 'upstream');
  assert.equal(JSON.parse(h.records.get(CACHE_KEY)).data.video_count, 0);
  await h.idle();
});

test('malformed JSON, invalid timestamps, and unusable persisted payloads trigger a fresh fetch', async () => {
  for (const value of ['{', JSON.stringify({ ...envelope(SOURCE_B, 'bad'), fetchedAt: 0 }), JSON.stringify({ ...envelope(SOURCE_B, 'bad'), data: {} })]) {
    const h = harness({ rows: [[CACHE_KEY, value]] });
    await assertVideos(await h.route.GET(), 'fresh', 24, 'upstream');
    assert.equal(h.calls.fetch.length, 1);
    await h.idle();
  }
});

test('timeout aborts both attempts, returns 502, and clears the scheduled timers', async () => {
  const h = harness({ fetch: (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('fixture timeout')), { once: true });
  }) });
  const pending = h.route.GET();
  await h.waitForFetch(1);
  h.fireTimeout();
  await h.waitForFetch(2);
  h.fireTimeout();
  assert.equal((await pending).status, 502);
  assert.equal(h.calls.run.length, 0);
  await h.idle();
});

test('an old in-flight source cannot overwrite a newer module cache or persisted envelope', async () => {
  const first = deferred();
  const h = harness({ url: SOURCE_A, fetch: (url) => url === SOURCE_A ? first.promise : upstream(fixture('new-module')) });
  const oldRequest = h.route.GET();
  await h.waitForFetch(1);
  const nextModule = h.reload(SOURCE_B);
  await assertVideos(await nextModule.GET(), 'new-module', 24, 'upstream');
  const saved = h.records.get(CACHE_KEY);
  first.resolve(upstream(fixture('old-module')));
  await assertVideos(await oldRequest, 'old-module', 24, 'upstream');
  await assertVideos(await nextModule.GET(), 'new-module', 24, 'memory-hit');
  assert.equal(h.records.get(CACHE_KEY), saved);
  assert.equal(h.calls.run.length, 1);
  assert.equal(h.context.__bilibiliCache.sourceKey, sourceKey(SOURCE_B));
  await h.idle();
});

test('an old source finishing while the new source is pending cannot clear its shared refresh', async () => {
  const first = deferred();
  const second = deferred();
  const h = harness({ url: SOURCE_A, fetch: (url) => url === SOURCE_A ? first.promise : second.promise });
  const oldRequest = h.route.GET();
  await h.waitForFetch(1);
  const nextModule = h.reload(SOURCE_B);
  const newRequest = nextModule.GET();
  await h.waitForFetch(2);
  first.resolve(upstream(fixture('old-module')));
  await oldRequest;
  assert.equal(h.calls.run.length, 0);
  assert.equal(h.context.__bilibiliRefresh.sourceKey, sourceKey(SOURCE_B));
  const anotherRequest = nextModule.GET();
  await tick();
  assert.equal(h.calls.fetch.length, 2);
  second.resolve(upstream(fixture('new-module')));
  await assertVideos(await newRequest, 'new-module', 24, 'upstream');
  await assertVideos(await anotherRequest, 'new-module', 24, 'upstream');
  assert.equal(h.calls.run.length, 1);
  await h.idle();
});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  }
  console.log(`Bilibili route: ${passed}/${tests.length} groups passed (Node ${process.versions.node}; actual TypeScript route/helper; synthetic data only).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
