# Testnet check (optional, not done yet)

Goal: show the alarm working on real shielded notes. Everything here is a plan and is unverified.

1. Get a Zcash testnet wallet (a testnet-capable wallet or the official command-line tools).
2. Get free test coins from a testnet faucet.
3. Send yourself a few small shielded notes (the decoys).
4. Write a watcher that scans the wallet's own notes and reports when one is spent without your own wallet doing it.
5. Spend one decoy from a second copy of the wallet (play the thief) and watch the alarm fire.

Not covered: the two-party rule on a shielded note (needs threshold signing such as FROST) and the timelock (shielded notes probably cannot carry one).
