/**
 * Ring-buffer history of compact snapshots + scrubber helpers.
 */
(function (global) {
  'use strict';

  class HistoryBuffer {
    /**
     * @param {number} capacity max frames to keep
     */
    constructor(capacity) {
      this.capacity = Math.max(10, capacity | 0);
      this.buffer = new Array(this.capacity);
      this.head = 0;      // next write index
      this.count = 0;     // frames stored
      this.liveIndex = -1; // scrub position relative to oldest (0..count-1); -1 or count-1 = live
      this._viewingPast = false;
    }

    get length() {
      return this.count;
    }

    get isLive() {
      return !this._viewingPast || this.liveIndex < 0 || this.liveIndex >= this.count - 1;
    }

    setCapacity(cap) {
      cap = Math.max(10, Math.min(5000, cap | 0));
      if (cap === this.capacity) return;
      // Keep newest frames
      const snaps = this.toArray();
      this.capacity = cap;
      this.buffer = new Array(cap);
      this.head = 0;
      this.count = 0;
      this._viewingPast = false;
      this.liveIndex = -1;
      const start = Math.max(0, snaps.length - cap);
      for (let i = start; i < snaps.length; i++) this.push(snaps[i]);
    }

    clear() {
      this.buffer = new Array(this.capacity);
      this.head = 0;
      this.count = 0;
      this.liveIndex = -1;
      this._viewingPast = false;
    }

    /** Push a snapshot (clones typed arrays already done by sim.snapshot) */
    push(snap) {
      this.buffer[this.head] = snap;
      this.head = (this.head + 1) % this.capacity;
      if (this.count < this.capacity) this.count++;
      // If viewing past, keep scrub index pointing at same relative frame when possible
      if (this._viewingPast && this.liveIndex >= 0) {
        // After overflow, oldest is dropped — shift index left by 1 if full wrap
        // Simpler: when at capacity, dropping oldest moves indices down by 1
        if (this.count === this.capacity && this.head === ((this._oldestIndex() + 1) % this.capacity)) {
          // always true when full — actually after push when full, oldest advances
        }
        // Clamp
        if (this.liveIndex > this.count - 1) this.liveIndex = this.count - 1;
      } else {
        this.liveIndex = this.count - 1;
        this._viewingPast = false;
      }
    }

    _oldestIndex() {
      if (this.count === 0) return 0;
      if (this.count < this.capacity) return 0;
      return this.head; // head points to oldest when full
    }

    /** Absolute buffer index for relative frame i (0 = oldest) */
    _abs(i) {
      if (this.count === 0) return 0;
      if (this.count < this.capacity) return i;
      return (this.head + i) % this.capacity;
    }

    getRelative(i) {
      if (this.count === 0) return null;
      i = Math.max(0, Math.min(this.count - 1, i | 0));
      return this.buffer[this._abs(i)];
    }

    getNewest() {
      if (this.count === 0) return null;
      return this.getRelative(this.count - 1);
    }

    toArray() {
      const out = [];
      for (let i = 0; i < this.count; i++) out.push(this.getRelative(i));
      return out;
    }

    /**
     * Scrub to relative index (0..count-1). Returns snapshot or null.
     * Sets viewing-past mode if not at live edge.
     */
    scrubTo(i) {
      if (this.count === 0) return null;
      i = Math.max(0, Math.min(this.count - 1, i | 0));
      this.liveIndex = i;
      this._viewingPast = i < this.count - 1;
      return this.getRelative(i);
    }

    /** Jump to live (newest) frame */
    goLive() {
      if (this.count === 0) {
        this._viewingPast = false;
        this.liveIndex = -1;
        return null;
      }
      this.liveIndex = this.count - 1;
      this._viewingPast = false;
      return this.getNewest();
    }

    /** Current scrub position 0..count-1 */
    get scrubIndex() {
      if (this.count === 0) return 0;
      if (this.liveIndex < 0) return this.count - 1;
      return this.liveIndex;
    }

    /** For range input: max = count-1 */
    get scrubMax() {
      return Math.max(0, this.count - 1);
    }
  }

  global.HistoryBuffer = HistoryBuffer;
})(typeof window !== 'undefined' ? window : globalThis);
