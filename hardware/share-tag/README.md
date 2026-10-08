# Share tag (#54)

Firmware for an **M5StickC PLUS** that carries one short share code and shows it, with the
square beside it, when its front button is pressed. A carried or tabletop prototype, not
something mounted on a fence: the LCD does not read in sunlight, the battery is small and the
case is not weatherproof.

## What it does and does not do

- **Never talks to Fencepost, never joins a network, holds no account token.** It holds a
  short code and nothing else. If it is lost, turn that code off on the storyboard's Share
  screen. `tests/test_share_tag.py` checks the source for any way out to the internet.
- Screen off unless a button was pressed: front (A) shows the code for 30 seconds and a
  second press puts it away; side (B) shows when it expires, if that was typed in at setup.
- **Only codes Fencepost made.** The tag carries the server's word list (`words.h`, generated
  by `scripts/build_tag_words.py`) and refuses words no Share screen hands out, both when
  saving and when a code saved earlier is shown. It cannot tell whether a code of listed
  words was ever issued; that only shows when someone scans it.
- No microphone, IMU or IR. Sensing at the street is the line the project turned down.

## Using it

1. On the storyboard's **Share** screen, turn on **Also give a short code** and make a code.
2. **Hold the tag's front button for two seconds.** It opens its own Wi-Fi access point and
   shows the network name, a fresh password and an address (192.168.4.1).
3. On your phone, join that network, open `http://192.168.4.1`, type the three words (and,
   if you like, when the code expires) and press **Save to the tag**. The access point
   closes. Turn mobile data off first: a phone that sees no internet on this network sends
   the request over mobile data instead, and the page times out.
4. At the fence, press the front button. The neighbour types the three words into
   **Got a code from a neighbour?** on Fencepost, or scans the square.

Setup closes by itself after five minutes if nothing is saved; the side button closes it
at once. Either way the saved code is left as it was.

## The square is small

The short side of the screen is 135 px, so the square comes out at about 3 px a module,
roughly 1 cm across. A phone camera can read it up close, but the three words are the
dependable way in, which is why they are the main thing on the screen and the square sits
beside them. Check both on the real device before relying on the square.

## Build and flash

Needs `arduino-cli` with the `esp32:esp32` core (built against 3.3.12) and the `M5Unified`
and `M5GFX` libraries.

```bash
arduino-cli compile --fqbn esp32:esp32:m5stack_stickc_plus hardware/share-tag
```

```bash
arduino-cli upload --fqbn esp32:esp32:m5stack_stickc_plus -p COM10 hardware/share-tag
```

Replace `COM10` with the tag's port (`arduino-cli board list`). Flashing replaces whatever
firmware the stick had; M5Burner can put the factory one back.

### On an M5StickS3

The same source runs on a StickS3: M5Unified detects the board, and the screen and buttons
match. There is no StickS3 board in the esp32 core, so build for the S3 with its options:

```bash
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi,USBMode=hwcdc,CDCOnBoot=cdc" --output-dir build-s3 hardware/share-tag
```

Write the bootloader, the partition table, `boot_app0.bin` and the app. `boot_app0.bin` is
not optional: firmware installed over the air may be booting from `app1`, and without it the
stick keeps running that.

```bash
esptool --chip esp32s3 --port COM8 write-flash --flash-mode dio --flash-size 8MB 0x0 build-s3/share-tag.ino.bootloader.bin 0x8000 build-s3/share-tag.ino.partitions.bin 0xe000 <esp32 core>/tools/partitions/boot_app0.bin 0x10000 build-s3/share-tag.ino.bin
```

Port numbers change when a stick is replugged, so check the chip and MAC with
`esptool --port COMx chip-id` before writing, and take a full `read-flash` backup first.
On the S3 reading only works reliably with `--no-stub`.

`BASE_URL` at the top of `share-tag.ino` is the front end's address and must match `WEB` in
`scripts/check_deploy.py`; the test checks the two agree.
