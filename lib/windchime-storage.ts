import path from "node:path";
import { createWindChimeSqlite } from "@windchime/embed/sqlite";

// 与宿主使用同一个文件；风铃连接拥有独立、串行的事务队列。
const configured = (process.env.DATABASE_PATH || "data/codes.db").trim();
export const windChimeDatabasePath = path.isAbsolute(configured)
  ? configured
  : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
const state = globalThis as typeof globalThis & {
  __windChimeStorage?: ReturnType<typeof createWindChimeSqlite>;
};
export const windChimeStorage =
  state.__windChimeStorage ??
  createWindChimeSqlite({ filename: windChimeDatabasePath });
state.__windChimeStorage = windChimeStorage;
export const windChimeSchemaReady = windChimeStorage.ready;
