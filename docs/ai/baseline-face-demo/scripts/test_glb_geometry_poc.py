import tempfile
import unittest
from pathlib import Path

from glb_geometry_poc import ROOT, load_sample, run, widths


class GlbGeometryPocTest(unittest.TestCase):
    def test_only_registered_synthetic_models_are_accepted(self):
        with self.assertRaises(ValueError):
            load_sample("unregistered-user-model")
        for name in ("base-female", "base-male"):
            vertices, triangles, target, mapped, digest = load_sample(name)
            self.assertEqual(len(vertices), len(target))
            self.assertGreater(len(triangles), 20_000)
            self.assertEqual(len(digest), 64)
            self.assertEqual(len(widths(vertices, mapped)), 4)

    def test_glb_morph_changes_provisional_nose_pair_but_never_recommends(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as folder:
            result = run("base-female", Path(folder))
            self.assertLess(result["pointPairs"]["alar_candidate"]["after"],
                            result["pointPairs"]["alar_candidate"]["before"])
            self.assertEqual(result["recommendation"], "deferred")
            self.assertTrue(all(row["anatomicalMapping"] == "unverified"
                                for row in result["pointPairs"].values()))
            self.assertTrue((Path(folder) / "before-front.png").exists())
            self.assertTrue((Path(folder) / "after-oblique_r.png").exists())


if __name__ == "__main__":
    unittest.main()
