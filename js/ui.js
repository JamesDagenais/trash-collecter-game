/*
 * DOM rendering. Reads state, never changes it. All input goes through main.js.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const S = () => TrashGame.State;

  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];

  /** 1234 -> "1,234", 1234567 -> "1.23M". Shows decimals only for small rates. */
  function formatNumber(n, decimals = 0) {
    if (!Number.isFinite(n)) return '∞';
    if (Math.abs(n) < 1e6) {
      return n.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      });
    }
    const tier = Math.min(Math.floor(Math.log10(Math.abs(n)) / 3), SUFFIXES.length - 1);
    return (n / Math.pow(1000, tier)).toFixed(2) + SUFFIXES[tier];
  }

  function formatMoney(n) {
    return '€' + formatNumber(Math.floor(n));
  }

  const el = {};
  const shopRows = {}; // upgradeId -> { button, owned, cost }

  function init({ onTap, onBuy, onReset }) {
    for (const id of ['trash', 'money', 'perTap', 'perSecond', 'tapButton', 'tool', 'shop', 'resetButton', 'saveStatus', 'floaters']) {
      el[id] = document.getElementById(id);
    }

    el.tapButton.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // stops double-tap zoom and focus outline on mobile
      onTap(e);
    });
    // Keyboard support (Enter / Space while focused).
    el.tapButton.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        onTap(null);
      }
    });

    el.resetButton.addEventListener('click', onReset);
    buildShop(onBuy);
  }

  function buildShop(onBuy) {
    el.shop.innerHTML = '';
    for (const u of TrashGame.UPGRADES) {
      const button = document.createElement('button');
      button.className = 'upgrade';
      button.type = 'button';
      button.dataset.id = u.id;

      const effects = [];
      if (u.trashPerTap) effects.push(`+${formatNumber(u.trashPerTap, 1)} / tap`);
      if (u.trashPerSecond) effects.push(`+${formatNumber(u.trashPerSecond, 1)} / sec`);

      button.innerHTML = `
        <span class="upgrade-icon" aria-hidden="true">${u.icon}</span>
        <span class="upgrade-body">
          <span class="upgrade-name"></span>
          <span class="upgrade-desc"></span>
          <span class="upgrade-effect"></span>
        </span>
        <span class="upgrade-side">
          <span class="upgrade-cost"></span>
          <span class="upgrade-owned"></span>
        </span>`;
      button.querySelector('.upgrade-name').textContent = u.name;
      button.querySelector('.upgrade-desc').textContent = u.description;
      button.querySelector('.upgrade-effect').textContent = effects.join(' · ');
      button.addEventListener('click', () => onBuy(u.id));

      el.shop.appendChild(button);
      shopRows[u.id] = {
        button,
        cost: button.querySelector('.upgrade-cost'),
        owned: button.querySelector('.upgrade-owned'),
      };
    }
  }

  /** Called every frame. Only touches the DOM when a value actually changes. */
  function render(state) {
    setText(el.trash, formatNumber(Math.floor(state.trash)));
    setText(el.money, formatMoney(state.money));
    setText(el.perTap, formatNumber(S().trashPerTap(state), 1));
    setText(el.perSecond, formatNumber(S().trashPerSecond(state), 1));

    const tool = S().currentTool(state);
    setText(el.tool, `${tool.icon} ${tool.name}`);

    // An upgrade stays hidden until you can afford it or the one before it is
    // owned, so the shop reveals itself as you progress.
    let previousOwned = true;
    for (const u of TrashGame.UPGRADES) {
      const row = shopRows[u.id];
      const count = S().owned(state, u.id);
      const cost = S().nextCost(state, u.id);
      const visible = previousOwned || count > 0 || state.money >= cost * 0.5;
      previousOwned = count > 0;

      toggle(row.button, 'hidden', !visible);
      toggle(row.button, 'affordable', state.money >= cost);
      row.button.disabled = state.money < cost;
      row.button.setAttribute('aria-label', `Buy ${u.name} for ${formatMoney(cost)}. Owned: ${count}`);
      setText(row.cost, formatMoney(cost));
      setText(row.owned, count > 0 ? `×${count}` : '');
    }
  }

  /** "+5" text floating up from where you tapped. */
  function spawnFloater(amount, event) {
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = '+' + formatNumber(amount, 1);
    const box = el.tapButton.getBoundingClientRect();
    const host = el.floaters.getBoundingClientRect();
    const x = event && event.clientX ? event.clientX : box.left + box.width / 2;
    const y = event && event.clientY ? event.clientY : box.top + box.height / 2;
    f.style.left = x - host.left + 'px';
    f.style.top = y - host.top + 'px';
    el.floaters.appendChild(f);
    f.addEventListener('animationend', () => f.remove());

    el.tapButton.classList.remove('bump');
    void el.tapButton.offsetWidth; // restart the animation
    el.tapButton.classList.add('bump');
  }

  function showSaveStatus(text) {
    el.saveStatus.textContent = text;
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  function toggle(node, cls, on) {
    if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
  }

  TrashGame.UI = { init, render, spawnFloater, showSaveStatus, formatNumber, formatMoney };
})(typeof window !== 'undefined' ? window : globalThis);
