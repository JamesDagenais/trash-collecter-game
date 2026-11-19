/*
 * Zero-dependency unit tests. Run with:  node tests/run.js
 * Runs every tests/*.test.js (or only files whose name contains an argument,
 * e.g. `node tests/run.js save`). Exit code 1 if any test fails.
 * The browser smoke test is separate: node tests/e2e.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { runAll, CORE } = require('./lib/harness');

const filters = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort()
  .map((f) => path.join(__dirname, f));

if (!files.length) {
  console.log('No test files matched.');
  process.exit(1);
}

console.log('Loading game modules: ' + CORE.join(', '));
runAll(files).then(
  ({ failed }) => process.exit(failed ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
