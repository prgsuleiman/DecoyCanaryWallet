// Run with:  node --test
const test = require("node:test");
const assert = require("node:assert");
const { NORMAL, PROTECTED, looksLikeTransparentAddress, addrUrl, snapshot, DecoyWatcher } = require("./watch.js");

const A = "tm" + "1".repeat(32) + "1"; // looks like a transparent testnet address (pretend)
const B = "tm" + "1".repeat(32) + "2";
const C = "tm" + "1".repeat(32) + "3";
const BASE = "https://explorer.example/api";

/** A fake Insight explorer: address -> numbers. Returns the same shape as the real API. */
function fakeExplorer(initial) {
  const data = {};
  for (const a of Object.keys(initial)) data[a] = Object.assign({ balanceSat: 100000, totalSentSat: 0, totalReceivedSat: 100000, unconfirmedBalanceSat: 0 }, initial[a]);
  const calls = [];
  return {
    data, calls,
    fetchJson: async (url) => {
      calls.push(url);
      const addr = decodeURIComponent(url.split("/addr/")[1]);
      if (!(addr in data)) throw new Error("HTTP 404");
      if (data[addr].__down) throw new Error("network down");
      return Object.assign({}, data[addr]);
    },
    spend(a) { data[a].totalSentSat += data[a].balanceSat; data[a].balanceSat = 0; },
  };
}

const make = (ex, opts = {}) => new DecoyWatcher(Object.assign({ addresses: [A, B, C], k: 1, base: BASE, fetchJson: ex.fetchJson }, opts));

test("address check accepts plausible transparent addresses and rejects junk", () => {
  assert.ok(looksLikeTransparentAddress(A));
  for (const bad of ["", "abc", "utest1" + "q".repeat(60), "zs1" + "q".repeat(70), A + "0", "t0" + "1".repeat(33), null, 5])
    assert.ok(!looksLikeTransparentAddress(bad), String(bad));
});

test("url builder trims slashes and encodes the address", () => {
  assert.strictEqual(addrUrl("https://x/api///", A), `https://x/api/addr/${A}`);
});

test("snapshot reads the numbers and rejects nonsense", () => {
  assert.deepStrictEqual(snapshot({ balanceSat: "5", totalSentSat: 0 }), { balanceSat: 5, totalSentSat: 0, totalReceivedSat: 0, unconfirmedSat: 0 });
  for (const bad of [null, "x", {}, { balanceSat: 1 }, { balanceSat: "abc", totalSentSat: 0 }, { balanceSat: Infinity, totalSentSat: 0 }])
    assert.throws(() => snapshot(bad));
});

test("constructor validates addresses, k and the fetch function", () => {
  const ex = fakeExplorer({ [A]: {} });
  assert.throws(() => new DecoyWatcher({ addresses: [], fetchJson: ex.fetchJson }));
  assert.throws(() => new DecoyWatcher({ addresses: ["nope"], fetchJson: ex.fetchJson }));
  assert.throws(() => new DecoyWatcher({ addresses: [A], k: 2, fetchJson: ex.fetchJson }));
  assert.throws(() => new DecoyWatcher({ addresses: [A], k: 0, fetchJson: ex.fetchJson }));
  assert.throws(() => new DecoyWatcher({ addresses: [A] }));
  assert.throws(() => new DecoyWatcher({ addresses: Array.from({ length: 51 }, (_, i) => "tm" + "1".repeat(31) + String(i).padStart(2, "1")), fetchJson: ex.fetchJson }));
  assert.strictEqual(new DecoyWatcher({ addresses: [A, A], k: 1, fetchJson: ex.fetchJson }).addresses.length, 1); // duplicates dropped
});

test("nothing happens while nobody spends a decoy", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const w = make(ex);
  await w.start();
  assert.deepStrictEqual(await w.poll(), []);
  assert.strictEqual(w.state, NORMAL);
  assert.deepStrictEqual(Object.values(w.status), ["watching", "watching", "watching"]);
});

test("a spent decoy trips the alarm and the protected state (k = 1)", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const events = [];
  const w = make(ex, { onEvent: (e) => events.push(e) });
  await w.start();
  ex.spend(B);
  assert.deepStrictEqual(await w.poll(), [B]);
  assert.strictEqual(w.state, PROTECTED);
  assert.strictEqual(w.status[B], "SPENT");
  assert.ok(events.some((e) => e.kind === "alarm" && /ALARM/.test(e.text)));
  assert.deepStrictEqual(await w.poll(), []); // the same spend is not reported twice
  assert.strictEqual(w.alarmed.length, 1);
});

test("k = 2 needs two spent decoys", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const w = make(ex, { k: 2 });
  await w.start();
  ex.spend(A);
  await w.poll();
  assert.strictEqual(w.state, NORMAL);
  ex.spend(C);
  await w.poll();
  assert.strictEqual(w.state, PROTECTED);
});

test("a pending spend (negative unconfirmed balance) is an early alarm", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const w = make(ex);
  await w.start();
  ex.data[A].unconfirmedBalanceSat = -100000;
  assert.deepStrictEqual(await w.poll(), [A]);
});

test("receiving more money is not an alarm", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const w = make(ex);
  await w.start();
  ex.data[A].balanceSat += 5000;
  ex.data[A].totalReceivedSat += 5000;
  ex.data[A].unconfirmedBalanceSat = 5000;
  assert.deepStrictEqual(await w.poll(), []);
  assert.strictEqual(w.state, NORMAL);
});

test("a spend the owner declared is never an alarm, and a failed declaration changes nothing", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const w = make(ex);
  await w.start();
  assert.ok(!w.markOwnerSpend("tm" + "1".repeat(32) + "9")); // not a watched address
  assert.ok(w.markOwnerSpend(A));
  ex.spend(A);
  assert.deepStrictEqual(await w.poll(), []);
  assert.strictEqual(w.state, NORMAL);
  assert.strictEqual(w.status[A], "retired");
  ex.spend(B); // a different decoy is still watched
  assert.deepStrictEqual(await w.poll(), [B]);
});

test("an unreachable explorer is 'unknown', never an alarm and never 'safe'", async () => {
  const ex = fakeExplorer({ [A]: {}, [B]: {}, [C]: {} });
  const events = [];
  const w = make(ex, { onEvent: (e) => events.push(e) });
  await w.start();
  ex.data[A].__down = true;
  assert.deepStrictEqual(await w.poll(), []);
  assert.strictEqual(w.status[A], "unknown");
  assert.strictEqual(w.state, NORMAL);
  assert.ok(events.some((e) => e.kind === "warn"));
  // it comes back, and the spend that happened meanwhile is caught
  ex.spend(A);
  delete ex.data[A].__down;
  assert.deepStrictEqual(await w.poll(), [A]);
});

test("an address that failed at start gets its baseline on the first good read", async () => {
  const ex = fakeExplorer({ [A]: { __down: true }, [B]: {}, [C]: {} });
  const w = make(ex);
  await w.start();
  assert.strictEqual(w.status[A], "unknown");
  delete ex.data[A].__down;
  await w.poll();
  assert.strictEqual(w.status[A], "watching");
  ex.spend(A);
  assert.deepStrictEqual(await w.poll(), [A]);
});

test("a decoy that was already spent before watching is flagged, not silently trusted", async () => {
  const ex = fakeExplorer({ [A]: { totalSentSat: 500 }, [B]: {}, [C]: {} });
  const events = [];
  const w = make(ex, { onEvent: (e) => events.push(e) });
  await w.start();
  assert.ok(events.some((e) => e.kind === "warn" && /already spent/.test(e.text)));
});

test("garbage from the explorer never crashes the watcher", async () => {
  let reply = { balanceSat: 1, totalSentSat: 0 };
  const w = new DecoyWatcher({ addresses: [A], k: 1, base: BASE, fetchJson: async () => reply });
  await w.start();
  for (reply of [null, "x", {}, { balanceSat: "zzz", totalSentSat: 0 }, { balanceSat: NaN, totalSentSat: 0 }]) {
    assert.deepStrictEqual(await w.poll(), []);
    assert.strictEqual(w.state, NORMAL);
  }
});
