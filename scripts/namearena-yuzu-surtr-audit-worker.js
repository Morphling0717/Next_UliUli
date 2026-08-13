/* eslint-disable @typescript-eslint/no-require-imports */
require('./namearena/shared/register');
const { main } = require('./namearena/audit/yuzuSurtrAuditWorker.ts');

main();
