# Zecathon submission: draft fields

Paste these into the form, then change anything that is not true for you.
Deadline: Oct 28, 2026, 23:59 UTC (that is 00:59 on Oct 29 in Lagos). Aim to submit on Oct 27.

## Project name (max 64)

Decoy Canary Wallet

## Track

Core & Tooling. The project is a wallet-side safety layer: a simulator, a decoy planner and a browser demo for protecting private funds.

Honest note: the Core & Tooling track examples are infrastructure (Zebra, librustzcash, SDKs, provers). This project is a small reusable module plus a simulator, not infrastructure. Reread the track text on the form before choosing. The simulation is not connected to Zcash yet, and the description says so.

## Description (max 2000)

Decoy Canary Wallet is a tripwire for wallet compromise.

One real payment output sits among decoy outputs that the owner's wallet watches. Decoys are meant to be small shielded notes, so outsiders cannot see amounts and nothing marks which one is real. If a decoy is spent without the wallet's own authorization, the wallet enters a protected state and refuses to sign until both sender and receiver authorize. A separate timelocked branch lets a pre-committed recovery key release the funds if the receiver disappears.

The alarm is early warning only: by then a decoy has already been spent. What protects the real funds is the two-party rule on the real output, so a thief holding one stolen key can take decoys and set off the alarm, but cannot take the real funds.

Why Core & Tooling: it is a small, reusable wallet-side safety layer, not an app. It includes a planner that turns the chosen amount (fee taken out of it) and an adjustable decoy value into decoy sizes and costs. It makes no privacy claim of its own.

What is built: a simulated ledger and wallet in Python and JavaScript, 42 + 29 automated tests, and a browser demo with a decoy planner, where the judge plays the thief, watches the alarm, then tries to unlock with one party and with both. The odds that a blind attacker reaches the real output before the wallet protects itself, k/(n+1), are measured on the real code and match the formula. They describe detection, not the safety of the funds. The alarm says a key was stolen; the second key still guards the real funds.

Limits: keys are mock strings and there is no Zcash integration yet. The protected state is client-side, so it does not stop a key-holder spending on the ledger. The recovery branch is enforced by the ledger, so it works even while the wallet is protected; that key must be kept separate from everyday keys. An attacker who controls the wallet can learn which output is real. Mapping to Zcash is still to be verified on testnet.

## Questions a judge may ask

| Question | Honest answer |
| --- | --- |
| Does the alarm stop the theft? | No. It is early warning. The two-party rule on the real output is the protection. |
| Why can the recovery key work while the wallet is protected? | It is the way out if the receiver disappears, and the ledger enforces it, not the wallet. The key has to be kept apart from everyday keys. |
| Is this on Zcash? | Not the decoy logic: that is a simulation. We made one real small payment on Zcash testnet through a wallet to measure the fee (0.0001 ZEC). We do not claim those notes are shielded, because the wallet does not show the pool. |
| Is it new? | The idea of decoys that alert when touched is old (Canarytokens, a 2016 bitcoin-dev honeypot proposal). The combination here, decoys among real outputs with a protected state and a two-party unlock, is what we built. |

## Code repository

The GitHub repo link. It is public, which rule 3 allows.

## Working demo

The GitHub Pages link (`https://<your-username>.github.io/<repo-name>/`). It serves `index.html` and `canary.js` from the top level of the repo. Open it in a private window before submitting.

## Demo video (2 minutes)

Follow `VIDEO_SCRIPT.md` (kept on your computer, not in the repo). Open the demo with `?seed=7` so the run is the same every time. Upload to YouTube or Google Drive with "anyone with the link can view" and test the link in a private window.

## Checklist

- [ ] Repo public, all files named correctly (no `(1)` in any name), latest files uploaded.
- [ ] Demo link opens in a private window and the buttons work (thief sweep, unlock, pay with an amount, planner).
- [ ] Video recorded, uploaded, link tested in a private window.
- [ ] Track chosen and the description pasted (under 2,000 characters).
- [ ] Repo-public box ticked, then SUBMIT. You can still edit until the deadline.
- [ ] Never put a seed phrase, key or password in the repo, the form or the video.
