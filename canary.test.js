// Run with:  node --test
const test = require("node:test");
const assert = require("node:assert");
const {
  NORMAL, PROTECTED, MIN_DECOY, Ledger, CanaryWallet, planProtection, sweepAttack, naiveSweep, blindAttackTrial, mulberry32,
} = require("./canary.js");

const STOLEN = ["alice-key"]; // a thief who has stolen the sender's key only

function make(opts = {}, seed = 1) {
  const ledger = new Ledger();
  return [ledger, new CanaryWallet(ledger, Object.assign({ rng: mulberry32(seed) }, opts))];
}

test("normal payment succeeds with both parties", () => {
  const [ledger, w] = make();
  assert.ok(w.pay("alice-key", "bob-key"));
  assert.ok(ledger.outputs[w.realId].spent);
  assert.strictEqual(w.state, NORMAL);
});

test("receiver gets a receipt only when the payment goes through", () => {
  const [ledger, w] = make();
  assert.deepStrictEqual(w.receipts, []);
  w.pay("alice-key", "alice-key");
  ledger.spend(w.decoys[0], STOLEN);
  w.pay("alice-key", "bob-key");
  assert.deepStrictEqual(w.receipts, []);
  const [l2, w2] = make();
  w2.pay("alice-key", "bob-key");
  assert.deepStrictEqual(w2.receipts, [{ to: "bob-key", amount: 99.9999, fee: 0.0001, change: 0, block: 0 }]);
  assert.match(w2.events.at(-1).text, /bob-key received 99\.9999/);
});

test("sender and receiver choose the amount, and the fee comes out of it", () => {
  const [, w] = make({ amount: 0.05 });
  assert.ok(w.pay("alice-key", "bob-key", 0.02));
  const r = w.receipts[0];
  assert.ok(Math.abs(r.amount - 0.0199) < 1e-12);
  assert.ok(Math.abs(r.change - 0.03) < 1e-12);
  assert.ok(Math.abs(r.amount + r.fee + r.change - 0.05) < 1e-12);
});

test("bad payment amounts are rejected and nothing moves", () => {
  const [ledger, w] = make({ amount: 0.05 });
  for (const bad of [0, -1, 0.0001, 0.00005, 0.06]) assert.ok(!w.pay("alice-key", "bob-key", bad), String(bad));
  assert.ok(!ledger.outputs[w.realId].spent);
  assert.deepStrictEqual(w.receipts, []);
  assert.ok(w.pay("alice-key", "bob-key", 0.05));
});

test("decoy value can be set but must beat the fee", () => {
  const w = new CanaryWallet(new Ledger(), { decoyValue: 0.5, rng: mulberry32(1) });
  assert.ok(w.ownerView().filter((r) => !r.isReal).every((r) => r.value === 0.5));
  for (const bad of [0.0001, 0.00005, 0])
    assert.throws(() => new CanaryWallet(new Ledger(), { decoyValue: bad, fee: 0.0001, rng: mulberry32(1) }));
  assert.throws(() => new CanaryWallet(new Ledger(), { fee: 0, rng: mulberry32(1) }));
});

test("planner: a small payment uses the fee floor, the fee comes out of the payment", () => {
  const p = planProtection(0.05, 3, { fee: 0.0001 });
  assert.ok(Math.abs(p.decoyValue - 0.001) < 1e-12);
  assert.ok(p.floorApplied);
  assert.ok(Math.abs(p.lockedInDecoys - 0.003) < 1e-12);
  assert.ok(Math.abs(p.feesPaid - 0.0004) < 1e-12);
  assert.ok(Math.abs(p.totalNeeded - 0.0533) < 1e-12);
  assert.ok(Math.abs(p.receiverGets - 0.0499) < 1e-12);
});

test("planner: a large payment uses the fraction; automatic decoys stay above the fee", () => {
  assert.ok(Math.abs(planProtection(100, 3).decoyValue - 0.1) < 1e-12);
  for (const amount of [0.05, 1, 100])
    for (const fee of [0.00001, 0.0001, 0.001])
      assert.ok(planProtection(amount, 3, { fee }).decoyValue > fee);
});

test("planner: the owner can set the decoy value, but not at or below the fee", () => {
  const p = planProtection(0.05, 2, { decoyValue: 0.002 });
  assert.ok(Math.abs(p.decoyValue - 0.002) < 1e-12 && p.customDecoy && !p.floorApplied);
  assert.ok(Math.abs(p.lockedInDecoys - 0.004) < 1e-12);
  assert.match(p.steps[0], /0\.002/);
  for (const decoyValue of [0.0001, 0.00005, 0]) assert.throws(() => planProtection(0.05, 3, { decoyValue }));
});

test("planner: balance check and steps", () => {
  assert.ok(planProtection(0.05, 3, { balance: 0.125 }).covered);
  const short = planProtection(0.05, 3, { balance: 0.05 });
  assert.ok(!short.covered && Math.abs(short.shortfall - 0.0033) < 1e-12);
  assert.ok(!("covered" in planProtection(0.05)));
  const p = planProtection(0.05, 2);
  assert.strictEqual(p.steps.length, 4);
  assert.match(p.steps[0], /0\.001/);
  assert.match(p.steps.at(-1), /0\.05/);
  assert.match(p.steps.at(-1), /0\.0499/);
});

test("planner: bad input is rejected", () => {
  for (const args of [[0], [-1], [1, 0], [1, 2.5], [1, 3, { fee: 0 }], [0.0001, 3, { fee: 0.0001 }], [0.00005]])
    assert.throws(() => planProtection(...args));
});

test("robustness: bad numbers are rejected cleanly", () => {
  for (const o of [{ amount: Infinity }, { amount: NaN }, { amount: -5 }, { fee: Infinity }, { fee: 0 },
    { decoyValue: Infinity }, { decoyValue: NaN }, { decoyValue: 0.0001 }, { nDecoys: 0 }, { nDecoys: 101 }, { nDecoys: 2.5 }])
    assert.throws(() => new CanaryWallet(new Ledger(), Object.assign({ rng: mulberry32(1) }, o)), undefined, JSON.stringify(o));
  for (const args of [[Infinity], [NaN], [1, 101], [1, 1000000], [1, 3, { fee: Infinity }],
    [1, 3, { decoyValue: Infinity }], [1, 3, { balance: NaN }], [1, 3, { balance: -1 }]])
    assert.throws(() => planProtection(...args));
});

test("robustness: strange payment amounts never spend the note or crash", () => {
  for (const amt of [Infinity, -Infinity, NaN, -1, 0, 0.0001, 100.0001, 1e30]) {
    const [ledger, w] = make();
    assert.strictEqual(w.pay("alice-key", "bob-key", amt), false, String(amt));
    assert.ok(!ledger.outputs[w.realId].spent);
    assert.deepStrictEqual(w.receipts, []);
  }
});

test("a partial payment gives change and an exact receipt", () => {
  const [, w] = make();
  assert.ok(w.pay("alice-key", "bob-key", 40));
  const r = w.receipts[0];
  assert.ok(Math.abs(r.amount - 39.9999) < 1e-9 && Math.abs(r.change - 60) < 1e-9);
  assert.ok(Math.abs(r.amount + r.fee + r.change - 100) < 1e-9);
});

test("payment needs both parties", () => {
  const [ledger, w] = make();
  assert.ok(!w.pay("alice-key", "alice-key"));
  assert.ok(!ledger.outputs[w.realId].spent);
});

test("paying twice is rejected", () => {
  const [, w] = make();
  assert.ok(w.pay("alice-key", "bob-key"));
  assert.ok(!w.pay("alice-key", "bob-key"));
  assert.match(w.events.at(-1).text, /already spent/);
});

test("one decoy touch trips the alarm when k is 1", () => {
  const [ledger, w] = make({ k: 1 });
  ledger.spend(w.decoys[0], STOLEN);
  assert.strictEqual(w.state, PROTECTED);
});

test("k = 2 needs two touches", () => {
  const [ledger, w] = make({ k: 2 });
  ledger.spend(w.decoys[0], STOLEN);
  assert.strictEqual(w.state, NORMAL);
  ledger.spend(w.decoys[1], STOLEN);
  assert.strictEqual(w.state, PROTECTED);
});

test("protected state blocks payment", () => {
  const [ledger, w] = make();
  ledger.spend(w.decoys[0], STOLEN);
  assert.ok(!w.pay("alice-key", "bob-key"));
  assert.ok(!ledger.outputs[w.realId].spent);
});

test("unlock needs both parties, then the decoy set is restored", () => {
  const [ledger, w] = make();
  ledger.spend(w.decoys[0], STOLEN);
  assert.ok(!w.unlock("alice-key", null));
  assert.strictEqual(w.state, PROTECTED);
  assert.ok(w.unlock("alice-key", "bob-key"));
  assert.strictEqual(w.state, NORMAL);
  assert.strictEqual(w.activeDecoys().length, w.n);
});

test("owner retiring their own decoy is not an alarm", () => {
  const [, w] = make();
  assert.ok(w.retireDecoy(w.decoys[0], "alice-key"));
  assert.strictEqual(w.state, NORMAL);
  assert.strictEqual(w.touched.length, 0);
});

test("a failed retire does not silence a later alarm", () => {
  const [ledger, w] = make();
  const target = w.decoys[0];
  assert.ok(!w.retireDecoy(target, "mallory-key"));
  ledger.spend(target, STOLEN);
  assert.strictEqual(w.state, PROTECTED);
});

test("observer view never exposes amounts or which note is real", () => {
  const [, w] = make();
  const rows = w.observerView();
  assert.strictEqual(rows.length, 4);
  rows.forEach((r) => assert.deepStrictEqual(Object.keys(r).sort(), ["id", "spent"]));
});

test("owner view shows amounts and which note is real", () => {
  const [, w] = make();
  const real = w.ownerView().filter((r) => r.isReal);
  assert.strictEqual(real.length, 1);
  assert.strictEqual(real[0].value, 100);
  assert.strictEqual(real[0].id, w.realId);
});

test("decoys hold a small amount above the fee, with a floor", () => {
  const [, w] = make();
  w.ownerView().filter((r) => !r.isReal).forEach((r) => assert.ok(Math.abs(r.value - 0.1) < 1e-9));
  const small = new CanaryWallet(new Ledger(), { amount: 0.5, rng: mulberry32(1) });
  assert.ok(Math.abs(small.decoyValue - MIN_DECOY) < 1e-12);
});

test("a realistic sweep takes all decoys in one transaction and fires the alarm", () => {
  const [ledger, w] = make();
  const res = sweepAttack(ledger, STOLEN, w.outputIds());
  assert.strictEqual(res[w.realId], false);
  assert.ok(!ledger.outputs[w.realId].spent);
  assert.strictEqual(w.touched.length, 3);
  assert.strictEqual(w.state, PROTECTED);
});

test("a naive sweep (every note in one transaction) is invalid and fires nothing", () => {
  const [ledger, w] = make();
  const res = naiveSweep(ledger, STOLEN, w.outputIds());
  assert.ok(!Object.values(res).some(Boolean));
  assert.ok(Object.values(ledger.outputs).every((o) => !o.spent));
  assert.strictEqual(w.state, NORMAL);
});

test("a transaction is all-or-nothing", () => {
  const [ledger, w] = make();
  assert.ok(!ledger.spendTx([w.decoys[0], w.realId], STOLEN));
  assert.ok(!ledger.outputs[w.decoys[0]].spent);
});

test("recovery key works only after the timelock", () => {
  const [ledger, w] = make({ timeoutBlocks: 10 });
  assert.ok(!w.recoverWithKey("recovery-key"));
  ledger.mine(9);
  assert.ok(!w.recoverWithKey("recovery-key"));
  ledger.mine(1);
  assert.ok(w.recoverWithKey("recovery-key"));
});

test("a wrong key never works, even after the timelock", () => {
  const [ledger, w] = make({ timeoutBlocks: 1 });
  ledger.mine(5);
  assert.ok(!w.recoverWithKey("mallory-key"));
});

test("the recovery branch works even while protected, but only with the recovery key", () => {
  // By design: the timelock branch is a ledger rule, not the wallet's client-side state.
  const [ledger, w] = make({ timeoutBlocks: 10 });
  sweepAttack(ledger, STOLEN, w.outputIds());
  assert.strictEqual(w.state, PROTECTED);
  ledger.mine(10);
  assert.ok(!ledger.canSpend(w.realId, new Set(STOLEN)));
  assert.ok(w.recoverWithKey("recovery-key"));
});

test("attack math: measured odds match k / (n + 1)", () => {
  for (const [n, k, tol] of [[3, 1, 0.03], [3, 2, 0.03], [10, 1, 0.02]]) {
    const rng = mulberry32(42);
    const trials = 4000;
    let hits = 0;
    for (let i = 0; i < trials; i++) hits += blindAttackTrial(n, k, rng) ? 1 : 0;
    assert.ok(Math.abs(hits / trials - k / (n + 1)) < tol, `n=${n} k=${k}: ${hits / trials}`);
  }
});

test("random sequences keep the rules", () => {
  for (let seed = 0; seed < 300; seed++) {
    const rng = mulberry32(seed);
    const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    const n = int(1, 4);
    const k = int(1, n);
    const ledger = new Ledger();
    const w = new CanaryWallet(ledger, { nDecoys: n, k, timeoutBlocks: int(1, 8), rng });
    let legitExit = false;
    for (let step = 0; step < 25; step++) {
      const action = int(0, 10);
      if (action === 0) legitExit = w.pay("alice-key", "bob-key") || legitExit;
      else if (action === 1) w.pay("alice-key", "alice-key");
      else if (action === 2) sweepAttack(ledger, STOLEN, w.outputIds());
      else if (action === 3) naiveSweep(ledger, STOLEN, w.outputIds());
      else if (action === 4) {
        const ids = w.outputIds();
        if (ids.length) ledger.spend(ids[int(0, ids.length - 1)], STOLEN);
      } else if (action === 5) w.unlock("alice-key", null);
      else if (action === 6) w.unlock("alice-key", "bob-key");
      else if (action === 7) ledger.mine(int(1, 6));
      else if (action === 8) w.recoverWithKey("mallory-key");
      else if (action === 9) legitExit = w.recoverWithKey("recovery-key") || legitExit;
      else {
        const live = w.activeDecoys();
        if (live.length) w.retireDecoy(live[int(0, live.length - 1)], rng() < 0.5 ? "alice-key" : "mallory-key");
      }
      const where = `seed ${seed}, step ${step}, action ${action}`;
      if (ledger.outputs[w.realId].spent) assert.ok(legitExit, `real note spent without a legitimate exit (${where})`);
      if (w.state === PROTECTED) assert.ok(w.touched.length >= w.k, `protected too early (${where})`);
      else assert.ok(w.touched.length < w.k, `alarm count reached k but not protected (${where})`);
      assert.ok(w.activeDecoys().length <= w.n, `too many decoys (${where})`);
    }
  }
});
