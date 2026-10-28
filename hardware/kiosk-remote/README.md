# Display remote (M5StickS3)

A hand-held remote for the park display at the booth. The display is driven by three keys,
Back (left arrow), Choose (Enter) and Next (right arrow), read in
`web/public/wildlife/shared/controls.js`; this firmware makes the stick a keyboard that sends
only those three.

| On the stick | Sends | On the display |
|---|---|---|
| front button (A) | Enter | Choose |
| side button (B) | right arrow | Next |
| side button held 0.6 s | left arrow | Back |

It is a Bluetooth keyboard and a USB keyboard at the same time. Pair it once over Bluetooth
("Fencepost remote", no PIN) and it works without a cable; if Bluetooth misbehaves on the day,
plug it into the display's computer with a USB-C cable and the same buttons keep working with
nothing to change. A tablet with USB-C takes it as a keyboard too.

The screen lists the three buttons and lights the one just sent, shows whether Bluetooth is
connected, and dims after a minute without a press. There is no volume knob; use the
computer's own volume.

What it does not do: no Wi-Fi, no Fencepost account or token, and the microphone and IMU are
not used, the same line the share tag kept.

## It replaces the share tag on this stick

On 2026-10-28 the StickS3 that carried the share tag (#54) was given this job instead. The
share tag's source is unchanged in `hardware/share-tag` and goes back on the same way it was
first flashed; a full image of the stick as it was is in
`C:\Users\LewisDong\Documents\stick-backups\share-tag-s3-14c19fd5360c-2026-10-28.bin`.

## Build

There is no StickS3 board in the esp32 core, so build for the S3 with its options. Unlike the
share tag, USB Mode must be TinyUSB (`USBMode=default`): with the hardware CDC the share tag
uses, the USB keyboard never appears.

```bash
arduino-cli compile --fqbn "esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi,USBMode=default,CDCOnBoot=cdc" --output-dir <build dir> hardware/kiosk-remote
```

Keep the build directory out of the repository and on a short path.

## Flash

Check it is the StickS3 before writing anything. Port numbers change on every replug, and the
M5StickC PLUS on the same machine runs On the Beat:

```bash
esptool --port COMx chip-id
```

The MAC must be `14:c1:9f:d5:36:0c`. Take a full backup first (`read-flash` with `--no-stub`;
about 45 minutes on the S3). Then write the bootloader, the partition table, `boot_app0.bin`
and the app, as for the share tag: `boot_app0.bin` at `0xe000` is not optional, or a stick
booting from `app1` keeps running whatever was there.

```bash
esptool --chip esp32s3 --port COMx write-flash --flash-mode dio --flash-size 8MB 0x0 <build>/kiosk-remote.ino.bootloader.bin 0x8000 <build>/kiosk-remote.ino.partitions.bin 0xe000 <esp32 core>/tools/partitions/boot_app0.bin 0x10000 <build>/kiosk-remote.ino.bin
```

Once this firmware is on, the stick's USB port belongs to TinyUSB rather than the chip's
built-in serial, so the next flash may not find it on its own. If `esptool` cannot connect,
put the stick in download mode by hand and try again.

## Pairing

On the display's computer, add a Bluetooth device and choose "Fencepost remote". The bond is
kept, so after that it reconnects by itself when the stick is switched on. If a computer
refuses to reconnect, remove the device there and pair again.
