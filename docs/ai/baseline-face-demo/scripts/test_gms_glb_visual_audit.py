import json
import tempfile
import unittest
from pathlib import Path

from glb_geometry_poc import ROOT, run
from gms_glb_visual_audit import payload, result_choice, synthetic_images


class GmsGlbVisualAuditTest(unittest.TestCase):
    def test_synthetic_images_are_hash_bound_to_verified_glb(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            path = Path(folder)
            run("base-female", path)
            images = synthetic_images(path)
            self.assertEqual(len(images), 2)
            body = payload(images, "gpt-6-astra")
            self.assertFalse(body["store"])
            self.assertEqual(len(body["input"][0]["content"]), 3)
            (path / "landmarks-front.png").write_bytes(b"not the synthetic render")
            with self.assertRaises(ValueError):
                synthetic_images(path)

    def test_model_cannot_add_free_text_or_edit_to_visual_audit(self):
        valid = {"innerEye": "PLAUSIBLE", "alarOuter": "UNCLEAR", "cheekbone": "MISPLACED",
                 "jawAngle": "PLAUSIBLE", "viewsConsistent": "YES"}
        self.assertEqual(result_choice({"status": "completed", "output_text": json.dumps(valid)}), valid)
        for wrong in ({**valid, "edit": "nose.alar_width"}, {**valid, "alarOuter": "CERTAIN"}):
            with self.assertRaises(ValueError):
                result_choice({"status": "completed", "output_text": json.dumps(wrong)})


if __name__ == "__main__":
    unittest.main()
