"""One command plays the whole Decoy Canary Wallet story:  python3 demo.py

Simulation only: mock keys, a pretend shielded pool, no real cryptography."""
import random

from decoy_canary import CanaryWallet, Ledger, blind_attack_trial, naive_sweep, sweep_attack


def scene(title):
    print(f"\n=== {title} ===")


def fresh(name="alice", seed=7, **kw):
    ledger = Ledger()
    wallet = CanaryWallet(ledger, name=name, n_decoys=3, k=1, verbose=True,
                          rng=random.Random(seed), **kw)
    return ledger, wallet


# 1. Normal path ---------------------------------------------------------------
scene("1. Normal payment")
ledger, wallet = fresh()
print("What an outsider sees (no amounts, nothing marked):")
for row in wallet.observer_view():
    print(f"   {row['id']}  {'spent' if row['spent'] else 'unspent'}")
print("What only the owner can see:")
for row in wallet.owner_view():
    print(f"   {row['id']}  amount {row['value']:g}  {'REAL' if row['is_real'] else 'decoy'}")
wallet.pay("alice-key", "bob-key")

# 2. Attack path: a thief steals the sender's key and sweeps -------------------------
scene("2. Attack: a thief with Alice's stolen key sweeps what that key can spend")
ledger, wallet = fresh()
results = sweep_attack(ledger, {"alice-key"}, wallet.output_ids())
taken = sum(results.values())
print(f"  one transaction took {taken} of {len(results)} notes")
print(f"Real note still safe? {not ledger.outputs[wallet.real_id]['spent']} "
      "(it needs BOTH parties' keys)")
print("Note: the protected state is client-side, and the alarm only fires once a decoy is")
print("spent. The two-party rule on the real note is what protects the real funds.")

scene("2b. The wallet is now protected")
wallet.pay("alice-key", "bob-key")
wallet.unlock("alice-key", None)          # sender alone is not enough
wallet.unlock("alice-key", "bob-key")     # both parties authorize
print(f"State: {wallet.state}; active decoys: {len(wallet._active_decoys())} (simulated restore)")

scene("2c. A careless thief puts EVERY note into one transaction")
ledger, wallet = fresh()
results = naive_sweep(ledger, {"alice-key"}, wallet.output_ids())
print(f"  transaction accepted? {any(results.values())}  "
      "(the real note needs Bob's key, so the whole transaction is invalid)")
print(f"  wallet state: {wallet.state}. Nothing moved, so no alarm either.")

# 3. Receiver disappears: recovery-key branch after the timelock --------------
scene("3. Receiver unavailable: timelocked recovery-key branch (simulated)")
ledger, wallet = fresh(name="carol", seed=3, timeout_blocks=10)
sweep_attack(ledger, {"alice-key"}, wallet.output_ids())
wallet.recover_with_key("recovery-key")   # too early
ledger.mine(10)
wallet.recover_with_key("recovery-key")   # after the timeout

# 4. The attack math, measured on the real code ------------------------------------
scene("4. Attack math: chance a BLIND attacker reaches the real note first")
print("  (a model, not a guarantee; it assumes the attacker cannot tell notes apart)")
rng = random.Random(1)
print(f"  {'n':>3} {'k':>3} {'formula k/(n+1)':>16} {'simulated':>10}")
for n, k in [(3, 1), (3, 2), (5, 1), (10, 1)]:
    trials = 5000
    hits = sum(blind_attack_trial(n, k, rng) for _ in range(trials))
    print(f"  {n:>3} {k:>3} {k / (n + 1):>15.1%} {hits / trials:>10.1%}")
