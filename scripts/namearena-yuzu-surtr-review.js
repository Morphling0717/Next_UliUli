/* eslint-disable @typescript-eslint/no-require-imports */
require('./namearena/shared/register');
const { main } = require('./namearena/audit/yuzuSurtrReview.ts');

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
