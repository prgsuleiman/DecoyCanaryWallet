/* Decoy Canary Wallet - core logic, for the browser and for Node.
 * Mirrors decoy_canary.py. Simulated shielded model, mock keys, no real cryptography.
 * See README.md for the honest limits.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Canary = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const NORMAL = "NORMAL";
  const PROTECTED = "PROTECTED";
  const DEFAULT_AMOUNT = 100;
  const DECOY_FRACTION = 0.001; // each decoy holds 0.1% of the payment...
  const MIN_DECOY = 0.001; // ...but never less; must stay above the network fee

  // Small seeded random generator, so a demo can be replayed exactly (?seed=7).
  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Pretend pool. Enforces each note's spending rule, like consensus would. */
  class Ledger {
    constructor() {
      this.height = 0;
      this.outputs = {}; // id -> { value, rule, spent }  (internal, not an outsider view)
      this.watchers = []; // told about every successful spend
    }
    mine(blocks = 1) {
      this.height += blocks;
    }
    addOutput(id, value, rule) {
      this.outputs[id] = { value, rule, spent: false };
    }
    canSpend(id, signers) {
      const out = this.outputs[id];
      if (!out || out.spent) return false;
      const rule = out.rule;
      if (rule.type === "single") return signers.has(rule.key);
      // two_party: both keys, OR the recovery key once the timelock has passed
      if (rule.keys.every((k) => signers.has(k))) return true;
      return signers.has(rule.recoveryKey) && this.height >= rule.unlockHeight;
    }
    spend(id, signers) {
      return this.spendTx([id], signers);
    }
    /** ONE transaction with several inputs. All-or-nothing: if any input cannot be
     *  spent, the whole transaction is invalid and nothing moves. */
    spendTx(ids, signers) {
      const set = new Set(signers);
      const unique = [...new Set(ids)];
      if (unique.length === 0 || !unique.every((id) => this.canSpend(id, set))) return false;
      unique.forEach((id) => (this.outputs[id].spent = true));
      unique.forEach((id) => this.watchers.forEach((w) => w(id, set)));
      return true;
    }
  }

  /** One real note (two-party + timelocked recovery branch) hidden among n small decoys. */
  class CanaryWallet {
    constructor(ledger, opts = {}) {
      const o = Object.assign(
        {
          name: "w",
          sender: "alice-key",
          receiver: "bob-key",
          recoveryKey: "recovery-key",
          nDecoys: 3,
          k: 1,
          timeoutBlocks: 10,
          amount: DEFAULT_AMOUNT,
          decoyValue: null,
          rng: Math.random,
          onLog: null,
        },
        opts
      );
      if (!(o.k >= 1 && o.k <= o.nDecoys)) throw new Error("need 1 <= k <= nDecoys");
      this.ledger = ledger;
      this.name = o.name;
      this.sender = o.sender;
      this.receiver = o.receiver;
      this.recoveryKey = o.recoveryKey;
      this.n = o.nDecoys;
      this.k = o.k;
      this.timeoutBlocks = o.timeoutBlocks;
      this.amount = o.amount;
      this.rng = o.rng;
      this.onLog = o.onLog;
      // Small but real, and above the fee so sweep tools do not skip the decoys.
      this.decoyValue =
        o.decoyValue === null ? Math.max(o.amount * DECOY_FRACTION, MIN_DECOY) : o.decoyValue;
      this.state = NORMAL;
      this.touched = []; // decoys spent without this wallet's authorization
      this.ownSpends = new Set(); // decoys this wallet spent itself: never an alarm
      this.events = [];
      this.receipts = []; // confirmations of payments the receiver got
      this.decoys = [];

      const realSlot = Math.floor(this.rng() * (this.n + 1));
      for (let slot = 0; slot <= this.n; slot++) {
        const id = this._nextId();
        if (slot === realSlot) {
          this.realId = id;
          ledger.addOutput(id, this.amount, {
            type: "two_party",
            keys: [this.sender, this.receiver],
            recoveryKey: this.recoveryKey,
            unlockHeight: ledger.height + this.timeoutBlocks,
          });
        } else {
          this._addDecoy(id);
        }
      }
      this.unlockHeight = ledger.outputs[this.realId].rule.unlockHeight;
      ledger.watchers.push((id, signers) => this._onSpend(id, signers));
    }

    _nextId() {
      // Random opaque id. A counter would leak: replacement decoys would be newer.
      for (;;) {
        const id = this.name + ":" + Math.floor(this.rng() * 0xffffff).toString(16).padStart(6, "0");
        if (!(id in this.ledger.outputs)) return id;
      }
    }
    _addDecoy(id) {
      this.ledger.addOutput(id, this.decoyValue, { type: "single", key: this.sender });
      this.decoys.push(id);
    }
    activeDecoys() {
      return this.decoys.filter((d) => !this.ledger.outputs[d].spent);
    }
    _topUp() {
      while (this.activeDecoys().length < this.n) this._addDecoy(this._nextId());
    }
    _log(kind, text) {
      const ev = { height: this.ledger.height, kind, text };
      this.events.push(ev);
      if (this.onLog) this.onLog(ev);
    }

    /** Unspent note ids in random order, real one not marked. */
    outputIds() {
      const ids = [this.realId, ...this.activeDecoys()].filter((i) => !this.ledger.outputs[i].spent);
      return shuffle(ids, this.rng);
    }

    /** What an outsider sees: ids and spent flags in random order. No amounts, nothing marked. */
    observerView() {
      const rows = [this.realId, ...this.decoys].map((id) => ({ id, spent: this.ledger.outputs[id].spent }));
      return shuffle(rows, this.rng);
    }

    /** What only the owner (or a thief holding the key) can read: amounts and which is real. */
    ownerView() {
      return [this.realId, ...this.decoys].map((id) => ({
        id,
        value: this.ledger.outputs[id].value,
        isReal: id === this.realId,
        spent: this.ledger.outputs[id].spent,
      }));
    }

    // The monitor: watches every spend. A decoy spent without our say-so is the alarm.
    _onSpend(id) {
      if (this.decoys.includes(id) && !this.ownSpends.has(id)) {
        this.touched.push(id);
        this._log(
          "alarm",
          `ALARM: decoy ${id} was spent without this wallet's authorization ` +
            `(unauthorized decoy spends so far: ${this.touched.length}, protected state at ${this.k})`
        );
        if (this.touched.length >= this.k && this.state === NORMAL) {
          this.state = PROTECTED;
          this._log("alarm", "PROTECTED STATE: this wallet will not sign until both parties authorize");
        }
      }
    }

    selectCoin() {
      return this.realId; // coin selection only ever picks the real note
    }

    pay(senderAuth, receiverAuth) {
      if (this.state === PROTECTED) {
        this._log("warn", "payment BLOCKED: wallet is in the protected state");
        return false;
      }
      if (this.ledger.outputs[this.realId].spent) {
        this._log("warn", "payment REJECTED: the real note is already spent");
        return false;
      }
      const ok = this.ledger.spend(this.selectCoin(), [senderAuth, receiverAuth]);
      if (ok) {
        this.receipts.push({ to: this.receiver, amount: this.amount, block: this.ledger.height });
        this._log("ok", `payment sent: ${this.receiver} received ${this.amount} (confirmed at block ${this.ledger.height})`);
      } else {
        this._log("warn", "payment REJECTED: needs both parties");
      }
      return ok;
    }

    unlock(senderAuth, receiverAuth) {
      if (this.state !== PROTECTED) return true;
      const given = new Set([senderAuth, receiverAuth]);
      if (!(given.has(this.sender) && given.has(this.receiver))) {
        this._log("warn", "unlock REJECTED: both parties must authorize");
        return false;
      }
      this.state = NORMAL;
      this.touched = [];
      this._topUp(); // simulator behaviour: each new decoy would cost a fee for real
      this._log("ok", "unlocked by both parties; simulated decoy set restored; back to NORMAL");
      return true;
    }

    /** By design this does NOT check the protected state: the timelock branch is a rule
     *  the ledger enforces, and it is the way out if the receiver has vanished. */
    recoverWithKey(key) {
      const ok = this.ledger.spend(this.realId, [key]);
      this._log(
        ok ? "ok" : "warn",
        ok
          ? "funds released by the recovery key (timelock branch)"
          : "recovery-key release REJECTED (wrong key, timelock not reached, or already spent)"
      );
      return ok;
    }

    retireDecoy(id, senderAuth) {
      if (!this.decoys.includes(id)) return false;
      this.ownSpends.add(id);
      const ok = this.ledger.spend(id, [senderAuth]);
      if (!ok) this.ownSpends.delete(id); // a failed retire must not silence a later alarm
      return ok;
    }
  }

  /** A thief sweeps the way a real sweep tool does: only the notes the stolen keys
   *  can spend, sent in ONE transaction. */
  function sweepAttack(ledger, stolenKeys, targets) {
    const keys = new Set(stolenKeys);
    const spendable = targets.filter((id) => ledger.canSpend(id, keys));
    const ok = spendable.length > 0 && ledger.spendTx(spendable, keys);
    const result = {};
    targets.forEach((id) => (result[id] = ok && spendable.includes(id)));
    return result;
  }

  /** A careless thief puts EVERY note into one transaction. All-or-nothing: if any
   *  input is unspendable the whole transaction is invalid. */
  function naiveSweep(ledger, stolenKeys, targets) {
    const ok = ledger.spendTx(targets, stolenKeys);
    const result = {};
    targets.forEach((id) => (result[id] = ok));
    return result;
  }

  /** One blind attacker touches notes in random order. True if they reach the
   *  real note before the wallet enters the protected state. */
  function blindAttackTrial(n, k, rng) {
    const ledger = new Ledger();
    const wallet = new CanaryWallet(ledger, { nDecoys: n, k, rng });
    const order = shuffle(wallet.outputIds(), rng);
    for (const id of order) {
      if (wallet.state === PROTECTED) return false;
      if (id === wallet.realId) return true;
      ledger.spend(id, [wallet.sender]);
    }
    return false;
  }

  return {
    NORMAL, PROTECTED, DEFAULT_AMOUNT, DECOY_FRACTION, MIN_DECOY,
    Ledger, CanaryWallet, sweepAttack, naiveSweep, blindAttackTrial, mulberry32, shuffle,
  };
});
