/**
 * Boot: wire sim, renderer, history, UI, rAF loop, ResizeObserver.
 */
(function () {
  'use strict';

  const TICK_MS = 100; // base ms per simulation tick at ×1

  const app = {
    canvas: null,
    wrap: null,
    sim: null,
    renderer: null,
    history: null,
    ui: null,
    playing: true,
    speed: 1,
    targetCellCss: 6,
    maxCols: 220,
    _accum: 0,
    _lastTs: 0,
    _liveBackup: null,
    _raf: 0,
  };

  function recordSnapshot() {
    if (!app.sim || !app.history) return;
    if (!app.history.isLive) return;
    app.history.push(app.sim.snapshot());
  }

  function render(timeMs) {
    if (app.renderer && app.sim) {
      app.renderer.draw(app.sim, timeMs || performance.now());
    }
  }

  function stepOnce() {
    if (!app.history.isLive) {
      resumeLive();
    }
    app.sim.step();
    recordSnapshot();
    render();
    if (app.ui) app.ui.tick();
  }

  function scrubTo(i) {
    if (!app.history || app.history.length === 0) return;

    // Capture live sim before leaving the live edge
    if (app.history.isLive && !app._liveBackup) {
      app._liveBackup = app.sim.snapshot();
    }

    const snap = app.history.scrubTo(i);
    if (!snap) return;

    app.playing = false;
    app.sim.loadSnapshot(snap);

    if (app.history.isLive) {
      // Scrubbed back to newest — drop backup, we're live again
      app._liveBackup = null;
    }

    render();
    if (app.ui) {
      app.ui.updateStats();
      app.ui._syncHistoryLabel();
      app.ui._syncTransport();
    }
  }

  function resumeLive() {
    app.history.goLive();
    if (app._liveBackup) {
      app.sim.loadSnapshot(app._liveBackup);
      app._liveBackup = null;
    } else {
      const newest = app.history.getNewest();
      if (newest) app.sim.loadSnapshot(newest);
    }
    render();
    if (app.ui) app.ui.tick();
  }

  function rebuildGrid(keepContent) {
    const rect = app.wrap.getBoundingClientRect();
    const cssW = Math.max(64, Math.floor(rect.width));
    const cssH = Math.max(64, Math.floor(rect.height));
    const { cols, rows } = app.renderer.computeGridSize(
      cssW,
      cssH,
      app.targetCellCss,
      app.maxCols
    );
    app.renderer.resizeToDisplay(cssW, cssH, cols, rows);

    if (!app.sim) {
      const seed = (Date.now() ^ ((Math.random() * 0xffffffff) | 0)) >>> 0;
      app.sim = new ForestSim(cols, rows, { seed });
      return;
    }

    if (app.sim.cols !== cols || app.sim.rows !== rows) {
      app.sim.resize(cols, rows, !!keepContent);
      app.history.clear();
      app._liveBackup = null;
      recordSnapshot();
    }

    render();
    if (app.ui) {
      app.ui.updateStats();
      app.ui.syncHistoryScrubber();
    }
  }

  function resetSim() {
    const seedEl = document.getElementById('set-seed');
    let seed = seedEl ? parseInt(seedEl.value, 10) : NaN;
    if (!Number.isFinite(seed)) seed = (Math.random() * 0xffffffff) >>> 0;
    if (seedEl) seedEl.value = String(seed);

    const densEl = document.getElementById('set-density');
    if (densEl) app.sim.params.initialDensity = parseFloat(densEl.value) || 0.42;

    app.sim.reset({ seed: seed >>> 0 });
    app.history.clear();
    app._liveBackup = null;
    app.playing = true;
    app._accum = 0;
    recordSnapshot();
    render();
  }

  function loop(ts) {
    app._raf = requestAnimationFrame(loop);
    if (!app._lastTs) app._lastTs = ts;
    const dt = Math.min(100, ts - app._lastTs);
    app._lastTs = ts;

    if (app.playing && app.history.isLive) {
      app._accum += dt * app.speed;
      let steps = 0;
      const maxSteps = 8;
      while (app._accum >= TICK_MS && steps < maxSteps) {
        app._accum -= TICK_MS;
        app.sim.step();
        recordSnapshot();
        steps++;
      }
      if (steps > 0 && app.ui) app.ui.tick();
    }

    render(ts);
  }

  function init() {
    app.canvas = document.getElementById('forest-canvas');
    app.wrap = document.getElementById('canvas-wrap');
    if (!app.canvas || !app.wrap) {
      console.error('ForestSim: canvas missing');
      return;
    }

    app.renderer = new ForestRenderer(app.canvas);
    app.history = new HistoryBuffer(400);

    app.recordSnapshot = recordSnapshot;
    app.render = render;
    app.stepOnce = stepOnce;
    app.scrubTo = scrubTo;
    app.resumeLive = resumeLive;
    app.rebuildGrid = rebuildGrid;
    app.resetSim = resetSim;

    const rect = app.wrap.getBoundingClientRect();
    const cssW = Math.max(64, Math.floor(rect.width));
    const cssH = Math.max(64, Math.floor(rect.height));
    const { cols, rows } = app.renderer.computeGridSize(
      cssW,
      cssH,
      app.targetCellCss,
      app.maxCols
    );
    app.renderer.resizeToDisplay(cssW, cssH, cols, rows);

    const seed = (Date.now() ^ ((Math.random() * 0xffffffff) | 0)) >>> 0;
    app.sim = new ForestSim(cols, rows, {
      seed,
      initialDensity: 0.42,
      lightningChance: 0.00008,
      humidity: 0.35,
      fireStrength: 1.0,
      growthRate: 0.004,
      reproductionRate: 0.018,
      windStrength: 0.4,
      windDx: 0,
      windDy: -1,
    });

    recordSnapshot();

    app.ui = new ForestUI(app, document);
    const seedInput = document.getElementById('set-seed');
    if (seedInput) seedInput.value = String(seed);

    if (typeof ResizeObserver !== 'undefined') {
      let resizeTimer = null;
      const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => rebuildGrid(true), 80);
      });
      ro.observe(app.wrap);
    } else {
      window.addEventListener('resize', () => rebuildGrid(true));
    }

    render();
    app.ui.tick();
    requestAnimationFrame(loop);

    window.ForestApp = app;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
