import { createWindChimeService } from "@windchime/embed/server";
import { createWindChimeRouteHandlers } from "@windchime/embed/next";
import { windChimeStorage } from "./windchime-storage";
import { dbReady } from "./db";
import { hasMailAdminAccess, verifyMailAdmin } from "./mail-auth";

export const windChime = createWindChimeService({
  storage: windChimeStorage,
  // 必须保持原盐值，否则已有屏蔽身份将失去匹配。
  hashSalt: process.env.WINDCHIME_HASH_SALT ?? "uliuli-mail-default-salt",
  blockedTerms: process.env.MAIL_BLOCKED_TERMS,
  turnstileSecret: process.env.TURNSTILE_SECRET,
  ready: () => dbReady,
});
export const windChimeRoutes = createWindChimeRouteHandlers({
  service: windChime,
  authorizeAdmin: verifyMailAdmin,
  hasAdminAccess: hasMailAdminAccess,
});
