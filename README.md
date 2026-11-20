# Berlin Trash Clicker

A small clicker game about cleaning up Berlin. You start with a bare trash pick. Every piece of trash you pick up earns money, and money buys equipment and help so you collect trash faster.

Plain HTML/CSS/JS with no build step and no dependencies. Open `index.html` in a browser to play.

## Project layout and ownership

Each file has a single owner. Modules talk only through the interfaces written in each file's header comment, so different workstreams can work in parallel without editing the same file.

| Workstream | Files | Interface it provides |
| --- | --- | --- |
| **Core** (integration) | `index.html`, `css/base.css`, `js/main.js`, `js/ui.js`, `js/format.js`, `README.md` | `UI`, `Format`, the wiring |
| **Economy & content** | `js/upgrades.js`, `js/zones.js`, `js/achievements.js`, `js/state.js`, `js/save.js`, `tools/simulate.js`, `docs/economy.md` | `UPGRADES`, `ZONES`, `ACHIEVEMENTS`, `CONFIG`, `State`, `Save` |
| **Shop UI** | `js/shop.js`, `js/awards.js`, `css/shop.css` | `Shop.init/render` inside `#shop` and `#zones`; `Awards.init/render` inside `#achievements` |
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

## Achievements

`TrashGame.ACHIEVEMENTS` in `js/achievements.js` has 145 achievements in eight categories: zones, gear, evolutions, trash, income, taps, Pfand and special (some special ones are secret). Most are **generated** from `UPGRADES` and `ZONES`, so new content gets achievements automatically:

- **Gear ranks:** own 1 / 10 / 25 / 50 / 75 / 100 / 150 / 200 of each upgrade. A rank is left out when that copy would cost more than €10T, so nothing is unreachable.
- **Evolutions:** listed by hand in `EVOLUTIONS`, because they have names. At the evolution rank the upgrade gets a new name (Old Broom → Kehrmeister Broom at 75 → Golden Broom at 150), a golden look in the shop and on the hero, and a `perOwned` bonus: every copy owned adds a % to tap or passive income. That keeps cheap early upgrades worth buying late.
- **Rewards:** every achievement gives +`CONFIG.ACHIEVEMENT_BONUS` (0.5%) to all trash. Some also give an extra `global`, `tap`, `passive`, `pfand` or `perOwned` bonus. `State.bonuses(state)` returns the totals, and they are already part of `trashPerTap`, `trashPerSecond` and `pfandValue`.
- **Unlocking:** `State.checkAchievements(state)` returns the newly unlocked ones. `main.js` calls it after every action and 4× a second. On load it runs quietly and shows one summary toast, so old saves earn what they already qualify for.
- **Saving:** stored as `state.achievements: { [id]: unlockedAtMs }`. Unknown ids are dropped on load. Write to it only through `checkAchievements` / `unlockAchievement`, because the bonus cache relies on that.
- **Menu:** the **Awards** tab of the pull-up sheet. It shows a summary of totals, category filters, and progress bars on locked achievements.

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
- **Loading:** saved data is merged onto a fresh state. Invalid values are ignored, removed upgrades are dropped, and new upgrades start at 0. `Save.migrate` upgrades older saves; v1 → v2 refunds every v1 purchase at v1 prices and resets upgrades and zones, because almost every upgrade changed price and effect.
- **Multiple tabs:** each save carries a `saveRev`. A tab never overwrites a newer save. It switches to the newer progress instead (on the `storage` event, or when its own save is refused). Reset writes a fresh game over the old save, so an old tab can't bring the old game back.
- **Backups:** a corrupt save, or one from an unknown newer version, is copied to `berlinTrashClicker.save.backup` before anything overwrites it.
- **Away progress:** when you return (page load, or the tab becoming visible after 10 s or more), `State.awayProgress` credits 50% of passive income for up to 2 h.
- **Settings:** the mute preference is stored separately in `localStorage["berlinTrashClicker.settings"]`.
