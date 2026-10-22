// The CLI suite lives in tools/open-sdd and resolves fixtures against that package as its working
// directory. `npx vitest run` at the repository root used to collect it from here and report ~50
// false failures; this config moves the run into the package (REQ-W2-006). `npm test` is unchanged.
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('./tools/open-sdd', import.meta.url));
process.chdir(pkg);

export default {
  test: { root: pkg },
};
