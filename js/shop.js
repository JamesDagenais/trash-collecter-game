/*
 * Shop UI: upgrade panel + zones panel.
 *
 * INTERFACE (main.js depends on it; keep the signatures):
 *   TrashGame.Shop.init({ shopEl, zonesEl, onBuy(upgradeId), onUnlockZone(zoneId), onTravel(zoneId) })
 *   TrashGame.Shop.render(state)   // called EVERY animation frame, so it must be cheap
 *
 * DOM HOOKS (used by browser tests):
 *   each upgrade's buy button has  data-id="<upgradeId>"  and is `disabled` when unaffordable
 *   each zone's button has          data-zone="<zoneId>"
 *
 * Read state only through TrashGame.State and data through TrashGame.UPGRADES /
 * TrashGame.ZONES. Never change state here; call the callbacks instead.
 *
 * STARTER IMPLEMENTATION: the Shop UI workstream replaces this.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const S = () => TrashGame.State;
  const F = () => TrashGame.Format;

  const rows = {};
  let zonesEl = null;
  let zoneCallbacks = null;
  let lastZoneKey = '';

  function init({ shopEl, zonesEl: zEl, onBuy, onUnlockZone, onTravel }) {
    zonesEl = zEl;
    zoneCallbacks = { onUnlockZone, onTravel };
    shopEl.innerHTML = '';
    for (const u of TrashGame.UPGRADES) {
      const button = document.createElement('button');
      button.className = 'upgrade';
      button.type = 'button';
      button.dataset.id = u.id;
      const effects = [];
      if (u.trashPerTap) effects.push(`+${F().number(u.trashPerTap, 1)} / tap`);
      if (u.trashPerSecond) effects.push(`+${F().number(u.trashPerSecond, 1)} / sec`);
      button.innerHTML = `
        <span class="upgrade-icon" aria-hidden="true"></span>
        <span class="upgrade-body">
          <span class="upgrade-name"></span>
          <span class="upgrade-desc"></span>
          <span class="upgrade-effect"></span>
        </span>
        <span class="upgrade-side">
          <span class="upgrade-cost"></span>
          <span class="upgrade-owned"></span>
        </span>`;
      button.querySelector('.upgrade-icon').textContent = u.icon;
      button.querySelector('.upgrade-name').textContent = u.name;
      button.querySelector('.upgrade-desc').textContent = u.description;
      button.querySelector('.upgrade-effect').textContent = effects.join(' · ');
      button.addEventListener('click', () => onBuy(u.id));
      shopEl.appendChild(button);
      rows[u.id] = { button, cost: button.querySelector('.upgrade-cost'), owned: button.querySelector('.upgrade-owned') };
    }
  }

  function render(state) {
    let previousOwned = true;
    for (const u of TrashGame.UPGRADES) {
      const row = rows[u.id];
      const count = S().owned(state, u.id);
      const cost = S().nextCost(state, u.id);
      const visible = previousOwned || count > 0 || state.money >= cost * 0.5;
      previousOwned = count > 0;
      row.button.classList.toggle('hidden', !visible);
      row.button.classList.toggle('affordable', state.money >= cost);
      row.button.disabled = state.money < cost;
      setText(row.cost, F().money(cost));
      setText(row.owned, count > 0 ? `×${count}` : '');
    }
    renderZones(state);
  }

  function renderZones(state) {
    const next = S().nextZone(state);
    const key = [state.zone, Object.keys(state.zonesUnlocked).join(','), next && S().canUnlockZone(state, next.id)].join('|');
    if (key === lastZoneKey) return;
    lastZoneKey = key;
    zonesEl.innerHTML = '';
    for (const z of TrashGame.ZONES) {
      const unlocked = S().isZoneUnlocked(state, z.id);
      if (!unlocked && z !== next) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.zone = z.id;
      b.className = 'zone' + (z.id === state.zone ? ' current' : '');
      b.textContent = unlocked
        ? `${z.icon} ${z.name}${z.id === state.zone ? ' (here)' : ''}`
        : `${z.icon} Unlock ${z.name} for ${F().money(z.unlockCost)}`;
      b.disabled = unlocked ? z.id === state.zone : !S().canUnlockZone(state, z.id);
      b.addEventListener('click', () => (unlocked ? zoneCallbacks.onTravel(z.id) : zoneCallbacks.onUnlockZone(z.id)));
      zonesEl.appendChild(b);
    }
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  TrashGame.Shop = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
