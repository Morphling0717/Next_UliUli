import path from "node:path";
import { fileURLToPath } from "node:url";

/** 固定为项目根，避免子进程 cwd 在父目录时 @tailwindcss/postcss 无法解析 tailwindcss */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const config = {
  plugins: {
    "@tailwindcss/postcss": { base: projectRoot },
  },
};

export default config;
