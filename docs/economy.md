# Economy & balance notes

Data: `js/upgrades.js`, `js/zones.js`. Formulas: `js/state.js` (`CONFIG`). Tuning tool: `node tools/simulate.js [--tps=4] [--minutes=120] [--all]`.

## Target pacing (active play, about 4 taps/s)

| Phase | Target | Simulated (4 taps/s) |
| --- | --- | --- |
| First purchase | within 15–20 taps | Old Broom (€15) after 15 taps, or 7 if a Pfand bottle turns up |
| First 10 minutes | something new every 30–90 s | 12 new things by 10:23, gaps of 0:06 to 2:35 (median 0:46) |
| Mid game (10–30 min) | a new item every 2–5 min | gaps of 2:45 to 5:20 |
| Late game (30 min on) | a big milestone every 5–7 min | gaps of 1:59 to 6:56 |
| Everything owned once | about 45 min | 46:00 |

How tap rate changes the time to own everything once: 8 taps/s takes 29:43, 4 takes 46:00, 2 takes 60:37, 1 takes 74:28, and 0.5 (mostly idle) takes 75:51. Tapping is always worth it, and idle players still get there.

## Rules of thumb behind the numbers

- **Price:** `ceil(baseCost × 1.15^owned)`. No upgrade overrides `costGrowth`, so every price rises 15% per copy.
- **Tier spacing:** each upgrade costs about 2.5–6× the previous one. Each zone costs about 12–25× the previous zone.
- **Payback** is cost divided by € per second gained, at 4 taps/s. It grows with each tier: 4 s for the Old Broom, 83 s for the Pfand Collector, 21 min for the Spree Skimmer Boat, and 67 min for the Orange Fleet, before zone multipliers. Growing payback is what stretches the game out. The zone multipliers keep the payback you actually feel at 1–5 minutes.
- **Tap tools sit ahead of the payback curve.** A tool only earns while you tap, so from the Push Cart on, a tool pays back faster at 4 taps/s than the cheaper helper before it. The Push Cart takes 139 s against 160 s for the Cargo Bike, and the Street Sweeper takes 1,000 s against 1,250 s for the Spree Skimmer Boat. Without that edge, tap income would fade to a few percent by mid game. The ladder is trash pick → Old Broom → Bin Bags → Push Cart → Street Sweeper. `currentTool()` shows the latest tool you own.
- **New tiers win over spamming.** In the simulator, a new tier is bought within about a minute of becoming affordable (see the `waited` column). This means its first copy always pays back faster than another copy of an older tier.

## Pfand

- A bottle pays `8 × (€ per tap) + 2 × (passive € per second)`, both at the current zone's multiplier. The tap part makes a bottle feel big early on (a €8 bottle when a tap pays €1). The passive part keeps it relevant late, when taps are a small share of income. A bottle is always worth at least 8 taps and about 1.5–2 s of total income.
- Normal zones have a 1.5–2% chance per tap, so about one bottle every 12 s at 4 taps/s. Pfand is then about 11–14% of income.
- Over a whole 4 taps/s run, Pfand is 14% of all money earned: 22% at 8 taps/s and 2% when mostly idle. It rewards active play without being the main income.

### Pfand-rich zones (reason to travel)

**Mauerpark** and **Warschauer Straße** have a 6% Pfand chance but a *lower* multiplier than the zone just before them (Tempelhofer Feld and RAW-Gelände). Here is the income of the Pfand-rich zone compared with the zone before it, measured on the simulator's mid-game states:

| Taps/s | 0 | 1 | 2 | 4 | 8 |
| --- | --- | --- | --- | --- | --- |
| Mauerpark vs Tempelhofer Feld | −13% | −3% | +4% | +16% | +30% |
| Warschauer Str. vs RAW-Gelände | −7% | +7% | +15% | +23% | +30% |

Tap in the Pfand-rich zone, and go idle in the one before it. Pfand is about 32% of income while tapping there. Each later zone (RAW-Gelände, Alexanderplatz) beats both, whether you tap or not.

## Save compatibility

`SAVE_VERSION` is now 2. The Heavy-Duty Gloves (`work_gloves`) and the Leaf Blower (`leaf_blower`) are gone because they broke the tool ladder. Warschauer Straße moved from zone 2 (€5,000) to zone 6. When a v1 save is loaded, `Save.migrate` refunds what the player paid at v1 prices. Every other id kept its count. Two display names changed: `garbage_bags` is now Bin Bags and `handcart` is now Push Cart. `sweeper_truck` is now a tap tool.

## Phase 3 review adjustments

An independent review measured the economy against three player models: the greedy simulator bot, a "moderate" player who buys new things right away and only repeat copies that pay back within 2 minutes, and a "spend-all" player.

- **Read simulator times as a lower bound.** `tools/simulate.js` is a near-optimal planner: it waits for the best-value buy and teleports to the best zone after every purchase. Realistic players take about 1.4× (moderate) to more than 3× (spend-all) as long.
- **Retuned:**
  - Mauerpark ×3.5 → **×3.8** and Warschauer Straße ×6.5 → **×7**. Pfand-rich zones now cost an idle player only about 5% (it was 13%), and still win clearly at 4 taps/s.
  - Recycling Yard €1.2B → **€1B**, Orange Fleet €4B → **€3B**, Alexanderplatz €10B → **€6B**. This shortens the late-game waits.
- **Result (greedy bot):** everything is bought at 40:08 at 4 taps/s (was 46:00), 54:10 at 2 taps/s and 1h05 at 0.5 taps/s.
- **Away progress:** while the tab is hidden or the game is closed, passive income keeps running at `OFFLINE_RATE` (50%) for up to `OFFLINE_MAX_SECONDS` (2 h).
- **Open question:** the late game is mostly passive income. The review suggests a late tap tool (about €2B, +250,000 per tap) between Recycling Yard and Orange Fleet. That raises the moderate player's lifetime tap share from 15% to about 39% at 4 taps/s.
