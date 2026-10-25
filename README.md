# Decoy Canary Wallet

A tripwire for wallet compromise. One real payment output hides among decoy outputs that the owner's wallet watches. If a decoy is spent without the wallet's own authorization, the wallet enters a **protected state** and will not sign again until both parties authorize.

> **Status: a working simulation.** Mock keys, a pretend ledger, no connection to Zcash yet. Read [Honest limits](#honest-limits) before judging what it proves.

## Try it

- **In the browser:** open `index.html`. Add `?seed=7` to the address for a repeatable run.
- **In the terminal:** `python3 demo.py` plays the whole story: a normal payment, a thief sweeping every output, the protected state, the two-party unlock, the timelocked recovery key, and the attack odds measured on the real code.
- **Tests:** `python3 -m unittest test_decoy_canary` (42 tests) and `node --test` (29 tests, the browser logic).
- **Decoy planner:** the page has a "Protect a payment" section. Enter the amount you want to send. The network fee comes out of it, so the receiver gets amount minus fee. You can set the decoy value yourself (it must stay above the fee) or leave it on auto. The page shows the decoy size, the fees, what stays locked in decoys and a checklist. It only plans: it sends nothing and connects to no wallet.

No dependencies. Python 3.8+, and Node 18+ for the JavaScript tests.

## How it works

| Piece | What it does |
| --- | --- |
| Real output | Needs Alice's and Bob's keys (2-of-2). A separate branch lets a pre-committed recovery key spend it after N blocks. |
| Decoys | n small notes (0.1% of the payment, above the fee), spendable with Alice's key only. |
| Monitor | Watches the ledger. A decoy spent without the wallet's own authorization is the alarm. |
| Protected state | After k alarms the wallet refuses to sign. Unlocking needs both parties. |
| Recovery key | A fallback spending branch, not an override of the 2-of-2 path. Opens only after the timelock. |

Coin selection only ever picks the real output, so the wallet cannot trip its own alarm. A thief who steals Alice's key and sweeps every output takes the decoys and fires the alarm, but fails on the real output because it also needs Bob's key. After an unlock the spent decoys are replaced with new ones under random ids, so replacements are not recognisable by age.

## Attack odds

If a blind attacker touches outputs in random order, the chance they reach the real output before the protected state is:

```
P = k / (n + 1)        n = decoys, k = unauthorized decoy spends that trigger protection
```

With n = 3: 25% at k = 1, 50% at k = 2. The simulator measures this on the real code and the tests check it against the formula (for example 25.3% measured vs 25.0% at n = 3, k = 1 in `demo.py`).

This is a model, not a guarantee. It assumes the attacker cannot tell the outputs apart. Against a thief who sweeps everything, what protects the real funds is the two-party rule, not the odds.

## Honest limits

- **It is a simulation.** Keys are mock strings. There is no real cryptography and no Zcash network.
- **The protected state is client-side.** It stops this wallet from signing. It does not stop someone who holds the keys from spending on the ledger. The decoys are the alarm; the 2-of-2 rule on the real output is the protection.
- **Bait costs real value.** Decoys hold a small amount (0.1% of the payment, always above the network fee so sweep tools do not skip them). Outsiders cannot see amounts in the shielded model, but a thief holding the key can read them, and keeps any decoy they sweep: n × decoy amount.
- **An attacker who controls the wallet** can learn which output is real, and then the decoys no longer help.
- **The recovery key is a single point of trust.** The timelocked branch is enforced by the ledger, not by the wallet's protected state, so it still works while the wallet is protected. That is intended: it is the way out if the receiver disappears. It means anyone holding the recovery key can use it after the timelock, so keep that key separate from everyday keys. The timeout trades weaker protection against stuck funds.
- **The alarm is early warning, not prevention.** By the time a decoy is spent, it is already gone. The two-party rule on the real output is what protects the real funds.
- **"Looks the same" assumes script-hash outputs,** so spending conditions stay hidden until spent. This has to be checked on the chosen chain before it is claimed.
- **No privacy claim.** This project does not make a payment private. It is an early-warning layer to sit beside one.

## Next step

Decoys are meant to be small shielded notes. Next: a testnet watcher that sends a few small notes and detects when one is spent (see [TESTNET.md](TESTNET.md)), then threshold signing such as FROST for the two-party rule. None of this is verified yet.

## Prior art

- **Canarytokens** (Thinkst): decoy assets that stay dormant until touched, then alert the owner.
- **Peter Todd, honeypot outputs, bitcoin-dev mailing list, August 2016:** a proposal for honeypot outputs that reveal a server compromise when spent.

This project combines the idea with a wallet: decoys among real outputs, a protected state after a trigger, and a two-party unlock with a separate timelocked recovery branch.

## Files

| File | Purpose |
| --- | --- |
| `decoy_canary.py` | Ledger, wallet, monitor, attacks (Python) |
| `test_decoy_canary.py` | 42 tests |
| `demo.py` | One command plays the whole story |
| `canary.js` | The same logic in JavaScript |
| `canary.test.js` | 29 tests for the JavaScript logic |
| `index.html` | Interactive browser demo |
| `TESTNET.md` | Optional plan for a Zcash testnet check |

## Build notes

All code in this repository was written during the Zecathon 2026 build window, with AI assistance (Claude for the build; ChatGPT and Gemini as reviewers of the design). No third-party libraries.

## License

MIT, see `LICENSE`.

## Use it in your wallet

The decoy and alarm logic is small and has no dependencies. A wallet could call it like this:

- `plan_protection(amount, n_decoys, fee, balance)` (Python) / `planProtection(amount, nDecoys, {fee, balance})` (JavaScript): the fee comes out of the payment, so the receiver gets amount minus fee. It returns the decoy size (0.1% of the payment, never below 10 times the network fee, or your own value if it is above the fee), the fees, the value held in decoys, whether the balance covers it, and the steps. It only calculates.
- `CanaryWallet(..., amount, fee, decoy_value)` and its monitor: `pay(sender, receiver, amount)` takes the fee out of the amount, returns any change to the sender and gives the receiver a receipt; the alarm and protected-state logic, run against the simulated ledger.

Pass the real minimum fee of your network. Testnet measured 0.0001 ZEC.

## Zcash mapping (plan, not built)

Based on the public ZIP index; none of this is implemented or tested yet.

| Our piece | Zcash building block | Status in the ZIP index |
| --- | --- | --- |
| Decoys | Small shielded notes (must stay above the current minimum fee, see ZIPs 2002 and 2009) | n/a |
| Alarm / watcher | Viewing keys and light-client note scanning: ZIP 316, ZIP 307. Detecting a spend means watching for the note's nullifier, which we have not verified | Drafts |
| Two-party rule on the real note | FROST spend authorization: ZIP 312, with partially created transactions: ZIP 374 | Drafts |
| Timeout recovery | No shielded timelock found; a third key share is the likely replacement (ZIP 203 is transaction expiry, not a note lock) | Simulated here |

Open question: which shielded pool to use on testnet (several ZIPs concern Orchard, see ZIP 326). Check before building.

Testnet note: a first small payment (0.001 ZEC, fee 0.0001 ZEC) to a `utest1…` unified address confirmed in Brave Wallet. A unified address can hold shielded receivers, but the wallet does not show which pool a transfer used, so we do not claim the decoy notes are shielded until that is verified.

## Threat model

**In scope:** one stolen sender key (a sweep of whatever that key can spend), blind attackers who cannot tell notes apart, a receiver who disappears.

**Out of scope:** a stolen receiver key, seed or wallet-software compromise, a thief who skips small notes after reading amounts, consensus attacks, and real cryptography (this is a simulation of the shielded model; a testnet check is the next step).

**All-or-nothing transactions:** a realistic sweep tool only includes notes its key can spend, so it takes every decoy in one transaction and fires the alarm. A careless transaction that includes the two-key note is invalid as a whole: nothing moves and no alarm fires. Either way the real funds stay safe.
