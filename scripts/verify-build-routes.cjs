/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Inspect build metadata only: never import route modules or open a database.
const directory = process.env.WINDCHIME_BUILD_DIRECTORY?.trim() || '.next';
assert(directory === '.next' || /^\.windchime-[A-Za-z0-9_-]+$/.test(directory),
  'Invalid Next.js build directory');
const buildRoot = path.resolve(__dirname, '..', directory);
const readJson = file => JSON.parse(fs.readFileSync(path.join(buildRoot, file), 'utf8'));

const prerender = readJson('prerender-manifest.json');
const appPaths = readJson('server/app-paths-manifest.json');
const routes = readJson('app-path-routes-manifest.json');

assert(prerender.routes && typeof prerender.routes === 'object', 'Missing prerender routes');
assert(!Object.hasOwn(prerender.routes, '/'),
  'Homepage must remain dynamic; a static / may mean it was replaced by /app during compilation');
assert.equal(routes['/page'], '/', 'Missing homepage route');
assert.equal(routes['/app/page'], '/app', 'Missing separate App Hub route');
assert.equal(typeof appPaths['/page'], 'string', 'Missing homepage entry');
assert.equal(typeof appPaths['/app/page'], 'string', 'Missing App Hub entry');
assert.notEqual(appPaths['/page'], appPaths['/app/page'],
  'Homepage and App Hub must have separate build entries');

const serverRoot = path.join(buildRoot, 'server');
const entryDigest = entry => {
  const filename = path.resolve(serverRoot, entry);
  const relative = path.relative(serverRoot, filename);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Build entry must stay within the server directory');
  const bytes = fs.readFileSync(filename);
  assert(bytes.length > 0, 'Build entry is empty');
  return crypto.createHash('sha256').update(bytes).digest('hex');
};
assert.notEqual(entryDigest(appPaths['/page']), entryDigest(appPaths['/app/page']),
  'Homepage and App Hub must not contain identical compiled entries');

// Do not print the full prerender manifest: it also contains signing secrets.
console.log('Next.js routes verified: / is dynamic; / and /app have separate compiled entries.');
