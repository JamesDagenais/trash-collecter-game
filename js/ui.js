/*
 * Core HUD: money, the three rates, the current zone and tool, plus the street
 * scene (character.js) and the pull-up sheet (sheet.js), which it starts and drives.
 * Reads state, never changes it. The shop lives in shop.js; effects in effects.js.
 *
 * INTERFACE (main.js depends on it):
 *   TrashGame.UI.init({ onTap(pointerEvent|null), onReset() })
 *   TrashGame.UI.render(state)        every frame; only touches the DOM on change
 *   TrashGame.UI.showSaveStatus(text)
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const S = () => TrashGame.State;
  const F = () => TrashGame.Format;

  const el = {};
  let lastTool = null;
  let hintShown = null;

  function init({ onTap, onReset }) {
    for (const id of ['trash', 'money', 'perTap', 'perSecond', 'tapButton', 'tool', 'toolIcon', 'zoneName', 'zoneButton', 'resetButton', 'saveStatus', 'scene', 'stage', 'tapHint']) {
      el[id] = document.getElementById(id);
    }
    // Mouse / touch / pen: count on pointerdown (snappy), primary button only.
    el.tapButton.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault(); // stops double-tap zoom and focus outline on mobile
      onTap(e);
    });
    // Keyboard (Enter/Space) and assistive tech (TalkBack, Voice Control, Switch
    // Access, el.click()) arrive as a click with detail 0 and no pointerdown before
    // it. Real pointer clicks have detail >= 1 and were already counted above.
    el.tapButton.addEventListener('click', (e) => {
      if (e.detail === 0) onTap(null);
    });
    // Holding Enter would repeat the click: one tap per key press.
    el.tapButton.addEventListener('keydown', (e) => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    el.tapButton.addEventListener('contextmenu', (e) => e.preventDefault());
    el.resetButton.addEventListener('click', onReset);

    try {
      TrashGame.Character && TrashGame.Character.init({ canvas: el.scene, stage: el.stage });
    } catch (e) {
      /* the game still works without the picture */
    }

    const $ = (id) => document.getElementById(id);
    if (TrashGame.Sheet) {
      TrashGame.Sheet.init({
        sheet: $('sheet'),
        head: $('sheetHead'),
        toggle: $('sheetToggle'),
        scrim: $('sheetScrim'),
        body: $('sheetBody'),
        tabs: { shop: $('tabShop'), zones: $('tabZones'), awards: $('tabAwards') },
        panes: { shop: $('paneShop'), zones: $('paneZones'), awards: $('paneAwards') },
        fullOnly: ['awards'],
      });
      if (el.zoneButton) el.zoneButton.addEventListener('click', () => TrashGame.Sheet.open('zones'));
    }
  }

  function render(state) {
    setText(el.trash, F().number(Math.floor(state.trash)));
    setText(el.money, F().money(state.money));
    setText(el.perTap, F().number(S().trashPerTap(state), 1));
    setText(el.perSecond, F().number(S().trashPerSecond(state), 1));
    const tool = S().currentTool(state);
    const toolName = (S().upgradeName && S().upgradeName(state, tool.id)) || tool.name; // evolved name, if any
    if (tool.id + '|' + toolName !== lastTool) {
      lastTool = tool.id + '|' + toolName;
      setText(el.tool, toolName);
      if (el.toolIcon && TrashGame.Pixel) {
        const url = TrashGame.Pixel.icon(tool.id, tool.icon);
        el.toolIcon.style.backgroundImage = url ? 'url(' + url + ')' : '';
      }
    }
    const zone = S().currentZone(state);
    setText(el.zoneName, zone.name);
    if (el.zoneButton) {
      const label = 'Zone: ' + zone.name + '. Change zone';
      if (el.zoneButton.getAttribute('aria-label') !== label) el.zoneButton.setAttribute('aria-label', label);
    }
    const showHint = !(state.taps > 0);
    if (showHint !== hintShown && el.tapHint) {
      hintShown = showHint;
      el.tapHint.hidden = !showHint;
    }
    if (TrashGame.Character) TrashGame.Character.render(state);
  }

  function showSaveStatus(text) {
    if (el.saveStatus) el.saveStatus.textContent = text;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  TrashGame.UI = { init, render, showSaveStatus };
})(typeof window !== 'undefined' ? window : globalThis);
