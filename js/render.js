/**
 * Canvas 2D renderer for forest simulation grid.
 * Renders 1px-per-cell into an offscreen buffer, then scales up crisply.
 */
(function (global) {
  'use strict';

  const EMPTY = 0;
  const TREE = 1;
  const BURNING = 2;
  const ASH = 3;

  function clamp01(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function treeRGB(age) {
    const t = clamp01(age / 1.2);
    let r, g, b;
    if (t < 0.4) {
      const u = t / 0.4;
      r = lerp(145, 72, u);
      g = lerp(205, 165, u);
      b = lerp(95, 58, u);
    } else if (t < 0.75) {
      const u = (t - 0.4) / 0.35;
      r = lerp(72, 30, u);
      g = lerp(165, 115, u);
      b = lerp(58, 42, u);
    } else {
      const u = (t - 0.75) / 0.25;
      r = lerp(30, 14, u);
      g = lerp(115, 74, u);
      b = lerp(42, 30, u);
    }
    return [(r + 0.5) | 0, (g + 0.5) | 0, (b + 0.5) | 0];
  }

  function fireRGB(intensity, flicker) {
    const t = clamp01(intensity / 1.3);
    let r, g, b;
    if (t < 0.35) {
      const u = t / 0.35;
      r = 255;
      g = lerp(245, 185, u);
      b = lerp(90, 45, u);
    } else if (t < 0.7) {
      const u = (t - 0.35) / 0.35;
      r = 255;
      g = lerp(185, 95, u);
      b = lerp(45, 22, u);
    } else {
      const u = (t - 0.7) / 0.3;
      r = lerp(255, 205, u);
      g = lerp(95, 32, u);
      b = lerp(22, 12, u);
    }
    const f = flicker || 0;
    r = Math.min(255, r + f * 28);
    g = Math.min(255, g + f * 18);
    return [(r + 0.5) | 0, (g + 0.5) | 0, (b + 0.5) | 0];
  }

  function ashRGB(remain) {
    const t = clamp01(remain / 1.2);
    const v = lerp(52, 98, t);
    return [(v * 0.95) | 0, (v * 0.9) | 0, (v * 0.85) | 0];
  }

  class ForestRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.off = document.createElement('canvas');
      this.offCtx = this.off.getContext('2d', { alpha: false });
      this.imageData = null;
      this.cols = 0;
      this.rows = 0;
      this.cssW = 0;
      this.cssH = 0;
      this._dpr = 1;
      this._flickerPhase = 0;
    }

    /**
     * Choose grid dimensions for viewport.
     * targetCellCss ~4–8px; denser on large screens; capped ~150–250 cols.
     */
    computeGridSize(cssW, cssH, targetCellCss, maxCols) {
      targetCellCss = targetCellCss || 6;
      maxCols = maxCols || 220;
      let cols = Math.max(12, Math.floor(cssW / targetCellCss));
      let rows = Math.max(12, Math.floor(cssH / targetCellCss));
      if (cols > maxCols) {
        const scale = maxCols / cols;
        cols = maxCols;
        rows = Math.max(12, Math.floor(rows * scale));
      }
      const maxRows = Math.min(240, Math.ceil(maxCols * (cssH / Math.max(1, cssW)) + 4));
      if (rows > maxRows) rows = maxRows;
      return { cols, rows };
    }

    resizeToDisplay(cssW, cssH, cols, rows) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._dpr = dpr;
      this.cssW = cssW;
      this.cssH = cssH;
      this.cols = cols;
      this.rows = rows;

      const pw = Math.max(1, Math.floor(cssW * dpr));
      const ph = Math.max(1, Math.floor(cssH * dpr));
      if (this.canvas.width !== pw || this.canvas.height !== ph) {
        this.canvas.width = pw;
        this.canvas.height = ph;
      }
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';

      if (this.off.width !== cols || this.off.height !== rows) {
        this.off.width = cols;
        this.off.height = rows;
        this.imageData = this.offCtx.createImageData(cols, rows);
      }
    }

    cssToCell(cssX, cssY) {
      const x = Math.floor((cssX / Math.max(1, this.cssW)) * this.cols);
      const y = Math.floor((cssY / Math.max(1, this.cssH)) * this.rows);
      return {
        x: Math.max(0, Math.min(this.cols - 1, x)),
        y: Math.max(0, Math.min(this.rows - 1, y)),
      };
    }

    draw(sim, timeMs) {
      if (!this.imageData || !sim) return;
      const { cols, rows, state, age, intensity } = sim;
      if (cols !== this.cols || rows !== this.rows) return;

      const data = this.imageData.data;
      this._flickerPhase = (timeMs || 0) * 0.01;

      for (let i = 0; i < cols * rows; i++) {
        const s = state[i];
        const o = i * 4;
        let r, g, b;
        if (s === TREE) {
          const c = treeRGB(age[i]);
          r = c[0]; g = c[1]; b = c[2];
        } else if (s === BURNING) {
          const x = i % cols;
          const y = (i / cols) | 0;
          const flicker = Math.sin(this._flickerPhase + x * 0.73 + y * 1.17) * 0.5 + 0.5;
          const c = fireRGB(intensity[i], flicker);
          r = c[0]; g = c[1]; b = c[2];
        } else if (s === ASH) {
          const c = ashRGB(age[i]);
          r = c[0]; g = c[1]; b = c[2];
        } else {
          const shade = ((i % cols) + ((i / cols) | 0)) & 1 ? 3 : 0;
          r = 15 + shade;
          g = 19 + shade;
          b = 17 + shade;
        }
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }

      this.offCtx.putImageData(this.imageData, 0, 0);

      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#0f1412';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  global.ForestRenderer = ForestRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
