// Display remote, for an M5StickS3.
//
// The park display at the booth is driven by three keys: Back (left arrow), Choose (Enter)
// and Next (right arrow), read in web/public/wildlife/shared/controls.js. This turns the
// stick into a keyboard that sends only those three, over Bluetooth and over USB at the same
// time: paired once it works without a cable, and if Bluetooth misbehaves on the day, the
// USB cable to the display's computer takes over with nothing to change.
//
// The StickS3 has two buttons, so:
//   front (A) press        Choose   Enter
//   side  (B) press        Next     right arrow
//   side  (B) held 0.6 s   Back     left arrow
//
// What it deliberately does not do: no Wi-Fi, no Fencepost account, and the microphone and
// IMU are not used, the same line the share tag kept. It replaces the share tag on this
// stick; that firmware is still in hardware/share-tag and can go back on.
//
// Build and flash: see README.md beside this file. It needs USB Mode "USB-OTG (TinyUSB)",
// not the hardware CDC the share tag used, or the USB keyboard never appears.

#include <M5Unified.h>
#include <BLEDevice.h>
#include <BLEHIDDevice.h>
#include <BLESecurity.h>
#include <BLEServer.h>
#include "USB.h"
#include "USBHIDKeyboard.h"

static const char* NAME = "Fencepost remote";
static const uint32_t HOLD_MS = 600;
static const uint32_t DIM_AFTER_MS = 60000;   // dim when nobody has pressed for a minute
static const uint32_t FLASH_MS = 250;         // how long a pressed row stays lit

// HID usage IDs (keyboard page) for Bluetooth; the USB library takes its own key constants.
static const uint8_t HID_ENTER = 0x28, HID_RIGHT = 0x4F, HID_LEFT = 0x50;

// A plain boot-protocol keyboard, report ID 1: modifiers, reserved, six keys, LEDs out.
static const uint8_t REPORT_MAP[] = {
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01,
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x08, 0x81, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01,
  0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00,
  0xC0,
};

USBHIDKeyboard usbKeyboard;
BLEHIDDevice* hid;
BLECharacteristic* bleInput;
bool bleConnected = false;
bool redraw = true;

int lit = -1;                 // row lit after a press: 0 Back, 1 Choose, 2 Next
uint32_t litUntil = 0;
uint32_t lastPress = 0;
bool dimmed = false;

class Connection : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    bleConnected = true;
    redraw = true;
  }
  void onDisconnect(BLEServer*) override {
    bleConnected = false;
    redraw = true;
    BLEDevice::startAdvertising();   // so the display's computer can reconnect by itself
  }
};

// Just Works pairing: the stick has no way to show or type a PIN that anyone would read.
class Pairing : public BLESecurityCallbacks {
  bool onSecurityRequest() override { return true; }
  uint32_t onPassKeyRequest() override { return 0; }
  void onPassKeyNotify(uint32_t) override {}
  bool onConfirmPIN(uint32_t) override { return true; }
#if defined(CONFIG_BLUEDROID_ENABLED)
  void onAuthenticationComplete(esp_ble_auth_cmpl_t) override { redraw = true; }
#elif defined(CONFIG_NIMBLE_ENABLED)
  void onAuthenticationComplete(ble_gap_conn_desc*) override { redraw = true; }
#endif
};

void bleKey(uint8_t usage) {
  if (!bleConnected) return;
  uint8_t report[8] = {0, 0, usage, 0, 0, 0, 0, 0};
  bleInput->setValue(report, sizeof(report));
  bleInput->notify();
  delay(8);
  memset(report, 0, sizeof(report));
  bleInput->setValue(report, sizeof(report));
  bleInput->notify();
}

void send(int row) {
  static const uint8_t usage[] = {HID_LEFT, HID_ENTER, HID_RIGHT};
  static const uint8_t usbKey[] = {KEY_LEFT_ARROW, KEY_RETURN, KEY_RIGHT_ARROW};
  bleKey(usage[row]);
  usbKeyboard.write(usbKey[row]);   // goes nowhere when no computer is on the cable
  lit = row;
  litUntil = millis() + FLASH_MS;
  lastPress = millis();
  redraw = true;
}

void row(int index, const char* label, const char* how, int y) {
  const bool on = index == lit;
  M5.Display.fillRoundRect(4, y, M5.Display.width() - 8, 52, 8, on ? TFT_WHITE : 0x2124);
  M5.Display.setTextDatum(top_center);
  M5.Display.setTextColor(on ? TFT_BLACK : TFT_WHITE, on ? TFT_WHITE : 0x2124);
  M5.Display.setFont(&fonts::FreeSansBold12pt7b);
  M5.Display.drawString(label, M5.Display.width() / 2, y + 6);
  M5.Display.setFont(&fonts::Font2);
  M5.Display.setTextColor(on ? TFT_BLACK : TFT_LIGHTGREY, on ? TFT_WHITE : 0x2124);
  M5.Display.drawString(how, M5.Display.width() / 2, y + 32);
}

void draw() {
  M5.Display.startWrite();
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextDatum(top_center);
  M5.Display.setFont(&fonts::Font2);
  M5.Display.setTextColor(bleConnected ? TFT_GREEN : TFT_ORANGE, TFT_BLACK);
  M5.Display.drawString(bleConnected ? "Bluetooth on" : "Pair: Fencepost", M5.Display.width() / 2, 4);
  M5.Display.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  M5.Display.drawString(String(M5.Power.getBatteryLevel()) + "%  USB keys on", M5.Display.width() / 2, 22);
  row(1, "Choose", "front button", 48);
  row(2, "Next", "side button", 108);
  row(0, "Back", "hold side button", 168);
  M5.Display.endWrite();
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(0);                 // portrait, 135 x 240
  M5.Display.setBrightness(120);
  M5.BtnB.setHoldThresh(HOLD_MS);

  usbKeyboard.begin();
  USB.productName(NAME);
  USB.begin();

  BLEDevice::init(NAME);
  BLESecurity* security = new BLESecurity();
  security->setCapability(ESP_IO_CAP_NONE);
  security->setAuthenticationMode(true, false, true);   // bond, no MITM, secure connections
  BLEDevice::setSecurityCallbacks(new Pairing());

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new Connection());
  hid = new BLEHIDDevice(server);
  hid->manufacturer()->setValue("Fencepost");
  hid->pnp(0x02, 0x303A, 0x4001, 0x0100);
  hid->hidInfo(0x00, 0x01);
  hid->reportMap((uint8_t*)REPORT_MAP, sizeof(REPORT_MAP));
  bleInput = hid->inputReport(1);
  hid->outputReport(1);                      // caps-lock and friends; ignored, but expected
  hid->setBatteryLevel(M5.Power.getBatteryLevel());
  hid->startServices();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->setAppearance(0x03C1);        // HID keyboard
  advertising->addServiceUUID(hid->hidService()->getUUID());
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  lastPress = millis();
  draw();
}

void loop() {
  M5.update();

  if (M5.BtnA.wasClicked()) send(1);
  else if (M5.BtnB.wasHold()) send(0);
  else if (M5.BtnB.wasClicked()) send(2);

  if (lit >= 0 && (int32_t)(millis() - litUntil) > 0) {
    lit = -1;
    redraw = true;
  }

  // A press wakes a dimmed screen; it still sends its key, because the display is what
  // somebody is looking at, not the stick.
  const bool idle = millis() - lastPress > DIM_AFTER_MS;
  if (idle != dimmed) {
    dimmed = idle;
    M5.Display.setBrightness(dimmed ? 20 : 120);
  }

  static uint32_t lastBattery = 0;
  if (millis() - lastBattery > 60000) {
    lastBattery = millis();
    hid->setBatteryLevel(M5.Power.getBatteryLevel());
    redraw = true;
  }

  if (redraw) {
    redraw = false;
    draw();
  }
  delay(5);
}
