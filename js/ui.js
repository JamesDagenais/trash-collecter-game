/*
 * Core HUD: the stat tiles, current tool and current zone label.
 * Reads state, never changes it. The shop lives in shop.js; effects in effects.js.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const S = () => TrashGame.State;
  const F = () => TrashGame.Format;

  const el = {};

  function init({ onTap, onReset }) {
    for (const id of ['trash', 'money', 'perTap', 'perSecond', 'tapButton', 'tool', 'zoneName', 'resetButton', 'saveStatus']) {
      el[id] = document.getElementById(id);
    }
    el.tapButton.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // stops double-tap zoom and focus outline on mobile
      onTap(e);
    });
    el.tapButton.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        onTap(null);
      }
    });
    el.resetButton.addEventListener('click', onReset);
  }

  function render(state) {
    setText(el.trash, F().number(Math.floor(state.trash)));
    setText(el.money, F().money(state.money));
    setText(el.perTap, F().number(S().trashPerTap(state), 1));
    setText(el.perSecond, F().number(S().trashPerSecond(state), 1));
    const tool = S().currentTool(state);
    setText(el.tool, `${tool.icon} ${tool.name}`);
    const zone = S().currentZone(state);
    setText(el.zoneName, `${zone.icon} ${zone.name}`);
  }

  function showSaveStatus(text) {
    el.saveStatus.textContent = text;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  TrashGame.UI = { init, render, showSaveStatus };
})(typeof window !== 'undefined' ? window : globalThis);
