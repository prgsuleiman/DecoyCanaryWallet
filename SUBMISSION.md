# Zecathon submission: draft fields

Paste these into the form, then change anything that is not true for you.
Deadline: Oct 28, 2026, 23:59 UTC (that is 00:59 on Oct 29 in Lagos). Aim to submit on Oct 27.

## Project name (max 64)

Decoy Canary Wallet

## Track

Core & Tooling. The project is a wallet-side safety tool: a simulator, a watcher and a browser demo for protecting private funds.

Honest note: the track descriptions on the form should be reread before submitting. The simulation is not connected to Zcash yet, which the description says openly.

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
| Is this on Zcash? | Not yet. It is a simulation. The next step is to map it to Zcash and test it. |
| Is it new? | The idea of decoys that alert when touched is old (Canarytokens, a 2016 bitcoin-dev honeypot proposal). The combination here, decoys among real outputs with a protected state and a two-party unlock, is what we built. |

## Code repository

Private until you are ready, then public. Rule 3 says a private repo made public on Oct 28 counts, but make it public on Oct 27 so a mistake still leaves a day.

## Working demo

A link a judge can open. Two static files (`index.html`, `canary.js`), so any static host works.
- GitHub Pages on a private repo usually needs a paid GitHub plan, so on the free plan switch it on when the repo goes public on Oct 27. Check this on your account.
- Or drag the folder onto a static host that gives a public link. Do this on Oct 27 too, so the demo is not public before you submit.

## Demo video (2 minutes)

Record with `index.html?seed=7` so the run is the same every time.

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Title and the "Simulation" tag | One real payment hides among decoys. If a decoy moves when you did not move it, the wallet protects itself. |
| 0:15 | Observer view, then Owner view | From outside every output looks the same. Only the owner knows which is real. Press Alice + Bob pay. |
| 0:35 | New wallet, Thief sweeps everything | A thief with Alice's stolen key takes the decoys. The alarm fires. The real output stays safe because it needs Bob's key too. |
| 1:05 | Try pay (blocked), Unlock Alice only (rejected), Unlock Alice + Bob | The wallet is in a protected state. Only both parties can resume. |
| 1:30 | Honest limits box | This is a simulation. The alarm is early warning. Decoys cost real value. The two-party rule is the real protection. |
| 1:50 | Next step | Next: map it to Zcash and test it. |

## Checklist

- [ ] Oct 22: optional one-day Zcash testnet check. If it fails, stay on the simulation and say so.
- [ ] Oct 24: ask someone who has not seen the project to read the README.
- [ ] Oct 26: record the video.
- [ ] Oct 27: repo public, demo link live, SUBMIT. Tick the repo-public box on the form.
- [ ] Oct 28: buffer. Fixes only.
- [ ] Never put a seed phrase, key or password in the repo, the form or the video.
