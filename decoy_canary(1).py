"""Decoy Canary Wallet - core simulator (simulated shielded model).

A pretend shielded pool, a wallet that hides one real payment note among small
decoy notes, and a monitor that watches the decoys.

Honest limits (keep these in the pitch):
  * Everything is simulated. Keys are mock strings. There are no real commitments
    or zero-knowledge proofs; "hidden amounts" only means the outsider view does
    not include them.
  * Whoever holds the sender's key can read the wallet's own notes, amounts
    included, so the small decoys may stand out to that thief (see owner_view).
  * The protected state is client-side: it stops THIS wallet from signing. It does
    not stop someone holding the keys from spending.
  * What really protects the real funds is the two-party rule on the real note.
    The decoys are only the alarm, and it fires only if a decoy is actually spent.
  * Telling "the owner retired a decoy" from "a thief spent it" is an API
    convention here (retire_decoy). On a real chain both use the same key, so a
    real wallet would compare observed spends against its own outbound log.
  * The timelocked recovery branch is simulated. As far as we know a shielded note
    cannot carry a timelock condition, so a real version would use a third key
    share instead. To be verified on testnet.
"""
import random

NORMAL = "NORMAL"
PROTECTED = "PROTECTED"

DEFAULT_AMOUNT = 100
DECOY_FRACTION = 0.001  # each decoy holds 0.1% of the payment...
MIN_DECOY = 0.001       # ...but never less. This must stay above the network fee,
                        # or sweep tools skip the decoy and the alarm never fires.


class Ledger:
    """Pretend pool. Enforces each note's spending rule, like consensus would."""

    def __init__(self):
        self.height = 0
        self.outputs = {}   # note id -> {"value", "rule", "spent"}  (internal, not an outsider view)
        self.watchers = []  # callbacks told about every successful spend

    def mine(self, blocks=1):
        self.height += blocks

    def add_output(self, oid, value, rule):
        self.outputs[oid] = {"value": value, "rule": rule, "spent": False}

    def can_spend(self, oid, signers):
        out = self.outputs.get(oid)
        if out is None or out["spent"]:
            return False
        rule = out["rule"]
        if rule["type"] == "single":
            return rule["key"] in signers
        # "two_party": both keys, OR the recovery key once the timelock has passed
        if set(rule["keys"]) <= set(signers):
            return True
        return rule["recovery_key"] in signers and self.height >= rule["unlock_height"]

    def spend(self, oid, signers):
        return self.spend_tx([oid], signers)

    def spend_tx(self, oids, signers):
        """ONE transaction with several inputs. All-or-nothing, as on a real chain:
        if any input cannot be spent, the whole transaction is invalid and nothing moves."""
        oids = list(dict.fromkeys(oids))  # no duplicate inputs
        signers = set(signers)
        if not oids or not all(self.can_spend(o, signers) for o in oids):
            return False
        for o in oids:
            self.outputs[o]["spent"] = True
        for o in oids:
            for watcher in self.watchers:
                watcher(o, signers)
        return True


class CanaryWallet:
    """One real note (two-party + timelocked recovery branch) hidden among n small decoys."""

    def __init__(self, ledger, name="w", sender="alice-key", receiver="bob-key",
                 recovery_key="recovery-key", n_decoys=3, k=1, timeout_blocks=10,
                 amount=DEFAULT_AMOUNT, decoy_value=None, rng=None, verbose=False):
        if not 1 <= k <= n_decoys:
            raise ValueError("need 1 <= k <= n_decoys")
        self.ledger = ledger
        self.name = name
        self.sender, self.receiver, self.recovery_key = sender, receiver, recovery_key
        self.n, self.k = n_decoys, k
        self.amount = amount
        # Decoys are small but real, and above the fee so sweep tools do not skip them.
        self.decoy_value = (max(amount * DECOY_FRACTION, MIN_DECOY)
                            if decoy_value is None else decoy_value)
        self.verbose = verbose
        self.state = NORMAL
        self.touched = []        # decoys spent without this wallet's authorization
        self.own_spends = set()  # decoys this wallet spent itself (never an alarm)
        self.events = []
        self.receipts = []       # confirmations of payments the receiver got
        self.decoys = []
        self.rng = rng or random.Random()
        real_slot = self.rng.randrange(n_decoys + 1)
        for slot in range(n_decoys + 1):
            oid = self._next_id()
            if slot == real_slot:
                self.real_id = oid
                ledger.add_output(oid, amount, {
                    "type": "two_party", "keys": (sender, receiver),
                    "recovery_key": recovery_key,
                    "unlock_height": ledger.height + timeout_blocks})
            else:
                self._add_decoy(oid)
        self.unlock_height = ledger.outputs[self.real_id]["rule"]["unlock_height"]
        ledger.watchers.append(self._on_spend)

    # -- helpers -----------------------------------------------------------
    def _next_id(self):
        """Random opaque id. A counter would leak: replacement decoys would always
        be newer than the real note."""
        while True:
            oid = f"{self.name}:{self.rng.getrandbits(24):06x}"
            if oid not in self.ledger.outputs:
                return oid

    def _add_decoy(self, oid):
        self.ledger.add_output(oid, self.decoy_value, {"type": "single", "key": self.sender})
        self.decoys.append(oid)

    def _active_decoys(self):
        return [d for d in self.decoys if not self.ledger.outputs[d]["spent"]]

    def _top_up(self):
        while len(self._active_decoys()) < self.n:
            self._add_decoy(self._next_id())

    def _log(self, text):
        line = f"[block {self.ledger.height}] {text}"
        self.events.append(line)
        if self.verbose:
            print(line)

    def output_ids(self):
        """Unspent note ids in random order, real one not marked."""
        ids = [i for i in [self.real_id] + self._active_decoys()
               if not self.ledger.outputs[i]["spent"]]
        self.rng.shuffle(ids)
        return ids

    def observer_view(self):
        """What an outsider sees: ids and spent flags in random order.
        No amounts and nothing marked as real."""
        rows = [{"id": i, "spent": self.ledger.outputs[i]["spent"]}
                for i in [self.real_id] + self.decoys]
        self.rng.shuffle(rows)
        return rows

    def owner_view(self):
        """What only the owner (or a thief holding the key) can read: amounts and which is real."""
        return [{"id": i, "value": self.ledger.outputs[i]["value"],
                 "is_real": i == self.real_id, "spent": self.ledger.outputs[i]["spent"]}
                for i in [self.real_id] + self.decoys]

    # -- the monitor -------------------------------------------------------
    def _on_spend(self, oid, signers):
        """Watches every spend on the ledger. A decoy spent without our say-so is the alarm."""
        if oid in self.decoys and oid not in self.own_spends:
            self.touched.append(oid)
            self._log(f"ALARM: decoy {oid} was spent without this wallet's authorization "
                      f"(unauthorized decoy spends so far: {len(self.touched)}, "
                      f"protected state at {self.k})")
            if len(self.touched) >= self.k and self.state == NORMAL:
                self.state = PROTECTED
                self._log("PROTECTED STATE: wallet will not sign until both parties authorize")

    # -- what the wallet does ---------------------------------------------
    def select_coin(self):
        """Coin selection only ever picks the real note, never a decoy."""
        return self.real_id

    def pay(self, sender_auth, receiver_auth):
        if self.state == PROTECTED:
            self._log("payment BLOCKED: wallet is in the protected state")
            return False
        if self.ledger.outputs[self.real_id]["spent"]:
            self._log("payment REJECTED: the real note is already spent")
            return False
        ok = self.ledger.spend(self.select_coin(), {sender_auth, receiver_auth})
        if ok:
            self.receipts.append({"to": self.receiver, "amount": self.amount,
                                  "block": self.ledger.height})
            self._log(f"payment sent: {self.receiver} received {self.amount:g} (confirmed at block {self.ledger.height})")
        else:
            self._log("payment REJECTED: needs both parties")
        return ok

    def unlock(self, sender_auth, receiver_auth):
        """Normal recovery: needs authorization from both parties (mock tokens)."""
        if self.state != PROTECTED:
            return True
        if not {self.sender, self.receiver} <= {sender_auth, receiver_auth}:
            self._log("unlock REJECTED: both parties must authorize")
            return False
        self.state = NORMAL
        self.touched = []
        self._top_up()  # simulator behaviour: restore n active decoys (each would cost a fee for real)
        self._log("unlocked by both parties; simulated decoy set restored; back to NORMAL")
        return True

    def recover_with_key(self, key):
        """Fallback branch: the pre-committed recovery key, only after the timelock.

        By design this does NOT check the wallet's protected state. The timelock
        branch is a rule the ledger enforces, not something the client-side wallet
        controls, and it is the way out when the receiver has vanished. The cost:
        anyone holding the recovery key can use it after the timelock, even while the
        wallet is protected. Keep that key separate from everyday keys.
        """
        ok = self.ledger.spend(self.real_id, {key})
        self._log("funds released by recovery key (timelock branch)" if ok
                  else "recovery-key release REJECTED (wrong key, timelock not reached, or already spent)")
        return ok

    def retire_decoy(self, oid, sender_auth):
        """Owner spends one of their own decoys on purpose: no false alarm."""
        if oid not in self.decoys:
            return False
        self.own_spends.add(oid)
        ok = self.ledger.spend(oid, {sender_auth})
        if not ok:
            self.own_spends.discard(oid)  # a failed retire must not silence a later alarm
        return ok


# -- attacks, used by the demo and the tests ----------------------------------
def sweep_attack(ledger, stolen_keys, targets):
    """A thief sweeps the way a real sweep tool does: it collects only the notes the
    stolen keys can spend and sends them in ONE transaction."""
    keys = set(stolen_keys)
    spendable = [oid for oid in targets if ledger.can_spend(oid, keys)]
    ok = bool(spendable) and ledger.spend_tx(spendable, keys)
    return {oid: ok and oid in spendable for oid in targets}


def naive_sweep(ledger, stolen_keys, targets):
    """A careless thief puts EVERY note into one transaction, including ones the
    stolen keys cannot spend. All-or-nothing: the whole transaction is invalid."""
    ok = ledger.spend_tx(list(targets), stolen_keys)
    return {oid: ok for oid in targets}


def blind_attack_trial(n, k, rng):
    """One blind attacker touches notes in random order. True if they reach the
    real note before the wallet enters the protected state."""
    ledger = Ledger()
    wallet = CanaryWallet(ledger, n_decoys=n, k=k, rng=rng)
    order = wallet.output_ids()
    rng.shuffle(order)
    for oid in order:
        if wallet.state == PROTECTED:
            return False
        if oid == wallet.real_id:
            return True
        ledger.spend(oid, {wallet.sender})
    return False
