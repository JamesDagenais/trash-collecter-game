# Berlin Trash Clicker

A small clicker game about cleaning up Berlin. You start with a bare trash pick. Every piece of trash you pick up earns money, and money buys equipment and help so you collect trash faster.

Plain HTML/CSS/JS with no build step and no dependencies. Open `index.html` in a browser to play.

## Project layout and ownership

Each file has a single owner. Modules talk only through the interfaces written in each file's header comment, so different workstreams can work in parallel without editing the same file.

| Workstream | Files | Interface it provides |
| --- | --- | --- |
| **Core** (integration) | `index.html`, `css/base.css`, `js/main.js`, `js/ui.js`, `js/format.js`, `README.md` | `UI`, `Format`, the wiring |
| **Economy & content** | `js/upgrades.js`, `js/zones.js`, `js/state.js`, `js/save.js`, `tools/simulate.js`, `docs/economy.md` | `UPGRADES`, `ZONES`, `CONFIG`, `State`, `Save` |
| **Shop UI** | `js/shop.js`, `css/shop.css` | `Shop.init/render`, inside `#shop` and `#zones` |
| **Juice** | `js/effects.js`, `js/audio.js`, `css/effects.css` | `Effects.*`, `Sound.*` |
| **Tests** | `tests/**` | `node tests/run.js`, `node tests/e2e.js` |

Scripts load with plain `<script>` tags in the order shown in `index.html` and share one global namespace, `window.TrashGame`, so the game also runs from `file://`. Only `main.js` changes state in response to input; every UI module reads state and reports actions through callbacks.

## The upgrades contract

`TrashGame.UPGRADES` in `js/upgrades.js` is the only source of upgrade data. Nothing else hard-codes upgrade names, costs or effects.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | Unique, snake_case. Also the save key, so never rename one after release. |
| `name` | string | Display name |
| `description` | string | Shop flavour text |
| `icon` | string | One emoji |
| `baseCost` | number | € price of the first copy, > 0 |
| `trashPerTap` | number | Added per tap, per copy owned, >= 0 |
| `trashPerSecond` | number | Passive trash, per copy owned, >= 0 |
| `costGrowth` | number? | Optional, > 1. Defaults to `CONFIG.DEFAULT_COST_GROWTH` (1.15) |

- Price of the next copy: `ceil(baseCost * costGrowth ^ owned)`
- Each upgrade must give at least one of `trashPerTap` or `trashPerSecond`.
- The list is kept sorted by `baseCost`.
- `node tests/run.js` checks all of these rules.

## The zones contract

`TrashGame.ZONES` in `js/zones.js`: `id`, `name`, `description`, `icon`, `unlockCost` (the first zone is 0), `trashMultiplier` (>= 1, applies to tap and per-second income) and `pfandChance` (0..1 per tap). Zones unlock in order and moving between unlocked zones is free. A Pfand bottle pays `State.pfandValue(state)` in bonus €: `PFAND_TAPS_WORTH` (8) taps plus `PFAND_SECONDS_WORTH` (2) seconds of passive income, so it stays relevant late game. Pfand-rich zones (Mauerpark, Warschauer Straße) trade a lower multiplier for more bottles, which rewards active tapping.

## Balancing

`node tools/simulate.js` plays a greedy bot and prints when each upgrade and zone is first bought (`--tps 8`, `--minutes 60`, `--all`, `--json`). Pacing targets and results are in `docs/economy.md`.

## Game state

```js
{
  trash, money, totalMoneyEarned, taps,  // numbers
  upgrades: { [id]: countOwned },
  zone, zonesUnlocked: { [zoneId]: true },
  pfandBottles, pfandMoney,              // lifetime Pfand stats
  startedAt, lastSaved                   // ms timestamps
}
```

- **Saving:** the game saves to `localStorage["berlinTrashClicker.save"]` as `{ version, state }` (currently version 2). It saves every 10 s, after each purchase, and when the tab is hidden or closed.
- **Loading:** saved data is merged onto a fresh state. Invalid values are ignored, removed upgrades are dropped, and new upgrades start at 0. `Save.migrate` upgrades older saves; v1 → v2 refunds the removed Heavy-Duty Gloves and Leaf Blower and the old Warschauer Straße unlock.
- **Settings:** the mute preference is stored separately in `localStorage["berlinTrashClicker.settings"]`.
