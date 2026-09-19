import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWindChimeClient, createWindChimeLiveClient, createWindChimeDisplayClient } from "@windchime/embed/client";

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
const keywordBefore = (await admin.settings.get()).blockedTermsEnabled === true;
const liveAdmin = createWindChimeLiveClient({ baseUrl: `${base}/api/mail/live`, getHeaders: () => ({ cookie: cookies }) });
const grant = await liveAdmin.createSiteGrant(`isolated-mail-regression-${suffix}`);
const desktop = createWindChimeLiveClient({ baseUrl: `${base}/api/mail/live`, getHeaders: () => ({ authorization: `Bearer ${grant.token}` }) });
const created = [];
const blocked = [];
try {
  await desktop.settings.setBlockedTermsEnabled(true);
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
  let liveState = await desktop.state(topicA.id);
  assert.equal(liveState.appearance.imageHeightPercent, 45, "0.8 fixed-media support is supplied by the site");
  for (const layout of ["stack", "split", "banner", "sidebar", "portrait", "focus"]) {
    liveState = await desktop.action({
      action: "appearance", topicId: topicA.id, expectedRevision: liveState.revision,
      operationId: randomUUID(), appearance: { layout, theme: "mia", imageHeightPercent: 55, maxWidth: 280, viewportHeight: 1080 },
    });
    assert.equal(liveState.appearance.layout, layout);
    assert.equal(liveState.appearance.theme, "mia");
    assert.equal(liveState.appearance.imageHeightPercent, 55);
    assert.equal(liveState.appearance.maxWidth, 280, "narrow layouts keep the exact saved width");
    assert.equal(liveState.appearance.viewportHeight, 1080, "portrait layouts keep the exact saved height");
    assert.equal(liveState.current, null, "appearance updates never start output");
  }
  assert.deepEqual((await liveAdmin.state(topicA.id)).appearance, liveState.appearance, "website and desktop read the same saved appearance");
  await assert.rejects(desktop.action({
    action: "appearance", topicId: topicA.id, expectedRevision: liveState.revision,
    operationId: randomUUID(), appearance: { imageHeightPercent: 71 },
  }), error => error.code === "INVALID_APPEARANCE");
  assert.equal((await desktop.state(topicA.id)).revision, liveState.revision, "invalid media settings are rejected atomically");
  console.log("Next_UliUli: 0.8 six layouts, fixed image allocation, shared state and no automatic output passed.");
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
  // Validate the actual website handler, not only an in-process mock service.
  const displayGrant = await desktop.createGrant(topicA.id, "display", "isolated-output");
  const display = createWindChimeDisplayClient({ baseUrl: `${base}/api/mail/live`, token: displayGrant.token });
  const firstReceiver = await display.open();
  assert.equal((await display.frame(firstReceiver.receiverId)).snapshot, null);
  const liveAction = async (action, extra = {}) => {
    const current = await desktop.state(topicA.id);
    const selected = current.messages.find(item => item.id === normal.id);
    return desktop.action({
      topicId: topicA.id, action, messageId: normal.id, expectedRevision: current.revision,
      expectedDraftRevision: selected.draftRevision, operationId: randomUUID(), ...extra,
    });
  };
  await assert.rejects(liveAction("show"), error => error.code === "NOT_APPROVED");
  const approved = await liveAction("approve");
  assert(approved.queue.includes(normal.id));
  assert.equal((await display.frame(firstReceiver.receiverId)).snapshot, null, "approval alone never plays");
  await liveAction("show");
  assert.equal((await display.frame(firstReceiver.receiverId)).snapshot.messageId, normal.id);
  const prepared = await desktop.state(topicA.id);
  const delayedShow = {
    topicId: topicA.id, action: "show", messageId: normal.id,
    expectedRevision: prepared.revision, operationId: randomUUID(),
  };
  const reopened = await display.open();
  assert.equal((await display.frame(reopened.receiverId)).snapshot, null, "reopening starts blank");
  await assert.rejects(desktop.action(delayedShow), error => error.code === "REVISION_CONFLICT", "pre-handshake show request is stale");
  assert.equal((await display.frame(reopened.receiverId)).snapshot, null, "late request cannot activate a new window");
  assert.equal((await display.frame(firstReceiver.receiverId)).snapshot.messageId, normal.id, "an existing healthy viewer continues");
  await liveAction("show");
  assert.equal((await display.frame(reopened.receiverId)).snapshot.messageId, normal.id, "fresh manual show activates the new window");
  await liveAction("hide");
  assert.equal((await display.frame(reopened.receiverId)).snapshot, null);
  await liveAction("show");
  await liveAction("revoke");
  assert.equal((await display.frame(reopened.receiverId)).snapshot, null, "revoking withdraws current output");
  await liveAction("approve");
  await liveAction("show");
  const beforeEdit = (await desktop.state(topicA.id)).messages.find(item => item.id === normal.id);
  await liveAction("draft", { draft: { ...beforeEdit.draft, nickname: "Reviewed nickname changed" } });
  assert.equal((await display.frame(reopened.receiverId)).snapshot, null, "editing approved content withdraws it");
  await assert.rejects(liveAction("show"), error => error.code === "NOT_APPROVED");
  assert.equal((await admin.messages.detail(normal.id, { topicId: topicA.id })).isRead, false, "broadcast does not change original read state");
  const displayAsControl = createWindChimeLiveClient({
    baseUrl: `${base}/api/mail/live`, getHeaders: () => ({ authorization: `Bearer ${displayGrant.token}` }),
  });
  await assert.rejects(displayAsControl.state(topicA.id), error => error.status === 401);
  await assert.rejects(desktop.messages.get(topicB.id, normal.id), error => error.status === 404);
  await desktop.revokeGrant(topicA.id, displayGrant.id);
  await assert.rejects(display.frame(reopened.receiverId), error => error.status === 401 || error.status === 403);
  console.log("0.8.1 HTTP: approval/manual output, handshake conflicts, hide/revoke/edit withdrawal and read-only/topic isolation passed.");
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
  await desktop.settings.setBlockedTermsEnabled(keywordBefore);
  await liveAdmin.revokeGrant(undefined, grant.id);
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
