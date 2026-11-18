import csv
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from consult_release_gate import CASE_COLUMNS, RESULT_COLUMNS, gate, main, read_rows


class ConsultReleaseGateTest(unittest.TestCase):
    def setUp(self):
        self.cases = {
            "C1": dict(case_id="C1", category="mixed", expected_intent="EDIT",
                       expected_effects="nose.bridge_height:+:both|eye.inner:+:both"),
            "C2": dict(case_id="C2", category="unsupported", expected_intent="REPLY",
                       expected_effects=""),
            "C3": dict(case_id="C3", category="ambiguous", expected_intent="CLARIFY",
                       expected_effects=""),
        }
        self.baseline = {
            case_id: dict(case_id=case_id, intent=case["expected_intent"],
                          effects=case["expected_effects"],
                          claimed_applied="true" if case["expected_intent"] == "EDIT" else "false",
                          duration_ms="100", input_tokens="10", output_tokens="5",
                          observed_debit="1", gms_calls="1")
            for case_id, case in self.cases.items()
        }

    def test_정상_후보는_통과하고_비용과_지연을_계산한다(self):
        base, candidate, failures = gate(self.cases, self.baseline, self.baseline,
                                         max_calls=3, max_debit=3, max_tokens=45)
        self.assertEqual(failures, [])
        self.assertEqual(candidate[2]["gms_calls"], 3)
        self.assertEqual((candidate[3], candidate[4]), (100, 100))
        self.assertEqual(base[0]["mixed"], [1, 1])

    def test_스키마가_맞아도_잘못된_좌우와_거짓_적용은_거절한다(self):
        candidate = {key: row.copy() for key, row in self.baseline.items()}
        candidate["C1"]["effects"] = "nose.bridge_height:+:left|eye.inner:+:both"
        candidate["C2"]["claimed_applied"] = "true"
        _, _, failures = gate(self.cases, self.baseline, candidate, 3, 3, 45)
        self.assertIn("중대 오편집: C1, C2", failures)

    def test_유형별_성공률_하락과_호출_비용_초과를_거절한다(self):
        candidate = {key: row.copy() for key, row in self.baseline.items()}
        candidate["C3"]["intent"] = "REPLY"
        _, _, failures = gate(self.cases, self.baseline, candidate, 2, 2, 45)
        self.assertIn("ambiguous 유형 성공률 하락", failures)
        self.assertIn("GMS 호출 상한 초과", failures)
        self.assertIn("관측 크레딧 차감 상한 초과", failures)

    def test_입력과_출력_토큰_합계가_상한을_넘으면_거절한다(self):
        _, _, failures = gate(self.cases, self.baseline, self.baseline, 3, 3, 44)
        self.assertIn("입력·출력 토큰 합계 상한 초과", failures)

    def test_사례_누락과_개인_원문_열을_허용하지_않는다(self):
        with self.assertRaisesRegex(ValueError, "case_id가 다름"):
            gate(self.cases, self.baseline, {"C1": self.baseline["C1"]}, 3, 3, 45)
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as directory:
            path = Path(directory) / "results.csv"
            with path.open("w", encoding="utf-8", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=[*RESULT_COLUMNS, "utterance"])
                writer.writeheader()
                writer.writerow({**self.baseline["C1"], "utterance": "개인 문장"})
            with self.assertRaisesRegex(ValueError, "필요한 열"):
                read_rows(path, RESULT_COLUMNS)

    def test_새_합성_보류셋의_부호와_지원_경계가_고정된다(self):
        path = Path(__file__).resolve().parents[2] / "docs/ai/consult-synthetic-holdout-v2-cases.csv"
        cases = read_rows(path, CASE_COLUMNS)
        self.assertEqual(len(cases), 16)
        self.assertEqual(cases["S05"]["expected_effects"], "nose.tip_height:-:both")
        self.assertEqual(cases["S06"]["expected_effects"],
                         "nose.tip_height:+:both|nose.alar_width:-:both")
        self.assertEqual(cases["S10"]["expected_intent"], "REPLY")

    def test_잘못된_후보는_명령을_실패시키고_기준선_파일은_유지한다(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as directory:
            paths = [Path(directory) / name for name in ("cases.csv", "baseline.csv", "candidate.csv")]
            candidate = {key: row.copy() for key, row in self.baseline.items()}
            candidate["C1"]["effects"] = "nose.bridge_height:+:left|eye.inner:+:both"
            for path, columns, rows in zip(
                paths, (CASE_COLUMNS, RESULT_COLUMNS, RESULT_COLUMNS),
                (self.cases, self.baseline, candidate),
            ):
                with path.open("w", encoding="utf-8", newline="") as file:
                    writer = csv.DictWriter(file, fieldnames=columns)
                    writer.writeheader()
                    writer.writerows(rows.values())
            before = paths[1].read_bytes()
            output = io.StringIO()
            with patch("sys.argv", ["gate", *(str(path) for path in paths),
                                    "--max-gms-calls", "3", "--max-observed-debit", "3",
                                    "--max-total-tokens", "45"]):
                with redirect_stdout(output):
                    self.assertTrue(main())
            self.assertIn("FAIL: 중대 오편집: C1", output.getvalue())
            self.assertEqual(paths[1].read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
