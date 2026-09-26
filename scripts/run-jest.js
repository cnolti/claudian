const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const jestPath = require.resolve('jest/bin/jest');
const localStorageFile = path.join(os.tmpdir(), 'claudian-localstorage');

const result = spawnSync(
  process.execPath,
  [`--localstorage-file=${localStorageFile}`, jestPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    // Upstream tests assert en-US toLocaleString output ("256,500"); pin the
    // ICU locale so the suite passes on non-English host systems too.
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
