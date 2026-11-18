import unittest

from similar_cohort_synthetic import aggregate, person, report, scenarios


KEY = "synthetic-c1/m1/u1"


class SimilarCohortSyntheticTest(unittest.TestCase):
    def test_small_duplicate_consent_and_withdrawal_hide_entire_cell(self):
        results = report()
        for scenario in ("small_group", "duplicate_account", "consent_missing", "withdrawal"):
            self.assertEqual(results[scenario][KEY], {"status": "suppressed"})
        duplicate_events = scenarios()["duplicate_account"][0]
        self.assertEqual(len({event["account"] for event in duplicate_events}), 5)
        self.assertEqual(len({event["subject"] for event in duplicate_events}), 4)
        before_withdrawal, consented, _ = scenarios()["withdrawal"]
        self.assertEqual(aggregate(before_withdrawal, consented)[KEY]["subjects"], 5)

    def test_model_and_ui_versions_do_not_borrow_each_others_samples(self):
        for scenario in ("model_split", "ui_split"):
            self.assertEqual(len(report()[scenario]), 2)
            self.assertTrue(all(cell == {"status": "suppressed"}
                                for cell in report()[scenario].values()))

    def test_order_bias_and_undo_are_diagnostics_not_preference(self):
        cell = report()["order_and_undo"][KEY]
        self.assertEqual(cell["status"], "order-confounded")
        self.assertEqual(cell["first_slot_tried"], 8)
        self.assertEqual(cell["tried"], {"A": 6, "B": 2})
        self.assertEqual(cell["undone"], {"A": 1, "B": 0})

    def test_threshold_is_not_a_fixed_product_rule(self):
        rows = [event for i in range(5) for event in person(f"s{i}", f"a{i}")]
        subjects = {f"s{i}" for i in range(5)}
        self.assertEqual(aggregate(rows, subjects, min_subjects=6)[KEY],
                         {"status": "suppressed"})
        self.assertEqual(aggregate(rows, subjects, min_subjects=5)[KEY]["subjects"], 5)


if __name__ == "__main__":
    unittest.main()
