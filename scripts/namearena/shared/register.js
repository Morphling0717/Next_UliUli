/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../../..');

function installTypeScriptHook(root = projectRoot) {
  const resolvedRoot = path.resolve(root);
  const ts = require(path.join(resolvedRoot, 'node_modules/typescript'));

  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        skipLibCheck: true,
      },
      fileName: filename,
    }).outputText;
    module._compile(output, filename);
  };
}

installTypeScriptHook(projectRoot);

module.exports = {
  installTypeScriptHook,
  projectRoot,
};
