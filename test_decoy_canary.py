import random
import unittest

from decoy_canary import (MAX_DECOYS, MIN_DECOY, NORMAL, PROTECTED, CanaryWallet, Ledger,
                          blind_attack_trial, naive_sweep, plan_protection, sweep_attack)

STOLEN = {"alice-key"}  # a thief who has stolen the sender's key only


def make(n=3, k=1, **kw):
    ledger = Ledger()
    return ledger, CanaryWallet(ledger, n_decoys=n, k=k, rng=random.Random(1), **kw)


class CoreBehaviour(unittest.TestCase):
    def test_normal_payment_succeeds(self):
        ledger, w = make()
        self.assertTrue(w.pay("alice-key", "bob-key"))
        self.assertTrue(ledger.outputs[w.real_id]["spent"])
        self.assertEqual(w.state, NORMAL)

    def test_receiver_gets_a_receipt(self):
        _, w = make()
        self.assertEqual(w.receipts, [])
        w.pay("alice-key", "bob-key")
        self.assertEqual(w.receipts, [{"to": "bob-key", "amount": 99.9999, "fee": 0.0001,
                                       "change": 0, "block": 0}])
        self.assertIn("bob-key received 99.9999", w.events[-1])

    def test_sender_and_receiver_choose_the_amount_and_the_fee_comes_out_of_it(self):
        _, w = make(amount=0.05)
        self.assertTrue(w.pay("alice-key", "bob-key", amount=0.02))
        r = w.receipts[0]
        self.assertAlmostEqual(r["amount"], 0.0199)    # 0.02 minus the 0.0001 fee
        self.assertAlmostEqual(r["change"], 0.03)      # the rest returns to the sender
        self.assertAlmostEqual(r["amount"] + r["fee"] + r["change"], 0.05)

    def test_bad_payment_amounts_are_rejected_and_nothing_moves(self):
        ledger, w = make(amount=0.05)
        for bad in (0, -1, 0.0001, 0.00005, 0.06):
            self.assertFalse(w.pay("alice-key", "bob-key", amount=bad), bad)
        self.assertFalse(ledger.outputs[w.real_id]["spent"])
        self.assertEqual(w.receipts, [])
        self.assertTrue(w.pay("alice-key", "bob-key", amount=0.05))   # the whole note is fine

    def test_decoy_value_can_be_set_but_must_beat_the_fee(self):
        w = CanaryWallet(Ledger(), decoy_value=0.5, rng=random.Random(1))
        self.assertTrue(all(r["value"] == 0.5 for r in w.owner_view() if not r["is_real"]))
        for bad in (0.0001, 0.00005, 0):
            with self.assertRaises(ValueError):
                CanaryWallet(Ledger(), decoy_value=bad, fee=0.0001, rng=random.Random(1))
        with self.assertRaises(ValueError):
            CanaryWallet(Ledger(), fee=0, rng=random.Random(1))

    def test_default_decoy_scales_with_a_bigger_fee(self):
        w = CanaryWallet(Ledger(), amount=100, fee=0.05, rng=random.Random(1))
        self.assertGreater(w.decoy_value, 0.05)

    def test_failed_or_blocked_payment_gives_no_receipt(self):
        ledger, w = make()
        w.pay("alice-key", "alice-key")
        ledger.spend(w.decoys[0], STOLEN)
        w.pay("alice-key", "bob-key")
        self.assertEqual(w.receipts, [])

    def test_payment_needs_both_parties(self):
        ledger, w = make()
        self.assertFalse(w.pay("alice-key", "alice-key"))
        self.assertFalse(ledger.outputs[w.real_id]["spent"])

    def test_paying_twice_is_rejected(self):
        _, w = make()
        self.assertTrue(w.pay("alice-key", "bob-key"))
        self.assertFalse(w.pay("alice-key", "bob-key"))
        self.assertIn("already spent", w.events[-1])

    def test_one_decoy_touch_trips_alarm_when_k_is_1(self):
        ledger, w = make(k=1)
        ledger.spend(w.decoys[0], STOLEN)
        self.assertEqual(w.state, PROTECTED)

    def test_k2_needs_two_touches(self):
        ledger, w = make(k=2)
        ledger.spend(w.decoys[0], STOLEN)
        self.assertEqual(w.state, NORMAL)
        ledger.spend(w.decoys[1], STOLEN)
        self.assertEqual(w.state, PROTECTED)

    def test_protected_state_blocks_payment(self):
        ledger, w = make()
        ledger.spend(w.decoys[0], STOLEN)
        self.assertFalse(w.pay("alice-key", "bob-key"))
        self.assertFalse(ledger.outputs[w.real_id]["spent"])

    def test_unlock_needs_both_parties(self):
        ledger, w = make()
        ledger.spend(w.decoys[0], STOLEN)
        self.assertFalse(w.unlock("alice-key", None))
        self.assertEqual(w.state, PROTECTED)
        self.assertTrue(w.unlock("alice-key", "bob-key"))
        self.assertEqual(w.state, NORMAL)
        self.assertEqual(w.touched, [])
        self.assertEqual(len(w._active_decoys()), w.n)  # decoy set restored

    def test_owner_retiring_own_decoy_is_not_an_alarm(self):
        ledger, w = make()
        self.assertTrue(w.retire_decoy(w.decoys[0], "alice-key"))
        self.assertEqual(w.state, NORMAL)
        self.assertEqual(w.touched, [])

    def test_failed_retire_does_not_silence_a_later_alarm(self):
        """Bug guard: a retire that fails must not leave the decoy marked as 'ours'."""
        ledger, w = make()
        target = w.decoys[0]
        self.assertFalse(w.retire_decoy(target, "mallory-key"))
        ledger.spend(target, STOLEN)
        self.assertEqual(w.state, PROTECTED)

    def test_coin_selection_never_picks_a_decoy(self):
        _, w = make()
        self.assertEqual(w.select_coin(), w.real_id)
        self.assertNotIn(w.select_coin(), w.decoys)


class Views(unittest.TestCase):
    def test_observer_view_never_exposes_amounts_or_which_is_real(self):
        _, w = make()
        rows = w.observer_view()
        self.assertEqual(len(rows), 4)
        for row in rows:
            self.assertEqual(set(row), {"id", "spent"})

    def test_owner_view_shows_amounts_and_which_is_real(self):
        _, w = make()
        rows = w.owner_view()
        real = [r for r in rows if r["is_real"]]
        self.assertEqual(len(real), 1)
        self.assertEqual(real[0]["value"], 100)
        self.assertEqual(real[0]["id"], w.real_id)

    def test_decoys_hold_a_small_amount_above_the_fee(self):
        _, w = make()
        decoys = [r for r in w.owner_view() if not r["is_real"]]
        self.assertEqual(len(decoys), 3)
        for r in decoys:
            self.assertAlmostEqual(r["value"], 0.1)  # 0.1% of the default payment of 100

    def test_decoy_amount_has_a_floor(self):
        w = CanaryWallet(Ledger(), amount=0.5, rng=random.Random(1))
        self.assertAlmostEqual(w.decoy_value, MIN_DECOY)

    def test_outputs_do_not_reveal_which_is_real_by_name(self):
        _, w = make()
        self.assertFalse(any("real" in oid for oid in w.output_ids()))

    def test_replacement_decoys_are_not_newer_by_id(self):
        """After an unlock, new decoys must not be recognisable by id order."""
        wins = 0
        for seed in range(200):
            ledger = Ledger()
            w = CanaryWallet(ledger, n_decoys=3, k=1, rng=random.Random(seed))
            ledger.spend(w.decoys[0], STOLEN)
            w.unlock("alice-key", "bob-key")
            ids = sorted(w.output_ids())
            wins += ids.index(w.real_id) == 0   # real is the lowest id?
        self.assertLess(wins / 200, 0.4)        # ~25% by chance with 4 notes


class Planner(unittest.TestCase):
    def test_small_payment_uses_the_fee_floor(self):
        p = plan_protection(0.05, n_decoys=3, fee=0.0001)
        self.assertAlmostEqual(p["decoy_value"], 0.001)   # 10x the fee, not 0.1% of 0.05
        self.assertTrue(p["floor_applied"])
        self.assertAlmostEqual(p["locked_in_decoys"], 0.003)
        self.assertAlmostEqual(p["decoy_fees"], 0.0003)
        self.assertAlmostEqual(p["fees_paid"], 0.0004)
        self.assertAlmostEqual(p["total_needed"], 0.0533)  # the payment fee is inside the 0.05
        self.assertAlmostEqual(p["receiver_gets"], 0.0499)

    def test_receiver_gets_amount_minus_fee(self):
        self.assertAlmostEqual(plan_protection(1, fee=0.01)["receiver_gets"], 0.99)

    def test_large_payment_uses_the_fraction(self):
        p = plan_protection(100, n_decoys=3, fee=0.0001)
        self.assertAlmostEqual(p["decoy_value"], 0.1)     # 0.1% of 100
        self.assertFalse(p["floor_applied"])

    def test_owner_can_set_the_decoy_value(self):
        p = plan_protection(0.05, n_decoys=2, fee=0.0001, decoy_value=0.002)
        self.assertAlmostEqual(p["decoy_value"], 0.002)
        self.assertTrue(p["custom_decoy"])
        self.assertFalse(p["floor_applied"])
        self.assertAlmostEqual(p["locked_in_decoys"], 0.004)
        self.assertIn("0.002", p["steps"][0])

    def test_decoy_value_must_be_above_the_fee(self):
        for dv in (0.0001, 0.00005, 0):
            with self.assertRaises(ValueError):
                plan_protection(0.05, fee=0.0001, decoy_value=dv)

    def test_automatic_decoys_always_stay_above_the_fee(self):
        for amount in (0.05, 1, 100):
            for fee in (0.00001, 0.0001, 0.001):
                self.assertGreater(plan_protection(amount, fee=fee)["decoy_value"], fee)

    def test_balance_check(self):
        self.assertTrue(plan_protection(0.05, balance=0.125)["covered"])
        short = plan_protection(0.05, balance=0.05)
        self.assertFalse(short["covered"])
        self.assertAlmostEqual(short["shortfall"], 0.0033)
        self.assertNotIn("covered", plan_protection(0.05))

    def test_steps_list_every_decoy_then_the_real_payment(self):
        p = plan_protection(0.05, n_decoys=2)
        self.assertEqual(len(p["steps"]), 4)
        self.assertIn("0.001", p["steps"][0])
        self.assertIn("0.05", p["steps"][-1])
        self.assertIn("0.0499", p["steps"][-1])

    def test_bad_input_is_rejected(self):
        for kw in ({"amount": 0}, {"amount": -1}, {"amount": 1, "fee": 0},
                   {"amount": 0.0001, "fee": 0.0001}, {"amount": 0.00005, "fee": 0.0001},
                   {"amount": 1, "n_decoys": 0}, {"amount": 1, "n_decoys": 2.5}):
            with self.assertRaises(ValueError):
                plan_protection(**kw)


class Robustness(unittest.TestCase):
    """Strange input must be rejected cleanly, never produce nonsense."""

    def test_wallet_rejects_bad_numbers(self):
        inf, nan = float("inf"), float("nan")
        for kw in ({"amount": inf}, {"amount": nan}, {"amount": -5}, {"amount": 0},
                   {"fee": inf}, {"fee": nan}, {"fee": 0}, {"decoy_value": inf},
                   {"decoy_value": nan}, {"decoy_value": 0.0001}, {"n_decoys": 0},
                   {"n_decoys": MAX_DECOYS + 1}, {"n_decoys": 2.5}):
            with self.assertRaises(ValueError, msg=str(kw)):
                CanaryWallet(Ledger(), rng=random.Random(1), **kw)

    def test_planner_rejects_infinity_nan_and_huge_counts(self):
        inf, nan = float("inf"), float("nan")
        for kw in ({"amount": inf}, {"amount": nan}, {"amount": 1, "fee": inf},
                   {"amount": 1, "decoy_value": inf}, {"amount": 1, "balance": nan},
                   {"amount": 1, "balance": -1}, {"amount": 1, "n_decoys": MAX_DECOYS + 1},
                   {"amount": 1, "n_decoys": 10**6}):
            with self.assertRaises(ValueError, msg=str(kw)):
                plan_protection(**kw)

    def test_pay_with_strange_amounts_never_crashes_or_overspends(self):
        inf, nan = float("inf"), float("nan")
        for amt in (inf, -inf, nan, -1, 0, 0.0001, 100.0001, 1e30):
            ledger, w = make()
            self.assertFalse(w.pay("alice-key", "bob-key", amt), msg=str(amt))
            self.assertFalse(ledger.outputs[w.real_id]["spent"])
            self.assertEqual(w.receipts, [])

    def test_partial_payment_gives_change_and_exact_receipt(self):
        _, w = make()
        self.assertTrue(w.pay("alice-key", "bob-key", 40))
        r = w.receipts[0]
        self.assertAlmostEqual(r["amount"], 39.9999)
        self.assertAlmostEqual(r["fee"], 0.0001)
        self.assertAlmostEqual(r["change"], 60)
        self.assertAlmostEqual(r["amount"] + r["fee"] + r["change"], 100)  # nothing created or lost


class Attacks(unittest.TestCase):
    def test_realistic_sweep_takes_all_decoys_in_one_transaction_and_trips_alarm(self):
        ledger, w = make()
        results = sweep_attack(ledger, STOLEN, w.output_ids())
        self.assertFalse(results[w.real_id])             # the real note needs two keys
        self.assertTrue(all(v for oid, v in results.items() if oid != w.real_id))
        self.assertFalse(ledger.outputs[w.real_id]["spent"])
        self.assertEqual(len(w.touched), 3)
        self.assertEqual(w.state, PROTECTED)

    def test_naive_sweep_with_one_key_is_an_invalid_transaction(self):
        """One transaction holding every note fails as a whole: the real note needs two
        keys. Nothing moves, so there is no alarm either."""
        ledger, w = make()
        results = naive_sweep(ledger, STOLEN, w.output_ids())
        self.assertFalse(any(results.values()))
        self.assertTrue(all(not o["spent"] for o in ledger.outputs.values()))
        self.assertEqual(w.state, NORMAL)

    def test_a_transaction_is_all_or_nothing(self):
        ledger, w = make()
        self.assertFalse(ledger.spend_tx([w.decoys[0], w.real_id], STOLEN))
        self.assertFalse(ledger.outputs[w.decoys[0]]["spent"])

    def test_protected_state_is_client_side_only(self):
        """Honest limit: the ledger still lets a key-holder spend the decoys."""
        ledger, w = make()
        ledger.spend(w.decoys[0], STOLEN)
        self.assertEqual(w.state, PROTECTED)
        self.assertTrue(ledger.spend(w.decoys[1], STOLEN))


class Recovery(unittest.TestCase):
    def test_recovery_key_only_works_after_timelock(self):
        ledger, w = make(timeout_blocks=10)
        self.assertFalse(w.recover_with_key("recovery-key"))
        ledger.mine(9)
        self.assertFalse(w.recover_with_key("recovery-key"))
        ledger.mine(1)
        self.assertTrue(w.recover_with_key("recovery-key"))
        self.assertTrue(ledger.outputs[w.real_id]["spent"])

    def test_wrong_key_never_works(self):
        ledger, w = make(timeout_blocks=1)
        ledger.mine(5)
        self.assertFalse(w.recover_with_key("mallory-key"))

    def test_recovery_branch_works_even_while_protected(self):
        """By design: the timelock branch is a ledger rule, not the wallet's
        client-side state, so it is the way out when the receiver has vanished.
        Only the recovery key can use it; a thief with Alice's key alone cannot."""
        ledger, w = make(timeout_blocks=10)
        sweep_attack(ledger, STOLEN, w.output_ids())
        self.assertEqual(w.state, PROTECTED)
        ledger.mine(10)
        self.assertFalse(ledger.can_spend(w.real_id, set(STOLEN)))
        self.assertTrue(w.recover_with_key("recovery-key"))


class AttackMath(unittest.TestCase):
    """The doc's formula P = k / (n + 1), checked against the real code."""

    def check(self, n, k, tol):
        rng = random.Random(42)
        trials = 4000
        hits = sum(blind_attack_trial(n, k, rng) for _ in range(trials))
        self.assertAlmostEqual(hits / trials, k / (n + 1), delta=tol)

    def test_n3_k1(self):
        self.check(3, 1, 0.03)

    def test_n3_k2(self):
        self.check(3, 2, 0.03)

    def test_n10_k1(self):
        self.check(10, 1, 0.02)


class Invariants(unittest.TestCase):
    def test_random_sequences_keep_the_rules(self):
        """Throw thousands of mixed actions at the wallet and check the rules after each."""
        for seed in range(300):
            rng = random.Random(seed)
            n = rng.randint(1, 4)
            k = rng.randint(1, n)
            ledger = Ledger()
            w = CanaryWallet(ledger, n_decoys=n, k=k, timeout_blocks=rng.randint(1, 8), rng=rng)
            legit_exit = False  # real note left through the two-party rule or the recovery key
            for step in range(25):
                action = rng.randrange(11)
                if action == 0:
                    legit_exit |= w.pay("alice-key", "bob-key")
                elif action == 1:
                    w.pay("alice-key", "alice-key")
                elif action == 2:
                    sweep_attack(ledger, STOLEN, w.output_ids())
                elif action == 3:
                    naive_sweep(ledger, STOLEN, w.output_ids())
                elif action == 4:
                    ids = w.output_ids()
                    if ids:
                        ledger.spend(rng.choice(ids), STOLEN)
                elif action == 5:
                    w.unlock("alice-key", None)
                elif action == 6:
                    w.unlock("alice-key", "bob-key")
                elif action == 7:
                    ledger.mine(rng.randint(1, 6))
                elif action == 8:
                    w.recover_with_key("mallory-key")
                elif action == 9:
                    legit_exit |= w.recover_with_key("recovery-key")
                else:
                    live = w._active_decoys()
                    if live:
                        w.retire_decoy(rng.choice(live), rng.choice(["alice-key", "mallory-key"]))
                where = f"seed {seed}, step {step}, action {action}"
                if ledger.outputs[w.real_id]["spent"]:
                    self.assertTrue(legit_exit, f"real note spent without a legitimate exit ({where})")
                if w.state == PROTECTED:
                    self.assertGreaterEqual(len(w.touched), w.k, f"protected too early ({where})")
                else:
                    self.assertLess(len(w.touched), w.k, f"alarm count reached k but not protected ({where})")
                self.assertLessEqual(len(w._active_decoys()), w.n, f"too many decoys ({where})")


if __name__ == "__main__":
    unittest.main()
