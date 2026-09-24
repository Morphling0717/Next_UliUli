import path from "node:path";
import { createWindChimeLiveRouteHandlers } from "@windchime/embed/next";
import { windChime } from "./windchime";
import { hasMailAdminAccess, verifyMailAdmin } from "./mail-auth";

export const windChimeLive = createWindChimeLiveRouteHandlers({
  service: windChime,
  publicOrigin: process.env.WINDCHIME_SITE_ORIGIN,
  siteName: "UliUli",
  posterDefaults: { title: "给 Uli 匿名投一封信", subtitle: "扫码发信，你的留言可能会在直播里被读到哦 ~", signature: "—— UliUli" },
  authorizeAdmin: verifyMailAdmin,
  hasAdminAccess: hasMailAdminAccess,
  mediaDirectory: path.resolve(process.env.WINDCHIME_MEDIA_DIRECTORY || "data/mail-media"),
  allowedOrigins: (process.env.WINDCHIME_LIVE_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
  gatewayIssuer: process.env.WINDCHIME_GATEWAY_ORIGIN,
  gatewayPublicKeys: process.env.WINDCHIME_GATEWAY_PUBLIC_KEY
    ? { [process.env.WINDCHIME_GATEWAY_KEY_ID || "default"]: process.env.WINDCHIME_GATEWAY_PUBLIC_KEY.replace(/\\n/g, "\n") }
    : {},
});
