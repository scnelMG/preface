import copy
import unittest
from unittest.mock import patch

from comparison_policy import REQUIRED_GATES, first_comparison as evaluate_comparison
from grounded_gms import CARDS, FINDING_CARD, payload


def first_comparison(measurements, choice, model):
    return evaluate_comparison(measurements, choice, model, measurement_bounds={
        "alarWidth": (0.31, 0.33), "intercanthalDistance": (0.25, 0.27),
    })


class ComparisonPolicyTest(unittest.TestCase):
    def setUp(self):
        self.measurements = {"alarWidth": 0.32, "intercanthalDistance": 0.26}
        self.choice = {"evidenceId": "ALAR_FIRST_COMPARISON", "visualAgreement": "AGREES"}
        self.model = {"source": "procedural_synthetic_3d_only", **dict.fromkeys(REQUIRED_GATES, True)}

    def test_preloaded_cards_keep_observation_and_direction_separate(self):
        self.assertEqual(CARDS["NOSE_LANDMARKS"]["use"], "measurement_definition")
        self.assertEqual(CARDS["ALAR_FIRST_COMPARISON"]["use"], "synthetic_comparison_hypothesis")
        self.assertEqual(CARDS["ALAR_FIRST_COMPARISON"]["sourceType"], "expert_narrative")
        self.assertEqual(CARDS["ALAR_FIRST_COMPARISON"]["measurements"], list(self.measurements))
        self.assertNotIn("magnitude", CARDS["ALAR_FIRST_COMPARISON"])
        sent = payload({"jawToCheekPct": 78, "alarToNosePct": 43, "tipProjectionPct": 35}, "gpt-6-luna")
        facts = sent["input"][0]["content"][0]["text"]
        self.assertNotIn("ALAR_FIRST_COMPARISON", facts)
        self.assertEqual(set(FINDING_CARD.values()), set(sent["text"]["format"]["schema"]["properties"]["evidenceId"]["enum"]))

    def test_only_synthetic_quality_pass_gets_an_unapplied_hypothesis(self):
        result = first_comparison(self.measurements, self.choice, self.model)
        self.assertEqual(result["status"], "preview_hypothesis")
        self.assertEqual(result["control"], "nose.alar_width")
        self.assertEqual(result["direction"], "narrow")
        self.assertIsNone(result["magnitude"])
        self.assertFalse(result["applied"])

    def test_real_model_is_deferred_even_with_synthetic_flags(self):
        self.assertEqual(first_comparison(self.measurements, self.choice, {**self.model, "source": "user_glb"})["status"], "deferred")

    def test_every_quality_gate_is_required(self):
        for gate in REQUIRED_GATES:
            with self.subTest(gate=gate):
                self.assertEqual(first_comparison(self.measurements, self.choice, {**self.model, gate: False})["status"], "deferred")

    def test_weak_or_unrelated_evidence_does_not_produce_direction(self):
        for choice in ({"evidenceId": "NOSE_LANDMARKS", "visualAgreement": "AGREES"},
                       {"evidenceId": "ALAR_FIRST_COMPARISON", "visualAgreement": "UNCLEAR"},
                       {**self.choice, "instruction": "무조건 줄여"}):
            with self.subTest(choice=choice):
                self.assertEqual(first_comparison(self.measurements, choice, self.model)["status"], "deferred")

    def test_missing_boundary_and_invalid_measurements_are_deferred(self):
        for values in ({"alarWidth": 0.26, "intercanthalDistance": 0.26},
                       {"alarWidth": 0.25, "intercanthalDistance": 0.26},
                       {"alarWidth": float("nan"), "intercanthalDistance": 0.26},
                       {"alarWidth": True, "intercanthalDistance": 0.26},
                       {"alarWidth": 0.32}):
            with self.subTest(values=values):
                self.assertEqual(first_comparison(values, self.choice, self.model)["status"], "deferred")

    def test_overlap_touching_missing_and_invalid_bounds_are_deferred(self):
        for bounds in (None, {}, {"alarWidth": (0.26, 0.33), "intercanthalDistance": (0.25, 0.27)},
                       {"alarWidth": (0.27, 0.33), "intercanthalDistance": (0.25, 0.27)},
                       {"alarWidth": (0.31, 0.33), "intercanthalDistance": (True, 0.27)},
                       {"alarWidth": (0.33, 0.34), "intercanthalDistance": (0.25, 0.27)},
                       {"alarWidth": (0.31, float("inf")), "intercanthalDistance": (0.25, 0.27)}):
            with self.subTest(bounds=bounds):
                result = evaluate_comparison(self.measurements, self.choice, self.model, measurement_bounds=bounds)
                self.assertEqual(result["status"], "deferred")

    def test_catalog_cannot_silently_change_control_or_evidence_level(self):
        for field, value in (("control", "eye.lid_height"), ("sourceType", "random_blog"),
                             ("direction", "widen"), ("url", "https://example.com")):
            changed = copy.deepcopy(CARDS)
            changed["ALAR_FIRST_COMPARISON"][field] = value
            with self.subTest(field=field), patch("comparison_policy.CARDS", changed):
                self.assertEqual(first_comparison(self.measurements, self.choice, self.model)["status"], "deferred")
        with patch("comparison_policy.CARDS", {}):
            self.assertEqual(first_comparison(self.measurements, self.choice, self.model)["status"], "deferred")


if __name__ == "__main__":
    unittest.main()
