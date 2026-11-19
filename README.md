# Berlin Trash Clicker

A small clicker game about cleaning up Berlin. You start with a bare trash pick. Every piece of trash you pick up earns money, and money buys equipment and help so you collect trash faster.

Plain HTML/CSS/JS with no build step and no dependencies. Open `index.html` in a browser to play.

## Project layout

| File | Responsibility |
| --- | --- |
| `js/upgrades.js` | **Upgrades data file (the contract).** Every upgrade's name, cost and effect. |
| `js/state.js` | `CONFIG`, the game state object, and pure logic (tap, tick, buy, costs). No DOM. |
| `js/save.js` | localStorage save/load. Checks saved data and fills in missing fields. |
| `js/ui.js` | DOM rendering and number formatting. Reads state but never changes it. |
| `js/main.js` | Bootstrap: wires input, runs the `requestAnimationFrame` loop, autosaves. |
| `tests/run.js` | Tests for the contract, logic and save/load: `node tests/run.js` |

Scripts load in that order with plain `<script>` tags and share one global namespace, `window.TrashGame`. This means the game also runs from `file://`.

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

## Game state

```js
{
  trash, money, totalMoneyEarned, taps,  // numbers
  upgrades: { [id]: countOwned },
  startedAt, lastSaved                   // ms timestamps
}
```

- **Saving:** the game saves to `localStorage["berlinTrashClicker.save"]` as `{ version, state }`. It saves every 10 s, after each purchase, and when the tab is hidden or closed.
- **Loading:** saved data is merged onto a fresh state. Invalid values are ignored, removed upgrades are dropped, and new upgrades start at 0.
