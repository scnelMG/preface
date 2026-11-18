import unittest

from consult_terms import keyword_card, normalized


class ConsultTermsTest(unittest.TestCase):
    def setUp(self):
        self.cards = [
            {"id": "N01", "aliases": ["콧대"]},
            {"id": "N04", "aliases": ["코끝"]},
        ]

    def test_한_카드만_맞으면_찾는다(self):
        self.assertEqual(keyword_card("콧대 높이", self.cards), "N01")
        self.assertEqual(normalized("코 끝?"), normalized("코끝"))

    def test_둘_이상_걸리거나_없으면_보류한다(self):
        self.assertEqual(keyword_card("콧대와 코끝의 차이", self.cards), "NONE")
        self.assertEqual(keyword_card("날씨 알려줘", self.cards), "NONE")


if __name__ == "__main__":
    unittest.main()
