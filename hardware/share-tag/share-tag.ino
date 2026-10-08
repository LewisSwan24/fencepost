// Fencepost share tag (#54), for an M5StickC PLUS.
//
// A small thing the owner carries to hand a share code over in person. It holds one short
// code, three words, and shows it with the square beside it when the front button is pressed.
// The rest of the time the screen is off, so nothing is on public display.
//
// What it deliberately does not do:
//   - It never talks to Fencepost and holds no account token. It holds a short code, which
//     the owner made on the Share screen, and nothing else. A lost tag is dealt with by
//     turning that code off on the Share screen, with the controls that already exist.
//   - It never joins a Wi-Fi network. For setup it opens its own access point, with a fresh
//     password shown on its screen, and serves one page where the owner types the code.
//   - The microphone, the IMU and the IR LED are not used. Listening or sensing at the
//     street is the surveillance line the project turned down.
//
// Buttons: front (A) shows the code for 30 seconds, and a second press puts it away; held
// for two seconds it opens setup. Side (B) shows when the code expires, if the owner typed
// that in at setup, and during setup it cancels without changing the saved code.
//
// The tag cannot ask the server whether a code exists, but it carries the server's word
// list (words.h) and refuses words no Share screen hands out, at setup and on screen.
//
// Build and flash: see README.md beside this file.

#include <M5Unified.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

#include "words.h"

// Where a short code lands. The square carries BASE_URL + "/c/" + code.
static const char* BASE_URL = "https://fencepost-app.vercel.app";

static const uint32_t SHOW_MS = 30000;          // code on screen after a press
static const uint32_t EXPIRY_MS = 5000;         // expiry on screen after a side press
static const uint32_t SETUP_MS = 5 * 60000;     // setup closes itself if nothing is saved

Preferences prefs;
WebServer server(80);

String code;          // "word-word-word", or empty when nothing is set
String expires;       // free text the owner typed, or empty
bool inSetup = false;
uint32_t screenUntil = 0;
uint32_t setupUntil = 0;
String apName, apPassword;

// ---------- the code ----------

// Lowercase, any run of non-letters becomes one hyphen, and exactly three words of letters.
// The server does the real checking against its word list; this only keeps out what can
// never be a code, so the tag does not show a square that is certain to fail.
String normalise(const String& typed) {
  String out;
  bool gap = false;
  for (size_t i = 0; i < typed.length(); i++) {
    char c = tolower(typed[i]);
    if (c >= 'a' && c <= 'z') {
      if (gap && out.length()) out += '-';
      out += c;
      gap = false;
    } else {
      gap = true;
    }
  }
  int words = out.length() ? 1 : 0;
  for (size_t i = 0; i < out.length(); i++) if (out[i] == '-') words++;
  if (words != 3 || out.length() > 40) return "";
  return out;
}

// The server's word list, generated into words.h. The tag cannot ask the server whether a
// code was ever issued, but it can refuse words no Share screen hands out: an owner's own
// three words, or a typo, which otherwise sat on the tag as a square that could only fail.
bool listed(const String& word) {
  int lo = 0, hi = WORDS_COUNT - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    int cmp = strcmp(word.c_str(), WORDS[mid]);
    if (cmp == 0) return true;
    if (cmp < 0) hi = mid - 1; else lo = mid + 1;
  }
  return false;
}

// The first of the three words that is not on the list, or empty when all three are.
String unlisted(const String& normalised) {
  int start = 0;
  while (true) {
    int dash = normalised.indexOf('-', start);
    String word = normalised.substring(start, dash < 0 ? normalised.length() : dash);
    if (!listed(word)) return word;
    if (dash < 0) return "";
    start = dash + 1;
  }
}

void load() {
  prefs.begin("sharetag", true);
  code = prefs.getString("code", "");
  expires = prefs.getString("expires", "");
  prefs.end();
}

void save(const String& newCode, const String& newExpires) {
  prefs.begin("sharetag", false);
  prefs.putString("code", newCode);
  prefs.putString("expires", newExpires);
  prefs.end();
  code = newCode;
  expires = newExpires;
}

// ---------- the screen ----------

void screenOff() {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setBrightness(0);
  M5.Display.sleep();
  screenUntil = 0;
}

void screenOn(uint32_t forMs) {
  M5.Display.wakeup();
  M5.Display.setBrightness(160);
  M5.Display.fillScreen(TFT_BLACK);
  screenUntil = millis() + forMs;
}

void centred(const String& text, int y, const lgfx::IFont* font, uint16_t colour) {
  M5.Display.setFont(font);
  M5.Display.setTextColor(colour, TFT_BLACK);
  M5.Display.setTextDatum(top_center);
  M5.Display.drawString(text, M5.Display.width() / 2, y);
}

void showCode() {
  screenOn(SHOW_MS);
  if (!code.length()) {
    centred("No code yet", 80, &fonts::FreeSansBold9pt7b, TFT_WHITE);
    centred("Hold the front", 120, &fonts::Font2, TFT_LIGHTGREY);
    centred("button to set one", 138, &fonts::Font2, TFT_LIGHTGREY);
    return;
  }
  // A code saved before the tag checked the word list, or by an older firmware, can hold
  // words no Share screen hands out. Showing its square would only send a neighbour to
  // "link not valid", so say what is wrong and how to fix it instead.
  if (unlisted(code).length()) {
    centred("Not a", 60, &fonts::FreeSansBold9pt7b, TFT_WHITE);
    centred("Fencepost code", 84, &fonts::FreeSansBold9pt7b, TFT_WHITE);
    centred("Make one on the", 124, &fonts::Font2, TFT_LIGHTGREY);
    centred("Share screen, then", 142, &fonts::Font2, TFT_LIGHTGREY);
    centred("hold the front", 160, &fonts::Font2, TFT_LIGHTGREY);
    centred("button to set it", 178, &fonts::Font2, TFT_LIGHTGREY);
    return;
  }
  // The square on a light ground with its quiet margin, so a camera can find its edges.
  const int side = M5.Display.width() - 8;
  M5.Display.fillRect(4, 4, side, side, TFT_WHITE);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  String url = String(BASE_URL) + "/c/" + code;
  M5.Display.qrcode(url.c_str(), 4, 4, side, 1, true);

  // The code itself, one word to a line, large enough to read aloud from.
  int y = side + 10;
  int start = 0;
  while (start <= (int)code.length()) {
    int dash = code.indexOf('-', start);
    String word = code.substring(start, dash < 0 ? code.length() : dash);
    centred(word, y, &fonts::FreeSansBold12pt7b, TFT_WHITE);
    y += 26;
    if (dash < 0) break;
    start = dash + 1;
  }
  // Nothing on the screen said how to change the code, so the only way to find out was to
  // already know. A press turns the screen off early; a hold opens setup.
  centred("hold to change", 222, &fonts::Font2, TFT_LIGHTGREY);
}

void showExpiry() {
  screenOn(EXPIRY_MS);
  centred("Expires", 70, &fonts::FreeSansBold9pt7b, TFT_LIGHTGREY);
  if (expires.length()) {
    centred(expires.substring(0, 10), 100, &fonts::FreeSansBold9pt7b, TFT_WHITE);
    centred(expires.length() > 11 ? expires.substring(11, 16) : "", 126,
            &fonts::FreeSansBold9pt7b, TFT_WHITE);
  } else {
    centred("Not given.", 100, &fonts::Font2, TFT_WHITE);
    centred("The Share screen", 124, &fonts::Font2, TFT_LIGHTGREY);
    centred("says when.", 142, &fonts::Font2, TFT_LIGHTGREY);
  }
}

void showSetup() {
  screenOn(SETUP_MS);
  centred("Setup", 12, &fonts::FreeSansBold12pt7b, TFT_WHITE);
  centred("On your phone, join", 56, &fonts::Font2, TFT_LIGHTGREY);
  centred(apName, 76, &fonts::Font2, TFT_WHITE);
  centred("password", 104, &fonts::Font2, TFT_LIGHTGREY);
  centred(apPassword, 124, &fonts::FreeSansBold9pt7b, TFT_WHITE);
  centred("then open", 160, &fonts::Font2, TFT_LIGHTGREY);
  centred(WiFi.softAPIP().toString(), 180, &fonts::FreeSansBold9pt7b, TFT_WHITE);
  centred("side key: cancel", 216, &fonts::Font2, TFT_LIGHTGREY);
}

// ---------- setup over the tag's own access point ----------

String escapeHtml(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '&') out += "&amp;";
    else if (c == '"') out += "&quot;";
    else out += c;
  }
  return out;
}

const char PAGE_HEAD[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fencepost share tag</title>
<style>
body{font-family:system-ui,sans-serif;background:#1a1712;color:#f4ebdc;margin:0;padding:24px 20px}
h1{font-size:22px;margin:0 0 8px}p{color:#b9ad98;line-height:1.5;font-size:15px}
label{display:block;margin:18px 0 6px;font-weight:600}
input{width:100%;box-sizing:border-box;height:46px;padding:0 14px;border-radius:23px;border:1px solid #4a4236;background:#110f0c;color:#f4ebdc;font-size:16px}
button{width:100%;height:48px;margin-top:20px;border-radius:24px;border:0;background:#d9804c;color:#1a1712;font-size:16px;font-weight:700}
button.quiet{background:none;border:1px solid #4a4236;color:#f4ebdc}
.note{font-size:13px}
</style></head><body>)HTML";

void handleRoot() {
  String page = FPSTR(PAGE_HEAD);
  page += "<h1>Share tag</h1>";
  page += "<p>First make a code on Fencepost: open the storyboard's <b>Share</b> screen, turn "
          "on <b>Also give a short code</b> and press <b>Make a code</b>. Then type the three "
          "words it shows here. Words you choose yourself won't open anything.</p>"
          "<p>The tag shows the code, with the square, when you press its front button. It "
          "never goes online and keeps nothing but this code.</p>";
  page += "<form method=\"post\" action=\"/save\">";
  page += "<label for=\"code\">Short code</label>";
  page += "<input id=\"code\" name=\"code\" autocomplete=\"off\" autocapitalize=\"none\" "
          "spellcheck=\"false\" placeholder=\"the three words from Share\" value=\"" +
          escapeHtml(code) + "\">";
  page += "<label for=\"expires\">When it expires (optional)</label>";
  page += "<input id=\"expires\" name=\"expires\" type=\"datetime-local\" value=\"" +
          escapeHtml(expires) + "\">";
  page += "<p class=\"note\">Only shown on the tag's side button, as a reminder. The code stops "
          "working when the server says so, whatever is typed here.</p>";
  page += "<button type=\"submit\">Save to the tag</button></form>";
  page += "<form method=\"post\" action=\"/forget\"><button class=\"quiet\" type=\"submit\">"
          "Forget the code</button></form>";
  page += "</body></html>";
  server.send(200, "text/html; charset=utf-8", page);
}

void finishSetup();

void handleSave() {
  String newCode = normalise(server.arg("code"));
  if (!newCode.length()) {
    String page = FPSTR(PAGE_HEAD);
    page += "<h1>That isn't three words</h1><p>A short code is the three words the "
            "Share screen shows. Nothing was changed.</p><p><a href=\"/\" "
            "style=\"color:#d9804c\">Try again</a></p></body></html>";
    server.send(400, "text/html; charset=utf-8", page);
    return;
  }
  String stray = unlisted(newCode);
  if (stray.length()) {
    String page = FPSTR(PAGE_HEAD);
    page += "<h1>That code didn't come from Fencepost</h1><p><b>" + escapeHtml(stray) +
            "</b> isn't one of the words a Share screen hands out, so nobody could open it. "
            "Words you choose yourself won't work either: the code has to be made by "
            "Fencepost.</p><p>On the storyboard, open <b>Share</b>, turn on <b>Also give a "
            "short code</b>, press <b>Make a code</b>, and type the three words it shows. "
            "Nothing was changed.</p><p><a href=\"/\" style=\"color:#d9804c\">Try again</a>"
            "</p></body></html>";
    server.send(400, "text/html; charset=utf-8", page);
    return;
  }
  String newExpires = server.arg("expires").substring(0, 16);
  save(newCode, newExpires);
  String page = FPSTR(PAGE_HEAD);
  page += "<h1>Saved</h1><p>The tag now holds <b>" + escapeHtml(newCode) +
          "</b>. Its access point has closed; you can leave this page.</p></body></html>";
  server.send(200, "text/html; charset=utf-8", page);
  delay(300);
  finishSetup();
}

void handleForget() {
  save("", "");
  String page = FPSTR(PAGE_HEAD);
  page += "<h1>Forgotten</h1><p>The tag holds no code now. Its access point has closed.</p>"
          "</body></html>";
  server.send(200, "text/html; charset=utf-8", page);
  delay(300);
  finishSetup();
}

void startSetup() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char name[32];
  snprintf(name, sizeof name, "Fencepost-tag-%02X%02X", mac[4], mac[5]);
  apName = name;

  // The radio goes on first: with it off, esp_random() is only pseudo-random.
  WiFi.mode(WIFI_AP);

  // A fresh password every time setup opens, shown only on the tag's own screen, so the
  // page that changes the code is reachable only by whoever is holding the tag. Ten
  // characters from 31 (about 2^49), because anyone in range who catches the phone joining
  // can try passwords offline; eight digits would fall in minutes. No 0/o, 1/l/i.
  static const char ALPHABET[] = "abcdefghjkmnpqrstuvwxyz23456789";
  char pass[11];
  for (int i = 0; i < 10; i++) pass[i] = ALPHABET[esp_random() % (sizeof ALPHABET - 1)];
  pass[10] = 0;
  apPassword = pass;

  WiFi.softAP(apName.c_str(), apPassword.c_str());
  server.begin();
  inSetup = true;
  setupUntil = millis() + SETUP_MS;
  showSetup();
}

void finishSetup() {
  server.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  inSetup = false;
  showCode();
}

// ---------- main ----------

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(0);                 // portrait, 135 x 240
  M5.BtnA.setHoldThresh(2000);
  // Most of its life is waiting for a button, so the CPU runs at the lowest clock the
  // access point still works at; the battery is 120 mAh.
  setCpuFrequencyMhz(80);
  WiFi.mode(WIFI_OFF);
  // Registered once: WebServer keeps every handler it is given, so doing this on each
  // setup would add another set every time.
  server.on("/", HTTP_GET, handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/forget", HTTP_POST, handleForget);
  server.onNotFound(handleRoot);
  load();
  showCode();                                // a moment on power-up, then dark
}

void loop() {
  M5.update();

  if (inSetup) {
    server.handleClient();
    // The side button backs out of setup and leaves the saved code as it was. Before, the
    // only ways out were saving, forgetting, or waiting five minutes for the timeout.
    if (M5.BtnB.wasClicked() || (int32_t)(millis() - setupUntil) > 0) finishSetup();
    delay(2);
    return;
  }

  if (M5.BtnA.wasHold()) {
    startSetup();
  } else if (M5.BtnA.wasClicked()) {
    // A press while something is on screen puts it away, rather than waiting it out.
    if (screenUntil) screenOff(); else showCode();
  } else if (M5.BtnB.wasClicked()) {
    showExpiry();
  }

  if (screenUntil && (int32_t)(millis() - screenUntil) > 0) screenOff();
  delay(10);
}
