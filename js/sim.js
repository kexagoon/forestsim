/**
 * Forest fire / growth simulation engine.
 * Uses typed arrays for grid state and Float32 for continuous values.
 */
(function (global) {
  'use strict';

  const EMPTY = 0;
  const TREE = 1;
  const BURNING = 2;
  const ASH = 3;

  const DEFAULTS = {
    growthRate: 0.004,
    reproductionRate: 0.018,
    matureAge: 0.35,
    lightningChance: 0.00008,
    fireStrength: 1.0,
    humidity: 0.35,
    windDx: 0,
    windDy: 0,
    windStrength: 0.4,
    initialDensity: 0.42,
    ashDecay: 0.012,
    crowningBonus: 0.15,
  };

  /** Mulberry32 PRNG */
  function createRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class ForestSim {
    constructor(cols, rows, opts) {
      this.cols = cols | 0;
      this.rows = rows | 0;
      this.n = this.cols * this.rows;
      this.params = Object.assign({}, DEFAULTS, opts || {});
      this.seed = (opts && opts.seed != null) ? (opts.seed >>> 0) : (Date.now() >>> 0);
      this.rng = createRng(this.seed);
      this.tick = 0;
      this.stats = {
        trees: 0,
        burning: 0,
        ash: 0,
        empty: 0,
        lightnings: 0,
        firesStarted: 0,
      };

      this.state = new Uint8Array(this.n);
      this.age = new Float32Array(this.n);       // TREE biomass/age, ASH remaining
      this.intensity = new Float32Array(this.n); // BURNING intensity

      // Double-buffer for next tick
      this._nextState = new Uint8Array(this.n);
      this._nextAge = new Float32Array(this.n);
      this._nextIntensity = new Float32Array(this.n);

      this._initGrid();
    }

    idx(x, y) {
      return y * this.cols + x;
    }

    setSeed(seed) {
      this.seed = seed >>> 0;
      this.rng = createRng(this.seed);
    }

    resize(cols, rows, keepContent) {
      const oldCols = this.cols;
      const oldRows = this.rows;
      const oldState = this.state;
      const oldAge = this.age;
      const oldIntensity = this.intensity;

      this.cols = cols | 0;
      this.rows = rows | 0;
      this.n = this.cols * this.rows;
      this.state = new Uint8Array(this.n);
      this.age = new Float32Array(this.n);
      this.intensity = new Float32Array(this.n);
      this._nextState = new Uint8Array(this.n);
      this._nextAge = new Float32Array(this.n);
      this._nextIntensity = new Float32Array(this.n);

      if (keepContent && oldState) {
        const copyCols = Math.min(oldCols, this.cols);
        const copyRows = Math.min(oldRows, this.rows);
        for (let y = 0; y < copyRows; y++) {
          for (let x = 0; x < copyCols; x++) {
            const ni = y * this.cols + x;
            const oi = y * oldCols + x;
            this.state[ni] = oldState[oi];
            this.age[ni] = oldAge[oi];
            this.intensity[ni] = oldIntensity[oi];
          }
        }
        this._recount();
      } else {
        this._initGrid();
      }
    }

    reset(opts) {
      if (opts) Object.assign(this.params, opts);
      if (opts && opts.seed != null) this.setSeed(opts.seed);
      else {
        this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
        this.rng = createRng(this.seed);
      }
      this.tick = 0;
      this.stats.lightnings = 0;
      this.stats.firesStarted = 0;
      this._initGrid();
    }

    _initGrid() {
      const { n, state, age, intensity, params, rng } = this;
      const dens = params.initialDensity;
      let trees = 0, empty = 0;
      for (let i = 0; i < n; i++) {
        intensity[i] = 0;
        if (rng() < dens) {
          state[i] = TREE;
          // Mix of saplings and mature trees
          age[i] = 0.08 + rng() * 0.85;
          trees++;
        } else {
          state[i] = EMPTY;
          age[i] = 0;
          empty++;
        }
      }
      this.stats.trees = trees;
      this.stats.burning = 0;
      this.stats.ash = 0;
      this.stats.empty = empty;
    }

    _recount() {
      let trees = 0, burning = 0, ash = 0, empty = 0;
      const { n, state } = this;
      for (let i = 0; i < n; i++) {
        const s = state[i];
        if (s === TREE) trees++;
        else if (s === BURNING) burning++;
        else if (s === ASH) ash++;
        else empty++;
      }
      this.stats.trees = trees;
      this.stats.burning = burning;
      this.stats.ash = ash;
      this.stats.empty = empty;
    }

    /** Count tree neighbors and overcrowding factor in Moore neighborhood */
    _treeNeighbors(x, y) {
      const { cols, rows, state } = this;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (state[ny * cols + nx] === TREE) count++;
        }
      }
      return count;
    }

    step() {
      const {
        cols, rows, n, state, age, intensity,
        _nextState: ns, _nextAge: na, _nextIntensity: ni,
        params, rng,
      } = this;

      const growthRate = params.growthRate;
      const repro = params.reproductionRate;
      const mature = params.matureAge;
      const lightning = params.lightningChance;
      const fireStr = params.fireStrength;
      const humidity = Math.max(0, Math.min(1, params.humidity));
      const windDx = params.windDx;
      const windDy = params.windDy;
      const windStr = params.windStrength;
      const ashDecay = params.ashDecay;

      let trees = 0, burning = 0, ash = 0, empty = 0;
      let lightningsThisTick = 0;

      // Copy / compute next
      ns.set(state);
      na.set(age);
      ni.set(intensity);

      // --- Pass 1: growth, ash decay, fire burn-down, lightning ---
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const s = state[i];

          if (s === TREE) {
            const neighbors = this._treeNeighbors(x, y);
            const overcrowding = neighbors / 8;
            const slow = 1 - overcrowding * 0.7;
            let a = age[i] + growthRate * slow * (0.7 + rng() * 0.6);
            if (a > 1.4) a = 1.4;
            na[i] = a;
            ns[i] = TREE;
            ni[i] = 0;

            // Lightning prefers older trees
            const strikeP = lightning * (0.3 + a * 1.4);
            if (rng() < strikeP) {
              ns[i] = BURNING;
              ni[i] = 0.55 + a * 0.45;
              na[i] = a;
              lightningsThisTick++;
              this.stats.firesStarted++;
            }
          } else if (s === BURNING) {
            let inten = intensity[i];
            // Consume fuel
            const fuel = age[i];
            inten -= (0.06 + humidity * 0.08) / Math.max(0.35, fireStr);
            inten += fuel * 0.01 * fireStr * 0.3;
            if (inten < 0.12) {
              ns[i] = ASH;
              na[i] = 0.85 + rng() * 0.4;
              ni[i] = 0;
            } else {
              if (inten > 1.5) inten = 1.5;
              ns[i] = BURNING;
              ni[i] = inten;
              na[i] = Math.max(0, fuel - 0.04 * fireStr);
            }
          } else if (s === ASH) {
            let rem = age[i] - ashDecay * (0.8 + rng() * 0.4);
            if (rem <= 0) {
              ns[i] = EMPTY;
              na[i] = 0;
              ni[i] = 0;
            } else {
              ns[i] = ASH;
              na[i] = rem;
              ni[i] = 0;
            }
          } else {
            // EMPTY — may receive seed in pass 2
            ns[i] = EMPTY;
            na[i] = 0;
            ni[i] = 0;
          }
        }
      }

      // --- Pass 2: reproduction into EMPTY (from current TREE cells) ---
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (state[i] !== TREE) continue;
          if (age[i] < mature) continue;
          if (ns[i] === BURNING) continue; // already struck

          const maturity = Math.min(1, (age[i] - mature) / (1 - mature + 0.01));
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              const ni2 = ny * cols + nx;
              if (ns[ni2] !== EMPTY) continue;
              // Weaker diagonals, distance falloff
              const dist = (dx !== 0 && dy !== 0) ? 1.414 : 1;
              const diagFactor = (dx !== 0 && dy !== 0) ? 0.55 : 1;
              const p = repro * maturity * diagFactor / (dist * dist) * (1 - humidity * 0.25);
              if (rng() < p) {
                ns[ni2] = TREE;
                na[ni2] = 0.02 + rng() * 0.06;
                ni[ni2] = 0;
              }
            }
          }
        }
      }

      // --- Pass 3: fire spread from current BURNING to neighbors ---
      const humidityFactor = 1 - humidity * 0.75;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (state[i] !== BURNING) continue;
          const srcInt = intensity[i];
          if (srcInt < 0.15) continue;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              const j = ny * cols + nx;
              const tgt = ns[j];
              if (tgt !== TREE) continue;

              const fuel = na[j];
              const diag = (dx !== 0 && dy !== 0);
              let base = (diag ? 0.12 : 0.22) * fireStr * srcInt * humidityFactor;
              base *= (0.4 + fuel * 0.9);

              // Wind bias: boost when spreading with wind
              if (windStr > 0.01) {
                const wAlign = dx * windDx + dy * windDy;
                // windDx/Dy expected in [-1,1]
                base *= 1 + windStr * wAlign * 0.85;
              }

              // Strong fire / crowning
              if (srcInt > 0.9 && fuel > 0.7) {
                base += params.crowningBonus * fireStr;
              }

              if (base < 0) base = 0;
              if (rng() < Math.min(0.95, base)) {
                ns[j] = BURNING;
                ni[j] = Math.min(1.4, 0.35 + srcInt * 0.5 + fuel * 0.25);
                // keep age as fuel
              }
            }
          }
        }
      }

      // Swap buffers
      this.state = ns;
      this.age = na;
      this.intensity = ni;
      this._nextState = state;
      this._nextAge = age;
      this._nextIntensity = intensity;

      // Recount
      for (let i = 0; i < n; i++) {
        const s = this.state[i];
        if (s === TREE) trees++;
        else if (s === BURNING) burning++;
        else if (s === ASH) ash++;
        else empty++;
      }
      this.stats.trees = trees;
      this.stats.burning = burning;
      this.stats.ash = ash;
      this.stats.empty = empty;
      this.stats.lightnings += lightningsThisTick;
      this.tick++;
    }

    // --- Painting tools ---
    paint(cx, cy, brush, tool) {
      const r = Math.max(0, brush | 0);
      const { cols, rows, state, age, intensity, rng } = this;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const i = y * cols + x;
          if (tool === 'plant') {
            state[i] = TREE;
            age[i] = 0.15 + rng() * 0.4;
            intensity[i] = 0;
          } else if (tool === 'clear') {
            state[i] = EMPTY;
            age[i] = 0;
            intensity[i] = 0;
          } else if (tool === 'ignite') {
            if (state[i] === TREE || state[i] === ASH || state[i] === EMPTY) {
              const fuel = state[i] === TREE ? age[i] : 0.3;
              state[i] = BURNING;
              age[i] = Math.max(0.2, fuel);
              intensity[i] = 0.7 + rng() * 0.4;
              this.stats.firesStarted++;
            }
          } else if (tool === 'extinguish') {
            if (state[i] === BURNING) {
              state[i] = ASH;
              age[i] = 0.5;
              intensity[i] = 0;
            }
          }
        }
      }
      this._recount();
    }

    /** Export compact snapshot for history */
    snapshot() {
      // Quantize: state as Uint8, age as Uint8 (0-255), intensity as Uint8
      const n = this.n;
      const ageQ = new Uint8Array(n);
      const intQ = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        ageQ[i] = Math.min(255, Math.round(this.age[i] * 160));
        intQ[i] = Math.min(255, Math.round(this.intensity[i] * 160));
      }
      return {
        tick: this.tick,
        cols: this.cols,
        rows: this.rows,
        state: new Uint8Array(this.state),
        ageQ,
        intQ,
        stats: {
          trees: this.stats.trees,
          burning: this.stats.burning,
          ash: this.stats.ash,
          empty: this.stats.empty,
          lightnings: this.stats.lightnings,
          firesStarted: this.stats.firesStarted,
        },
      };
    }

    /** Restore from snapshot (view only — does not rewind RNG) */
    loadSnapshot(snap) {
      if (!snap) return;
      if (snap.cols !== this.cols || snap.rows !== this.rows) {
        this.cols = snap.cols;
        this.rows = snap.rows;
        this.n = snap.cols * snap.rows;
        this.state = new Uint8Array(this.n);
        this.age = new Float32Array(this.n);
        this.intensity = new Float32Array(this.n);
        this._nextState = new Uint8Array(this.n);
        this._nextAge = new Float32Array(this.n);
        this._nextIntensity = new Float32Array(this.n);
      }
      this.state.set(snap.state);
      const n = this.n;
      for (let i = 0; i < n; i++) {
        this.age[i] = snap.ageQ[i] / 160;
        this.intensity[i] = snap.intQ[i] / 160;
      }
      this.tick = snap.tick;
      Object.assign(this.stats, snap.stats);
    }
  }

  ForestSim.EMPTY = EMPTY;
  ForestSim.TREE = TREE;
  ForestSim.BURNING = BURNING;
  ForestSim.ASH = ASH;
  ForestSim.DEFAULTS = DEFAULTS;
  ForestSim.createRng = createRng;

  global.ForestSim = ForestSim;
})(typeof window !== 'undefined' ? window : globalThis);
