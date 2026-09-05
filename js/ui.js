/**
 * UI controls, settings panel, tools, stats — Russian labels.
 */
(function (global) {
  'use strict';

  const SPEEDS = [1, 2, 3, 5, 10];

  class ForestUI {
    /**
     * @param {object} app - host with sim, renderer, history, methods
     */
    constructor(app, root) {
      this.app = app;
      this.root = root || document;
      this.tool = 'plant';
      this.brush = 2;
      this._painting = false;
      this._bind();
      this._syncAll();
    }

    $(sel) {
      return this.root.querySelector(sel);
    }

    $all(sel) {
      return Array.from(this.root.querySelectorAll(sel));
    }

    _bind() {
      const self = this;
      const app = this.app;

      // Transport
      this.$('#btn-play').addEventListener('click', () => {
        if (app.history && !app.history.isLive) {
          app.resumeLive();
        }
        app.playing = !app.playing;
        self._syncTransport();
      });
      this.$('#btn-step').addEventListener('click', () => {
        app.playing = false;
        if (app.history && !app.history.isLive) app.resumeLive();
        app.stepOnce();
        self._syncTransport();
      });
      this.$('#btn-reset').addEventListener('click', () => {
        app.resetSim();
        self._syncAll();
      });

      // Speed
      this.$all('[data-speed]').forEach((btn) => {
        btn.addEventListener('click', () => {
          app.speed = parseInt(btn.getAttribute('data-speed'), 10) || 1;
          self._syncSpeed();
        });
      });

      // History scrubber
      const scrub = this.$('#history-scrub');
      scrub.addEventListener('input', () => {
        const i = parseInt(scrub.value, 10) || 0;
        app.scrubTo(i);
        self._syncTransport();
        self._syncHistoryLabel();
      });
      this.$('#btn-live').addEventListener('click', () => {
        app.resumeLive();
        app.playing = true;
        self._syncAll();
      });

      // Settings collapse
      const toggle = this.$('#settings-toggle');
      const panel = this.$('#settings-panel');
      toggle.addEventListener('click', () => {
        const open = panel.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.querySelector('.chevron').textContent = open ? '▾' : '▸';
      });

      // Setting inputs
      const map = [
        ['growthRate', '#set-growth'],
        ['reproductionRate', '#set-repro'],
        ['lightningChance', '#set-lightning'],
        ['fireStrength', '#set-fire'],
        ['humidity', '#set-humidity'],
        ['initialDensity', '#set-density'],
        ['windStrength', '#set-wind-str'],
      ];
      map.forEach(([key, sel]) => {
        const el = this.$(sel);
        if (!el) return;
        const handler = () => {
          let v = parseFloat(el.value);
          if (key === 'lightningChance') v = v / 100000; // UI shows ×10⁻⁵ style
          app.sim.params[key] = v;
          self._updateSettingLabels();
        };
        el.addEventListener('input', handler);
      });

      // Wind direction
      this.$('#set-wind-dir').addEventListener('input', () => {
        const deg = parseFloat(this.$('#set-wind-dir').value) || 0;
        const rad = (deg * Math.PI) / 180;
        app.sim.params.windDx = Math.sin(rad);
        app.sim.params.windDy = -Math.cos(rad); // 0° = north (up)
        self._updateSettingLabels();
      });

      // Cell size / resolution
      this.$('#set-cellsize').addEventListener('input', () => {
        app.targetCellCss = parseFloat(this.$('#set-cellsize').value) || 6;
        self._updateSettingLabels();
        app.rebuildGrid(true);
      });

      // History length
      this.$('#set-history').addEventListener('change', () => {
        const cap = parseInt(this.$('#set-history').value, 10) || 400;
        app.history.setCapacity(cap);
        self.syncHistoryScrubber();
      });

      // Seed
      this.$('#set-seed').addEventListener('change', () => {
        const raw = this.$('#set-seed').value.trim();
        let seed = parseInt(raw, 10);
        if (!Number.isFinite(seed)) seed = Date.now() >>> 0;
        app.sim.setSeed(seed);
      });
      this.$('#btn-random-seed').addEventListener('click', () => {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        this.$('#set-seed').value = String(seed);
        app.sim.setSeed(seed);
      });

      // Apply & reseed forest
      this.$('#btn-apply-density').addEventListener('click', () => {
        app.resetSim();
        self._syncAll();
      });

      // Tools
      this.$all('[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => {
          self.tool = btn.getAttribute('data-tool');
          self._syncTools();
        });
      });
      this.$('#brush-size').addEventListener('input', () => {
        self.brush = parseInt(this.$('#brush-size').value, 10) || 1;
        this.$('#brush-label').textContent = String(self.brush);
      });

      // Canvas pointer paint
      const canvas = app.canvas;
      const paintAt = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const cssX = clientX - rect.left;
        const cssY = clientY - rect.top;
        const cell = app.renderer.cssToCell(cssX, cssY);
        if (app.history && !app.history.isLive) app.resumeLive();
        app.sim.paint(cell.x, cell.y, self.brush, self.tool);
        app.recordSnapshot();
        app.render();
        self.updateStats();
      };

      canvas.addEventListener('pointerdown', (e) => {
        self._painting = true;
        canvas.setPointerCapture(e.pointerId);
        paintAt(e);
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!self._painting) return;
        paintAt(e);
        e.preventDefault();
      });
      const endPaint = (e) => {
        self._painting = false;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };
      canvas.addEventListener('pointerup', endPaint);
      canvas.addEventListener('pointercancel', endPaint);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _syncTransport() {
      const app = this.app;
      const playBtn = this.$('#btn-play');
      if (app.playing && app.history.isLive) {
        playBtn.textContent = 'Пауза';
        playBtn.classList.add('active');
      } else {
        playBtn.textContent = 'Play';
        playBtn.classList.remove('active');
      }
      const liveBtn = this.$('#btn-live');
      if (app.history.isLive) {
        liveBtn.classList.add('hidden');
        this.$('#history-status').textContent = 'live';
      } else {
        liveBtn.classList.remove('hidden');
        this.$('#history-status').textContent = 'просмотр';
      }
    }

    _syncSpeed() {
      const sp = this.app.speed;
      this.$all('[data-speed]').forEach((btn) => {
        const v = parseInt(btn.getAttribute('data-speed'), 10);
        btn.classList.toggle('active', v === sp);
      });
    }

    _syncTools() {
      this.$all('[data-tool]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === this.tool);
      });
    }

    _updateSettingLabels() {
      const p = this.app.sim.params;
      const set = (id, text) => {
        const el = this.$(id);
        if (el) el.textContent = text;
      };
      set('#val-growth', p.growthRate.toFixed(4));
      set('#val-repro', p.reproductionRate.toFixed(3));
      set('#val-lightning', (p.lightningChance * 100000).toFixed(2));
      set('#val-fire', p.fireStrength.toFixed(2));
      set('#val-humidity', p.humidity.toFixed(2));
      set('#val-density', p.initialDensity.toFixed(2));
      set('#val-wind-str', p.windStrength.toFixed(2));
      const deg = this.$('#set-wind-dir');
      if (deg) set('#val-wind-dir', deg.value + '°');
      set('#val-cellsize', String(this.app.targetCellCss));
    }

    syncSettingsFromSim() {
      const p = this.app.sim.params;
      const setVal = (sel, v) => {
        const el = this.$(sel);
        if (el) el.value = String(v);
      };
      setVal('#set-growth', p.growthRate);
      setVal('#set-repro', p.reproductionRate);
      setVal('#set-lightning', p.lightningChance * 100000);
      setVal('#set-fire', p.fireStrength);
      setVal('#set-humidity', p.humidity);
      setVal('#set-density', p.initialDensity);
      setVal('#set-wind-str', p.windStrength);
      setVal('#set-cellsize', this.app.targetCellCss);
      setVal('#set-history', this.app.history.capacity);
      setVal('#set-seed', this.app.sim.seed);
      setVal('#brush-size', this.brush);
      this.$('#brush-label').textContent = String(this.brush);

      // Derive wind angle from dx/dy
      let deg = 0;
      if (p.windDx !== 0 || p.windDy !== 0) {
        deg = (Math.atan2(p.windDx, -p.windDy) * 180) / Math.PI;
        if (deg < 0) deg += 360;
      }
      setVal('#set-wind-dir', Math.round(deg));
      this._updateSettingLabels();
    }

    syncHistoryScrubber() {
      const h = this.app.history;
      const scrub = this.$('#history-scrub');
      scrub.max = String(h.scrubMax);
      scrub.value = String(h.scrubIndex);
      scrub.disabled = h.length === 0;
      this._syncHistoryLabel();
    }

    _syncHistoryLabel() {
      const h = this.app.history;
      const snap = h.getRelative(h.scrubIndex);
      const tick = snap ? snap.tick : 0;
      this.$('#history-label').textContent =
        h.length === 0
          ? 'нет истории'
          : `кадр ${h.scrubIndex + 1}/${h.length} · тик ${tick}`;
    }

    updateStats() {
      const s = this.app.sim.stats;
      const tick = this.app.sim.tick;
      this.$('#stat-trees').textContent = String(s.trees);
      this.$('#stat-burning').textContent = String(s.burning);
      this.$('#stat-ash').textContent = String(s.ash);
      this.$('#stat-tick').textContent = String(tick);
      this.$('#stat-lightning').textContent = String(s.lightnings);
      this.$('#stat-fires').textContent = String(s.firesStarted);
      this.$('#stat-grid').textContent = `${this.app.sim.cols}×${this.app.sim.rows}`;
    }

    _syncAll() {
      this.syncSettingsFromSim();
      this._syncTransport();
      this._syncSpeed();
      this._syncTools();
      this.syncHistoryScrubber();
      this.updateStats();
    }

    /** Called each frame from main loop */
    tick() {
      this.syncHistoryScrubber();
      this.updateStats();
      this._syncTransport();
    }
  }

  ForestUI.SPEEDS = SPEEDS;
  global.ForestUI = ForestUI;
})(typeof window !== 'undefined' ? window : globalThis);
