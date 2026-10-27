/* Decoy watcher for a real chain: polls an Insight-style explorer for a list of
 * decoy addresses and raises the alarm when one of them is spent.
 * Browser and Node. No keys are ever handled: it only reads public address data.
 *
 * Limits (keep them in the pitch):
 *  - Insight explorers show TRANSPARENT addresses only, so a live demo uses transparent
 *    testnet addresses. Shielded notes would need viewing-key scanning (not built).
 *  - The explorer may be slow, down, or block browser requests. An unreachable explorer
 *    is reported as "unknown"; it is never treated as an alarm and never as "safe".
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CanaryWatch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NORMAL = "NORMAL";
  const PROTECTED = "PROTECTED";
  const MAX_ADDRESSES = 50;

  /** Plausible zcash testnet transparent address: starts with t, base58, 34-36 chars. */
  function looksLikeTransparentAddress(a) {
    return typeof a === "string" && /^t[1-9A-HJ-NP-Za-km-z]{33,35}$/.test(a);
  }

  function addrUrl(base, addr) {
    return String(base).replace(/\/+$/, "") + "/addr/" + encodeURIComponent(addr);
  }

  /** Turn an Insight /addr/<address> reply into the few numbers we need. Throws on nonsense. */
  function snapshot(json) {
    if (!json || typeof json !== "object") throw new Error("explorer reply was not an object");
    const num = (v, name, required) => {
      if (v === undefined || v === null) {
        if (required) throw new Error(`explorer reply has no ${name}`);
        return 0;
      }
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`explorer reply has a bad ${name}`);
      return n;
    };
    return {
      balanceSat: num(json.balanceSat, "balanceSat", true),
      totalSentSat: num(json.totalSentSat, "totalSentSat", true),
      totalReceivedSat: num(json.totalReceivedSat, "totalReceivedSat", false),
      unconfirmedSat: num(json.unconfirmedBalanceSat, "unconfirmedBalanceSat", false),
    };
  }

  /** Watches decoy addresses. fetchJson(url) must resolve to parsed JSON or reject. */
  class DecoyWatcher {
    constructor(opts) {
      const o = Object.assign({ addresses: [], k: 1, base: "", fetchJson: null, onEvent: null }, opts);
      if (typeof o.fetchJson !== "function") throw new Error("fetchJson is required");
      const addresses = [...new Set(o.addresses)];
      if (addresses.length < 1 || addresses.length > MAX_ADDRESSES)
        throw new Error(`watch between 1 and ${MAX_ADDRESSES} addresses`);
      const bad = addresses.find((a) => !looksLikeTransparentAddress(a));
      if (bad) throw new Error(`not a transparent testnet address: ${String(bad).slice(0, 12)}...`);
      if (!(Number.isInteger(o.k) && o.k >= 1 && o.k <= addresses.length))
        throw new Error("k must be a whole number from 1 to the number of addresses");
      this.addresses = addresses;
      this.k = o.k;
      this.base = o.base;
      this.fetchJson = o.fetchJson;
      this.onEvent = o.onEvent;
      this.state = NORMAL;
      this.baseline = {}; // address -> snapshot at start
      this.status = {}; // address -> "watching" | "SPENT" | "retired" | "unknown"
      this.alarmed = []; // addresses spent without the owner's say-so
      this.ownerSpent = new Set(); // addresses the owner said they spent themselves
      addresses.forEach((a) => (this.status[a] = "unknown"));
    }

    _emit(kind, text) {
      if (this.onEvent) this.onEvent({ kind, text });
    }

    async _read(addr) {
      return snapshot(await this.fetchJson(addrUrl(this.base, addr)));
    }

    /** Record what each decoy looks like now. Addresses that fail stay "unknown". */
    async start() {
      for (const a of this.addresses) {
        try {
          this.baseline[a] = await this._read(a);
          this.status[a] = "watching";
          const b = this.baseline[a];
          if (b.totalSentSat > 0 || b.unconfirmedSat < 0) {
            this._emit("warn", `${a.slice(0, 8)}... was already spent before watching began; use a fresh decoy`);
          }
        } catch (e) {
          this.status[a] = "unknown";
          this._emit("warn", `could not read ${a.slice(0, 8)}...: ${e.message}`);
        }
      }
    }

    /** The owner spent this one on purpose: never an alarm. */
    markOwnerSpend(addr) {
      if (!this.addresses.includes(addr)) return false;
      this.ownerSpent.add(addr);
      if (this.status[addr] !== "SPENT") this.status[addr] = "retired";
      return true;
    }

    /** One check of every address. Returns the list of newly alarmed addresses. */
    async poll() {
      const fresh = [];
      for (const a of this.addresses) {
        if (this.ownerSpent.has(a) || this.alarmed.includes(a)) continue;
        let now;
        try {
          now = await this._read(a);
        } catch (e) {
          if (this.status[a] === "watching") this.status[a] = "unknown";
          this._emit("warn", `could not read ${a.slice(0, 8)}...: ${e.message}`);
          continue;
        }
        const before = this.baseline[a];
        if (!before) {
          // first successful read for an address that failed at start
          this.baseline[a] = now;
          this.status[a] = "watching";
          continue;
        }
        this.status[a] = "watching";
        const spent = now.totalSentSat > before.totalSentSat || now.unconfirmedSat < 0;
        if (spent) {
          this.status[a] = "SPENT";
          this.alarmed.push(a);
          fresh.push(a);
          this._emit("alarm", `ALARM: decoy ${a.slice(0, 8)}... was spent without the owner's authorization ` +
            `(unauthorized decoy spends so far: ${this.alarmed.length}, protected state at ${this.k})`);
          if (this.alarmed.length >= this.k && this.state === NORMAL) {
            this.state = PROTECTED;
            this._emit("alarm", "PROTECTED STATE: do not sign anything until both parties authorize");
          }
        }
      }
      return fresh;
    }
  }

  return { NORMAL, PROTECTED, MAX_ADDRESSES, looksLikeTransparentAddress, addrUrl, snapshot, DecoyWatcher };
});
