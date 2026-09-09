import assert from "node:assert/strict";
import { createWindChimeClient } from "@windchime/embed/client";

// Run only against a disposable local database, after starting the website.
const base = process.env.MAIL_SMOKE_BASE_URL || "http://localhost:3011";
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname) ||
  process.env.MAIL_SMOKE_ALLOW_WRITES !== "1"
) {
  throw new Error(
    "Use a disposable local database and set MAIL_SMOKE_ALLOW_WRITES=1.",
  );
}
const password = process.env.MAIL_SMOKE_PASSWORD;
assert(
  password,
  "Set MAIL_SMOKE_PASSWORD to the local server administrator password.",
);
const sessionUrl = `${base}/api/mail/session`;
const response = await fetch(sessionUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
assert.equal(response.status, 200, "original website login");
const cookies = response.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
assert(cookies, "HttpOnly session cookie issued");
const admin = createWindChimeClient({
  baseUrl: `${base}/api/mail`,
  getHeaders: () => ({ cookie: cookies }),
});
const publicClient = createWindChimeClient({ baseUrl: `${base}/api/mail` });
await assert.rejects(
  publicClient.messages.list(),
  (error) => error.status === 401,
);
const headerClient = createWindChimeClient({
  baseUrl: `${base}/api/mail`,
  getHeaders: () => ({ "x-mail-password": password }),
});
assert(
  Array.isArray((await headerClient.topics.list()).items),
  "legacy password header",
);
const suffix = `${Date.now()}`;
const secretNote = `PRIVATE-NOTE-${suffix}`;
const termsBefore = (await admin.blockedTerms.get()).terms;
const created = [];
const blocked = [];
try {
  const topicA = await admin.topics.create({
    slug: `smoke-a-${suffix}`,
    title: "Smoke A",
    note: secretNote,
  });
  created.push(topicA.id);
  const topicB = await admin.topics.create({
    slug: `smoke-b-${suffix}`,
    title: "Smoke B",
  });
  created.push(topicB.id);
  const publicTopics = await publicClient.topics.list();
  for (const topic of publicTopics.items)
    for (const field of ["note", "unreadCount", "flaggedCount"])
      assert.equal(field in topic, false, `public ${field}`);
  const publicTopic = await publicClient.topics.get(topicA.slug);
  assert.equal("note" in publicTopic, false);
  const html = await (await fetch(`${base}/m/${topicA.slug}`)).text();
  assert(!html.includes(secretNote), "SSR excludes internal notes");
  await admin.topics.update(topicA.id, { isEnabled: false });
  const pausedHtml = await (await fetch(`${base}/m/${topicA.slug}`)).text();
  assert(pausedHtml.includes("（暂停中）"), "disabled topic remains a paused page, not an ended activity");
  await admin.topics.update(topicA.id, { isEnabled: true });

  await admin.blockedTerms.set([...termsBefore, `flag-${suffix}`]);
  await publicClient.messages.submit({
    topicSlug: topicA.slug,
    text: "Normal A",
    senderFingerprint: `normal-${suffix}`,
  });
  await publicClient.messages.submit({
    topicSlug: topicB.slug,
    text: `flag-${suffix}`,
    senderFingerprint: `flagged-${suffix}`,
  });
  const normal = (await admin.messages.list({ topicId: topicA.id })).items[0];
  assert(normal);
  const flagged = (
    await admin.messages.list({ topicId: topicB.id, filter: "flagged" })
  ).items[0];
  assert(flagged);
  assert.equal(flagged.text, "", "flagged list redacts original");
  assert.equal(
    (await admin.messages.detail(flagged.id, { topicId: topicB.id })).text,
    `flag-${suffix}`,
  );
  await assert.rejects(
    admin.messages.update(normal.id, { isRead: true }, { topicId: topicB.id }),
    (error) => error.status === 404 || error.status === 409,
  );
  await admin.messages.update(
    normal.id,
    { isFavorited: true },
    { topicId: topicA.id },
  );
  assert.equal(
    (await admin.messages.list({ topicId: topicA.id, filter: "favorited" }))
      .counts.favorited,
    1,
  );
  await admin.topics.archive(topicB.id, { markReadFirst: true });
  assert.equal(
    (await admin.messages.detail(flagged.id, { topicId: topicB.id })).isRead,
    false,
    "archive excludes flagged",
  );
  assert.equal(
    (await admin.messages.detail(normal.id, { topicId: topicA.id })).isRead,
    false,
    "archive does not mark another topic",
  );
  await admin.topics.restore(topicB.id);
  await admin.messages.update(
    flagged.id,
    { isFlagged: false },
    { topicId: topicB.id },
  );
  assert.equal(
    (await admin.messages.list({ topicId: topicB.id, filter: "flagged" })).items
      .length,
    0,
  );
  await admin.messages.batch("markRead", [normal.id], { topicId: topicA.id });
  assert.equal(
    (await admin.messages.list({ topicId: topicA.id, filter: "unread" })).items
      .length,
    0,
  );
  await admin.messages.block(normal.id, { topicId: topicA.id });
  const block = (await admin.blocklist.list()).find(
    (item) => item.hash === normal.senderHash,
  );
  assert(block);
  blocked.push(block.hash);
  assert.equal(
    (await admin.messages.list({ topicId: topicA.id })).items.length,
    0,
  );
  await publicClient.messages.submit({
    topicSlug: topicA.slug,
    text: "Silently dropped",
    senderFingerprint: `normal-${suffix}`,
  });
  assert.equal(
    (await admin.messages.list({ topicId: topicA.id })).items.length,
    0,
  );
  await admin.blocklist.unblock(block.hash);
  blocked.splice(blocked.indexOf(block.hash), 1);
  await admin.messages.batch("delete", [flagged.id], { topicId: topicB.id });
  assert.equal(
    (await admin.messages.list({ topicId: topicB.id })).items.length,
    0,
  );
  const enabled = (await admin.settings.get()).enabled;
  await admin.settings.set(enabled);
  const bodyAuth = await fetch(`${base}/api/mail/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, enabled }),
  });
  assert.equal(bodyAuth.status, 200, "legacy JSON body password");

  assert.equal((await publicClient.settings.get()).enabled, enabled);
  console.log(
    "Next_UliUli: original session + legacy auth, public DTO/SSR privacy, submission, inbox filters, topic isolation, favorite, archive/restore, review, batches, block/unblock and settings passed.",
  );
} finally {
  await admin.blockedTerms.set(termsBefore);
  for (const hash of blocked) await admin.blocklist.unblock(hash);
  for (const id of created) {
    await admin.topics.archive(id);
    await admin.topics.purge(id);
  }
  await fetch(sessionUrl, {
    method: "DELETE",
    headers: { cookie: cookies, "content-type": "application/json" },
    body: JSON.stringify({ scope: "mail" }),
  });
}
