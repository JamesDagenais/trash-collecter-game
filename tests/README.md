# Tests

No dependencies and no build step. Both suites run with plain Node.

```sh
node tests/run.js           # unit tests: every tests/*.test.js
node tests/run.js save      # only the files whose name contains "save"
node tests/e2e.js           # browser smoke test (Playwright + Chromium)
```

Both exit with code 1 if anything fails.

## Unit tests (`node tests/run.js`)

| File | What it covers |
| --- | --- |
| `contract.test.js` | The `UPGRADES`, `ZONES` and `CONFIG` data contracts (README.md), plus the public `State` / `Save` API and the state shape |
| `economy.test.js` | Cost formula and rounding, buying, per-tap and per-second income with zone multipliers, `tick`, `tap`, Pfand (with injected rng), zone unlock and travel rules, and a 10,000-step seeded property test |
| `save.test.js` | Save and load round trips, corrupt or hostile data, Phase 1 saves, storage that throws, `clear` |
| `lib/harness.js` | The tiny runner and its helpers: `fresh()`, `memoryStore()`, `throwingStore()`, `seeded(seed)`, `approx()`, `enterZone()` |

Writing a test:

```js
const assert = require('assert');
const { test, skip } = require('./lib/harness');

test('does a thing', (T) => {
  // T is a freshly loaded TrashGame namespace: { UPGRADES, ZONES, CONFIG, State, Save }
  const s = T.State.createState();
  assert.strictEqual(T.State.tap(s, () => 0.999999).pfand, 0);
});
```

- Every test gets a **fresh copy of the game modules**, so tests can't leak state into each other. The harness loads the scripts that `index.html` loads, in the same order, up to and including `save.js`.
- **Never hard-code upgrade or zone ids, names, costs or counts.** Read them from `T.UPGRADES` / `T.ZONES` / `T.CONFIG` ("the first upgrade with `trashPerSecond > 0`", "`ZONES[1]`") and compare against an expectation you compute yourself. This lets the economy be rebalanced without breaking the tests.
- Pass an rng to `State.tap(state, rng)` to control Pfand: `() => 0` always finds a bottle (when the zone's `pfandChance` is above 0), and `() => 0.999999` never does.
- Use `memoryStore()` instead of `localStorage`.

## Browser smoke test (`node tests/e2e.js`)

Opens `index.html` over `file://` at 390×844 in headless Chromium and plays a short game. It checks that there are no console or page errors, that the page has no horizontal scroll, that tapping earns money, that the first upgrade is disabled when you're broke and enabled once you can afford it, that buying it raises per-tap, that progress survives a reload, and that Reset clears it.

It only uses the ids in `index.html` (`#money`, `#trash`, `#perTap`, `#perSecond`, `#tapButton`, `#shop`, `#zones`, `#resetButton`) and the Shop's `data-id` / `data-zone` hooks, so restyling the page shouldn't break it.

- `HEADED=1 node tests/e2e.js` shows the browser window.
- `E2E_SCREENSHOT=fail.png node tests/e2e.js` saves a screenshot if a step fails.

Playwright and Chromium need to be installed already. `require('playwright')` has to work.
