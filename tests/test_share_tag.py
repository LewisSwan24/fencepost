"""The share tag firmware (#54) holds a short code and never reaches the internet.

    python tests/test_share_tag.py

There is no way to run the firmware here, so this reads its source for the promises the
issue makes about it: no account token, no network client, no joining a Wi-Fi network, and
a square that points at the front end the deployment check knows about.
"""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "hardware" / "share-tag" / "share-tag.ino").read_text(encoding="utf-8")
# What the compiler sees, comments aside. A comment starts a line or follows whitespace; the
# // inside "https://..." does neither.
CODE = re.sub(r"(^|\s)//[^\n]*", r"\1", SOURCE, flags=re.M)


class NeverGoesOnline(unittest.TestCase):
    def test_no_network_client_of_any_kind(self):
        for forbidden in ["HTTPClient", "WiFiClient", "esp_http_client", "WiFiUdp",
                          "AsyncClient", "WiFi.begin(", "WIFI_STA", "/api/", "Bearer"]:
            self.assertNotIn(forbidden, CODE, f"{forbidden} would be a way to the internet")

    def test_wifi_is_only_its_own_access_point_and_is_off_otherwise(self):
        self.assertIn("WiFi.softAP(", CODE)
        self.assertIn("WiFi.mode(WIFI_AP)", CODE)
        self.assertGreaterEqual(CODE.count("WiFi.mode(WIFI_OFF)"), 2,
                                "radio left on outside setup")

    def test_the_setup_access_point_has_a_password(self):
        self.assertRegex(CODE, r"WiFi\.softAP\(\s*apName\.c_str\(\),\s*apPassword\.c_str\(\)\s*\)")

    def test_no_sensor_that_listens_or_watches(self):
        for unused in ["M5.Mic", "M5.Imu", "IrSender", "M5.Speaker.record"]:
            self.assertNotIn(unused, CODE)


class PointsAtTheFrontEnd(unittest.TestCase):
    def test_the_square_carries_the_short_code_route(self):
        self.assertIn('String(BASE_URL) + "/c/" + code', CODE)

    def test_base_url_is_the_deployed_front_end(self):
        tag = re.search(r'BASE_URL = "([^"]+)"', CODE).group(1)
        deploy = (ROOT / "scripts" / "check_deploy.py").read_text(encoding="utf-8")
        web = re.search(r'^WEB = "([^"]+)"', deploy, re.M).group(1)
        self.assertEqual(web, tag, "the tag's square would point somewhere the site is not")


if __name__ == "__main__":
    unittest.main()
