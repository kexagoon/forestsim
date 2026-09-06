/**
 * Forest fire / growth simulation engine.
 * Uses typed arrays for grid state and Float32 for continuous values.
 *
 * Fire spread inspired by Rothermel ROS / PROPAGATOR-style CA wind anisotropy
 * and FBP elliptical growth. Lightning ignition separates strike vs ignition
 * (LCC + fuel moisture concepts). Wind is persistent (smooth target tracking).
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
    lightningIgnitionProb: 0.18,
    fireStrength: 1.0,
    humidity: 0.35,
    moistureExtinction: 0.6,
    windDx: 0,
    windDy: -1,
    windStrength: 0.4,
    windMode: 'auto',
    windMeanSpeed: 0.35,
    windMaxSpeed: 1.2,
    windPersistence: 0.95,
    windGustiness: 0.35,
    windShiftRate: 0.008,
    initialDensity: 0.42,
    ashDecay: 0.012,
    crowningBonus: 0.15,
    spottingChance: 0.04,
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

  function shortestAngleDelta(from, to) {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
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

      // Persistent wind state (auto mode)
      this._windDir = 0; // radians, 0 = north/up
      this._windSpeed = this.params.windMeanSpeed;
      this._targetDir = 0;
      this._targetSpeed = this.params.windMeanSpeed;
      this._gust = 0;
      this.wind = {
        dirDeg: 0,
        speed: this._windSpeed,
        targetDirDeg: 0,
        targetSpeed: this._targetSpeed,
        gust: 0,
      };

      // Seed initial wind from params if manual-style values provided
      if (this.params.windDx !== 0 || this.params.windDy !== 0) {
        this._windDir = Math.atan2(this.params.windDx, -this.params.windDy);
        this._targetDir = this._windDir;
      }
      if (this.params.windStrength > 0) {
        this._windSpeed = this.params.windStrength;
        this._targetSpeed = this.params.windStrength;
      }
      this._syncWindExpose();

      this._initGrid();
    }

    idx(x, y) {
      return y * this.cols + x;
    }

    setSeed(seed) {
      this.seed = seed >>> 0;
      this.rng = createRng(this.seed);
    }

    _syncWindExpose() {
      let deg = (this._windDir * 180) / Math.PI;
      if (deg < 0) deg += 360;
      let tDeg = (this._targetDir * 180) / Math.PI;
      if (tDeg < 0) tDeg += 360;
      this.wind.dirDeg = deg;
      this.wind.speed = this._windSpeed + this._gust;
      this.wind.targetDirDeg = tDeg;
      this.wind.targetSpeed = this._targetSpeed;
      this.wind.gust = this._gust;
    }

    /**
     * Persistent weather: rare new targets, exponential smooth toward them,
     * optional decaying gusts. Updates params.windDx/Dy/Strength for fire.
     */
    _updateWind() {
      const p = this.params;
      const rng = this.rng;

      if (p.windMode !== 'auto') {
        // Manual: use slider-driven params; keep internal state in sync for HUD
        this._windDir = Math.atan2(p.windDx, -p.windDy);
        this._windSpeed = p.windStrength;
        this._targetDir = this._windDir;
        this._targetSpeed = this._windSpeed;
        this._gust = 0;
        this._syncWindExpose();
        return;
      }

      const shiftRate = clamp(p.windShiftRate, 0, 0.2);
      const persistence = clamp(p.windPersistence, 0.5, 0.995);
      const mean = clamp(p.windMeanSpeed, 0, p.windMaxSpeed);
      const maxSp = Math.max(0.05, p.windMaxSpeed);
      const gustiness = clamp(p.windGustiness, 0, 1);

      // Rare regime shift: pick new target direction & speed
      if (rng() < shiftRate) {
        this._targetDir = rng() * Math.PI * 2;
        // Speed around mean with noise, clamped
        const noise = (rng() - 0.5) * 0.7 + (rng() - 0.5) * 0.4;
        this._targetSpeed = clamp(mean + noise * mean + noise * 0.25, 0.02, maxSp);
      }

      // Exponential smooth (high persistence = slow change)
      const alpha = 1 - persistence;
      const dAng = shortestAngleDelta(this._windDir, this._targetDir);
      this._windDir += dAng * alpha;
      // wrap to [-π, π]
      if (this._windDir > Math.PI) this._windDir -= Math.PI * 2;
      if (this._windDir < -Math.PI) this._windDir += Math.PI * 2;

      this._windSpeed += (this._targetSpeed - this._windSpeed) * alpha;

      // Gusts: occasional spike that decays
      this._gust *= 0.82;
      if (this._gust < 0.01) this._gust = 0;
      if (gustiness > 0 && rng() < 0.015 * gustiness) {
        this._gust = (0.15 + rng() * 0.55) * gustiness * maxSp;
      }

      const liveSpeed = clamp(this._windSpeed + this._gust, 0, maxSp * 1.15);
      p.windDx = Math.sin(this._windDir);
      p.windDy = -Math.cos(this._windDir);
      p.windStrength = liveSpeed;

      this._syncWindExpose();
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
      // Re-seed wind state lightly
      this._gust = 0;
      if (this.params.windMode === 'auto') {
        this._windSpeed = this.params.windMeanSpeed;
        this._targetSpeed = this.params.windMeanSpeed;
        this._windDir = this.rng() * Math.PI * 2;
        this._targetDir = this._windDir;
        this.params.windDx = Math.sin(this._windDir);
        this.params.windDy = -Math.cos(this._windDir);
        this.params.windStrength = this._windSpeed;
      } else {
        this._windDir = Math.atan2(this.params.windDx, -this.params.windDy);
        this._windSpeed = this.params.windStrength;
        this._targetDir = this._windDir;
        this._targetSpeed = this._windSpeed;
      }
      this._syncWindExpose();
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

    /**
     * Elliptical wind factor: head fire much faster than flank/back.
     * cosθ = dot(windUnit, towardNeighbor); head≈1, back≈-1, flank≈0.
     */
    _ellipticalFactor(cosTheta, windSpeed) {
      const w = Math.max(0, windSpeed);
      // Head: strong boost; flank: moderate; back: strongly reduced
      const headWeight = Math.max(0, cosTheta); // 0..1 toward head
      const backWeight = Math.max(0, -cosTheta); // 0..1 toward back
      // Piecewise / Rothermel-ish anisotropy
      const headMul = 1 + w * (0.55 + 0.85 * headWeight * headWeight);
      const backMul = 1 / (1 + w * (0.9 + 1.2 * backWeight));
      const flankMul = 1 + w * 0.15 * (1 - Math.abs(cosTheta));
      if (cosTheta >= 0) {
        return headMul * (0.85 + 0.15 * flankMul);
      }
      return backMul * (0.7 + 0.3 * flankMul);
    }

    step() {
      const {
        cols, rows, n, state, age, intensity,
        _nextState: ns, _nextAge: na, _nextIntensity: ni,
        params, rng,
      } = this;

      // Live wind first — fire MUST use current vector
      this._updateWind();

      const growthRate = params.growthRate;
      const repro = params.reproductionRate;
      const mature = params.matureAge;
      const lightning = params.lightningChance;
      const ignBase = params.lightningIgnitionProb != null
        ? params.lightningIgnitionProb
        : 0.18;
      const fireStr = params.fireStrength;
      const humidity = clamp(params.humidity, 0, 1);
      const mfExt = clamp(
        params.moistureExtinction != null ? params.moistureExtinction : 0.6,
        0.25,
        1
      );
      const windDx = params.windDx;
      const windDy = params.windDy;
      const windStr = params.windStrength;
      const ashDecay = params.ashDecay;

      // Dead fuel moisture proxy from RH
      const mf = humidity; // 0..1
      const moistureDamping = Math.pow(Math.max(0, 1 - mf / mfExt), 2);

      // Wind unit vector
      const wLen = Math.hypot(windDx, windDy) || 1;
      const wUx = windDx / wLen;
      const wUy = windDy / wLen;

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

            // Lightning prefers older trees (height / litter bias)
            const strikeP = lightning * (0.3 + a * 1.4);
            if (rng() < strikeP) {
              // ALWAYS count strike
              lightningsThisTick++;

              // Separate ignition roll: LCC + moisture + fuel
              // ~25% of CG strikes have long continuing current conceptually
              const hasLCC = rng() < 0.28;
              const lccFactor = hasLCC ? 1.0 : 0.12;
              // High humidity → near-zero ignition
              const moistureFactor = Math.pow(Math.max(0, 1 - mf), 2);
              // Older trees / more litter-like fuel slightly easier
              const fuelFactor = 0.55 + a * 0.55;

              const ignP = ignBase * lccFactor * moistureFactor * fuelFactor;
              if (rng() < ignP) {
                ns[i] = BURNING;
                ni[i] = 0.45 + a * 0.4 * (hasLCC ? 1.15 : 0.85);
                na[i] = a;
                this.stats.firesStarted++;
              }
            }
          } else if (s === BURNING) {
            let inten = intensity[i];
            const fuel = age[i];
            // Consume faster in strong wind / low moisture; humidity helps extinction
            const windConsume = 1 + windStr * 0.35;
            const moistConsume = 1 + (1 - moistureDamping) * 0.4;
            const consume = (0.055 + humidity * 0.09) * moistConsume / Math.max(0.35, fireStr);
            inten -= consume;
            // Reaction intensity boost from remaining fuel + wind
            inten += fuel * 0.012 * fireStr * (0.6 + windStr * 0.5) * moistureDamping;
            const fuelLeft = Math.max(0, fuel - 0.035 * fireStr * windConsume * (0.7 + (1 - humidity) * 0.5));

            if (inten < 0.1 || fuelLeft < 0.04) {
              ns[i] = ASH;
              na[i] = 0.85 + rng() * 0.4;
              ni[i] = 0;
            } else {
              if (inten > 1.5) inten = 1.5;
              ns[i] = BURNING;
              ni[i] = inten;
              na[i] = fuelLeft;
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
          if (ns[i] === BURNING) continue; // already struck & ignited

          const maturity = Math.min(1, (age[i] - mature) / (1 - mature + 0.01));
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              const ni2 = ny * cols + nx;
              if (ns[ni2] !== EMPTY) continue;
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

      // --- Pass 3: elliptical wind-driven fire spread ---
      const spottingBase = params.spottingChance != null ? params.spottingChance : 0.04;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (state[i] !== BURNING) continue;
          const srcInt = intensity[i];
          if (srcInt < 0.12) continue;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              const j = ny * cols + nx;
              if (ns[j] !== TREE) continue;

              const fuel = na[j];
              const diag = (dx !== 0 && dy !== 0);
              const len = diag ? Math.SQRT2 : 1;
              const tUx = dx / len;
              const tUy = dy / len;
              const cosTheta = tUx * wUx + tUy * wUy;

              const ellip = this._ellipticalFactor(cosTheta, windStr);
              const diagWeak = diag ? 0.62 : 1.0;
              const fuelLoad = 0.35 + fuel * 0.95;

              let pSpread =
                0.18 *
                fireStr *
                srcInt *
                fuelLoad *
                moistureDamping *
                ellip *
                diagWeak;

              // Crowning: intense fire into mature canopy
              if (srcInt > 0.9 && fuel > 0.7) {
                pSpread += params.crowningBonus * fireStr * moistureDamping;
              }

              pSpread = clamp(pSpread, 0, 0.92);
              if (rng() < pSpread) {
                // New intensity from reaction intensity concept
                const react =
                  (0.3 + srcInt * 0.45 + fuel * 0.28) *
                  fireStr *
                  (0.55 + moistureDamping * 0.45) *
                  (0.75 + windStr * 0.25);
                ns[j] = BURNING;
                ni[j] = Math.min(1.45, react);
              }
            }
          }

          // Rare spotting: 2 cells downwind when wind+intensity high
          if (
            windStr > 0.55 &&
            srcInt > 0.7 &&
            spottingBase > 0 &&
            rng() < spottingBase * windStr * srcInt * moistureDamping
          ) {
            const sx = Math.round(wUx * 2);
            const sy = Math.round(wUy * 2);
            const tx = x + (sx || (wUx >= 0 ? 1 : -1));
            const ty = y + (sy || (wUy >= 0 ? 1 : -1));
            if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) {
              const j = ty * cols + tx;
              // Only if not adjacent already handled & is TREE
              if (Math.abs(tx - x) + Math.abs(ty - y) >= 2 && ns[j] === TREE) {
                const fuel = na[j];
                ns[j] = BURNING;
                ni[j] = Math.min(1.2, 0.35 + srcInt * 0.35 + fuel * 0.2);
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
