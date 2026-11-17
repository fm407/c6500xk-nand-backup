<h1 align="center">C6500XK NAND Backup</h1>
<p align="center">Quantum Fiber / Gemtek SmartNID firmware backup field guide</p>
<p align="center"><b>11 MTD partitions</b> · <b>516.68 MiB</b> · <b>SHA-256 verification</b></p>
<p align="center"><a href="https://raw.githubusercontent.com/fm407/c6500xk-nand-backup/main/C6500XK_Guide_Download.pdf">Download the PDF guide</a> · <a href="https://raw.githubusercontent.com/fm407/c6500xk-nand-backup/main/backup-c6500xk.sh">Download the shell script</a></p>

> [!NOTE]
> The manual backup on 7 November 2026 saved all 11 partitions to a 32 GB USB drive. All 11 SHA-256 checks passed and optical status reported Up/GOOD.

> [!IMPORTANT]
> Use an existing root shell and a verified USB mount. Keep raw images private. The live UBI capture can contain changes made during the read and needs a separate restore plan before any flash operation.

[Read the C6500XK cutover report](docs/c6500xk-cutover.md) for the working XGS-PON setup and wired benchmarks.

## Contents

- [Quick reference](#quick-reference)
- [Interactive PON diagrams](#interactive-pon-diagrams)
- [1. Rules before you begin](#1-rules-before-you-begin)
- [2. Prepare the USB drive](#2-prepare-the-usb-drive)
- [3. Record the device and flash layout](#3-record-the-device-and-flash-layout)
- [4. Confirm read tools and NAND properties](#4-confirm-read-tools-and-nand-properties)
- [5. Make the first two NAND backups](#5-make-the-first-two-nand-backups)
- [6. The mtd2 error and its tested recovery](#6-the-mtd2-error-and-its-tested-recovery)
- [7. Dump the remaining eraseblock-aligned partitions](#7-dump-the-remaining-eraseblock-aligned-partitions)
- [8. Verify all 11 images and save checksums](#8-verify-all-11-images-and-save-checksums)
- [9. Restore normal operation and remove USB safely](#9-restore-normal-operation-and-remove-usb-safely)
- [10. Copy and examine the backup offline](#10-copy-and-examine-the-backup-offline)
- [11. Troubleshooting and decision table](#11-troubleshooting-and-decision-table)
- [Appendix A. Reusable full backup script](#appendix-a-reusable-full-backup-script)
- [Appendix B. Evidence recorded in the successful session](#appendix-b-evidence-recorded-in-the-successful-session)
- [Appendix C. Offline firmware findings](#appendix-c-offline-firmware-findings)
- [Appendix D. Router-side VLAN mode follows the loaded profile](#appendix-d-router-side-vlan-mode-follows-the-loaded-profile)
- [Appendix E. No upstream rate cap in the replacement's OMCI contract](#appendix-e-no-upstream-rate-cap-in-the-replacements-omci-contract)
- [Appendix F. Replacement identity checklist for a C6500XK swap](#appendix-f-replacement-identity-checklist-for-a-c6500xk-swap)

## Quick reference

| Device | Confirmed configuration |
| --- | --- |
| Product | Quantum Fiber / Gemtek C6500XK SmartNID |
| Processor | EcoNet EN7580, MIPS32 interAptiv, 4 logical CPUs |
| Kernel | Linux 4.4.115, build dated 30 Oct 2024 |
| Flash | NAND MTD, 256 KiB eraseblocks, 4 KiB pages, 128-byte OOB |
| Live root | SquashFS at /rom, writable overlay on UBI/UBIFS |
| USB backup | /dev/sda1, FAT, mounted at /mnt/sda1 |
| Backup folder | /mnt/sda1/C6500XK-backup/ |

Use the manual steps in Sections 1-8. Appendix A includes a reusable shell script that follows the same extraction methods. The successful session used the manual procedure. Appendix A contains the standalone wrapper.

## Interactive PON diagrams

- [XGS-PON activation and OMCI provisioning](https://fm407.github.io/c6500xk-nand-backup/diagrams/xgs-pon-activation.html)
  separates conditional PLOAM registration from the OMCI startup and
  provisioning exchanges captured on the SmartNID.
- [SmartNID forwarding and queue ownership](https://fm407.github.io/c6500xk-nand-backup/diagrams/smartnid-forwarding.html)
  shows the captured VLAN, GEM queue and T-CONT relationships used as the
  replacement-module reference.

The links open the interactive diagrams in your browser. Some source links
require access to the Quantum research repository. The standalone HTML files
are also available in [docs/diagrams](docs/diagrams).

## 1. Rules before you begin

- Use a root shell on the C6500XK. Do not change the flash contents.
- Keep the modem powered. Avoid rebooting it while reading NAND.
- Use only the verified USB mount. Never assume that /dev/sda belongs to the USB drive.

- Use read-only flash inputs such as /dev/mtdNro for direct reads.
- Keep incomplete files and logs for diagnosis. Do not rename a partial file as a completed image.
- Keep backup images private. They may contain certificates, keys, serial numbers, and configuration data.

## 2. Prepare the USB drive

Use a dedicated USB flash drive. The successful backup used a 32.09 GB drive (29.88 GiB). A 4 GB drive has enough capacity for these files, but 16 GB or larger provides a safer margin.

### 2.1 Format on Windows, before connecting to the modem

- Back up any existing data. Formatting removes files from the selected USB partition.
- Choose an MBR partition layout and FAT32 filesystem. Use the default allocation unit size.
- Use the volume label C6500BACKUP. Select Quick Format.
- If Windows does not offer FAT32, use a reliable FAT32 formatting utility. Do not format any disk inside the modem.
- Eject the USB drive from Windows. Insert it into the C6500XK USB port.

The tested drive had /dev/sda1 as its main FAT partition. Another 1 MiB partition was visible. No change to that small partition was needed.

### 2.2 Identify the drive and mount

```sh
ls /sys/bus/usb/devices/
cat /proc/partitions
ls -l /dev/sd* 2>/dev/null
cat /proc/filesystems
cat /proc/mounts | grep ' /mnt/sda1 '
df -h /mnt/sda1
```

The proven setup automatically mounted /dev/sda1 at /mnt/sda1. Confirm that the path is mounted before writing anything. Seeing a directory alone is not enough.

If the drive is detected as /dev/sda1, FAT/VFAT is supported, and it is not mounted, a manual mount can be attempted:

```sh
mkdir -p /mnt/sda1
mount -t vfat /dev/sda1 /mnt/sda1
cat /proc/mounts | grep ' /mnt/sda1 '
```

> [!IMPORTANT]
> **Stop if the device differs**
>
> If the device name, partition, or mounted filesystem differs, identify it first. Do not run mount, format, or dump commands against an unverified storage device.

## 3. Record the device and flash layout

Run the following commands to confirm the device. They read system information only.

```sh
id -u
uname -a
cat /proc/cpuinfo
cat /proc/cmdline
cat /proc/mtd
cat /proc/partitions
ls -l /dev/mtd* 2>/dev/null
cat /proc/mounts
cat /sys/class/mtd/mtd8/type
```

In the verified session, id -u returned 0, /proc/cmdline contained ubi.mtd=system, and mtd8 was NAND flash. The MTD partition map was:

| MTD | Name | Size (bytes) | Successful method |
| --- | --- | --- | --- |
| 0 | bootloader | 2,097,152 | nanddump |
| 1 | dsd | 2,097,152 | nanddump |
| 2 | kernel | 2,590,920 | dd /dev/mtd2ro |
| 3 | rootfs | 22,478,848 | dd /dev/mtd3ro |
| 4 | tclinux | 67,108,864 | nanddump |
| 5 | kernel_slave | 2,583,253 | dd /dev/mtd5ro |
| 6 | rootfs_slave | 36,503,552 | dd /dev/mtd6ro |
| 7 | tclinux_slave | 67,108,864 | nanddump |
| 8 | system | 335,544,320 | nanddump |
| 9 | uenv | 2,097,152 | nanddump |
| 10 | art | 1,572,864 | nanddump |

Total of 11 saved file sizes: 541,782,941 bytes (516.68 MiB). Some firmware partitions may describe overlapping image regions. Do not use the sum to infer physical chip capacity.

### 3.1 Save inventory and layout reports

```sh
OUT=/mnt/sda1/C6500XK-backup
mkdir -p "$OUT"
cat /proc/mtd > "$OUT/partition-map.txt"
uname -a > "$OUT/kernel-version.txt"
cat /proc/cmdline > "$OUT/kernel-cmdline.txt"
cat /proc/mounts > "$OUT/mounted-filesystems.txt"
mtdinfo -a > "$OUT/mtd-info.txt" 2>&1
ubinfo -a > "$OUT/ubi-info.txt" 2>&1
sync
```

The successful device showed three UBI volumes inside the system partition: rootfs_data, config, and log. Their reported data sizes were 33,775,616, 17,014,784, and 17,014,784 bytes.

## 4. Confirm read tools and NAND properties

```sh
for x in nanddump mtdinfo ubinfo dd tar scp busybox; do
     echo "=== $x ==="
     command -v "$x" || echo "Not found"
done
nanddump --help 2>&1 | grep -E 'padbad|omitoob'
mtdinfo -a
```

The proven device had /usr/sbin/nanddump, /usr/sbin/mtdinfo, /usr/sbin/ubinfo, /bin/dd, /bin/tar, and /usr/bin/scp. It accepted both --bb=padbad and --omitoob.

Meaning: --bb=padbad preserves logical positions when bad blocks are padded. --omitoob leaves NAND spare-area bytes out of the file. The output is not a physical OOB-inclusive chip image.

## 5. Make the first two NAND backups

### 5.1 Bootloader (mtd0)

```sh
OUT=/mnt/sda1/C6500XK-backup
nanddump --bb=padbad --omitoob \
  -f "$OUT/mtd0_bootloader.bin" /dev/mtd0
wc -c "$OUT/mtd0_bootloader.bin"
```

The verified output was exactly 2,097,152 bytes. The diagnostic report showed zero ECC failures, zero corrections, and zero bad blocks.

### 5.2 DSD (mtd1)

```sh
nanddump --bb=padbad --omitoob \
  -f "$OUT/mtd1_dsd.bin" /dev/mtd1
wc -c "$OUT/mtd1_dsd.bin"
```

This image was also exactly 2,097,152 bytes. No ECC failures or corrections were reported.

## 6. The mtd2 error and its tested recovery

> [!IMPORTANT]
> **Observed error**
>
> nanddump exited with status 1 while checking the last partial eraseblock of mtd2. The error text was: bad eraseblock number 9, mtd2 has 9 eraseblocks. The first attempt left mtd2_kernel.bin.partial.

The kernel partition has 2,590,920 bytes. Nine complete 262,144-byte eraseblocks hold 2,359,296 bytes. The final 231,624 bytes form a partial tenth eraseblock. On this system, nanddump did not handle that trailing region.

The four partitions with sizes not aligned to the eraseblock are mtd2, mtd3, mtd5, and mtd6. These were successfully read with dd from the read-only MTD character devices.

### 6.1 Preserve the failed file and recover mtd2

```sh
OUT=/mnt/sda1/C6500XK-backup
# Do not delete mtd2_kernel.bin.partial.
dd if=/dev/mtd2ro \
  of="$OUT/mtd2_kernel.bin.dd.partial" bs=4096
cat /sys/class/mtd/mtd2/size
wc -c "$OUT/mtd2_kernel.bin.dd.partial"
```

The successful dd run returned zero exit errors and produced 2,590,920 bytes. After the size check, the recovered image was saved as mtd2_kernel.bin. The failed nanddump partial remained available for diagnostics.

```sh
# Only after dd succeeds and both sizes match:
mv "$OUT/mtd2_kernel.bin.dd.partial" \
   "$OUT/mtd2_kernel.bin"
```

### 6.2 Read the three other unaligned partitions

```sh
dd if=/dev/mtd3ro of="$OUT/mtd3_rootfs.bin" bs=4096
dd if=/dev/mtd5ro of="$OUT/mtd5_kernel_slave.bin" bs=4096
dd if=/dev/mtd6ro of="$OUT/mtd6_rootfs_slave.bin" bs=4096
```

Check every exit status and every file size against /sys/class/mtd/mtdN/size. In a new run, use temporary output names first. Rename each file only after a successful read and exact size check.

These dd reads use kernel-managed MTD reads. They do not include NAND OOB bytes. They also do not produce the same detailed per-read ECC report that nanddump printed.

## 7. Dump the remaining eraseblock-aligned partitions

Use nanddump for the remaining partitions. This was the successful method for mtd4, mtd7, mtd8, mtd9, and mtd10.

```sh
OUT=/mnt/sda1/C6500XK-backup
for i in 4 7 8 9 10; do
     NAME=$(cat /sys/class/mtd/mtd$i/name)
     FILE="$OUT/mtd${i}_${NAME}.bin"
     nanddump --bb=padbad --omitoob \
       -f "$FILE" "/dev/mtd$i" || break
done
sync
```

The completed nanddump operations reported zero ECC failures, zero ECC corrections, and zero bad blocks in their diagnostics. Stop and investigate any nonzero exit status, ECC error, or unexpected size.

> [!IMPORTANT]
> **Live ubi warning**
>
> The 320 MiB mtd8 system image was read while its UBI volumes were mounted and active. Its SHA-256 checksum verifies the saved bytes. It does not prove a consistent filesystem snapshot or a safe restoration image.

## 8. Verify all 11 images and save checksums

First check the file count, file sizes, partition map, and UBI layout. Then create and check SHA-256 hashes.

```sh
cd /mnt/sda1/C6500XK-backup
ls -lh mtd*.bin
ls mtd*.bin | wc -l
for i in 0 1 2 3 4 5 6 7 8 9 10; do
     NAME=$(cat /sys/class/mtd/mtd$i/name)
     FILE="mtd${i}_${NAME}.bin"
     EXPECTED=$(cat /sys/class/mtd/mtd$i/size)
     ACTUAL=$(wc -c < "$FILE")
     echo "mtd$i: expected=$EXPECTED actual=$ACTUAL"
done
sha256sum mtd*.bin > SHA256SUMS
sha256sum -c SHA256SUMS
sync
```

The completed session had 11 files and 11 SHA-256 results marked OK. SHA-256 confirms that saved files match the hashes written to SHA256SUMS. It cannot prove a perfect NAND read or live filesystem consistency.

### 8.1 Verification checklist

- The 11 completed files exist, with the names shown in Section 3.
- Every file size matches the corresponding sysfs size.
- SHA256SUMS exists and all 11 checks return OK.
- partition-map.txt, mtd-info.txt, and ubi-info.txt are saved.
- Logs and any failed .partial images remain available separately.
- The final sync command has finished.

## 9. Restore normal operation and remove USB safely

Restore any device settings changed for the backup, then verify normal operation. The successful session confirmed optics reported Up/GOOD.

Exit the USB directory before unmounting it. A shell with its current directory on the drive causes Resource busy. This exact issue occurred in the successful session.

```sh
cd /
sync
umount /mnt/sda1
mount | grep sda1
```

If umount succeeds and mount | grep sda1 prints nothing, remove the USB stick. If unmount reports Resource busy, do not unplug it. Check for open shell directories or processes that still use the drive.

## 10. Copy and examine the backup offline

Copy the entire C6500XK-backup folder to a private directory on Windows. Keep the original USB contents unchanged. Verify the copied hashes in WSL or Linux before inspecting any images.

```sh
cd /path/to/C6500XK-backup
sha256sum -c SHA256SUMS
file mtd2_kernel.bin mtd3_rootfs.bin
file mtd5_kernel_slave.bin mtd6_rootfs_slave.bin
# Optional, if binwalk is installed:
binwalk mtd2_kernel.bin
binwalk mtd3_rootfs.bin
binwalk mtd4_tclinux.bin
```

Use a non-root Linux account for ordinary offline analysis. The next investigation can identify the EcoNet PON drivers, ONU configuration, image formats, and primary/secondary firmware differences.

> [!IMPORTANT]
> **Security and restore limitation**
>
> Treat the raw images as secrets. Do not upload the full system, config, bootloader, or calibration partitions publicly. A verified backup is not automatically a bootable or safe-to-flash recovery image.

## 11. Troubleshooting and decision table

| Condition | Recommended action |
| --- | --- |
| USB directory exists, but is not mounted | Stop. Check /proc/mounts and identify the actual USB partition. |
| nanddump fails on an unaligned MTD partition | Keep the partial file. Read the corresponding /dev/mtdNro device with dd; verify its size. |
| nanddump reports a bad block or ECC error | Stop and review the diagnostic log. Do not assume a readable, restorable image. |
| dd exits nonzero or the output is short | Keep the incomplete file. Investigate before continuing. |
| File size differs from sysfs size | Mark the backup incomplete. Do not include it in the verified set. |
| Hash verification fails after transfer | Re-copy the file from the original USB backup. Preserve the original. |
| umount reports Resource busy | Run cd /, close processes using the USB path, then retry sync and umount. |

## Appendix A. Reusable full backup script

This companion script uses the same proven methods. It reads all 11 partitions, skips existing files only when their sizes match, saves diagnostics, records layout reports, checks SHA-256 hashes, and stops on failure. It does not erase or write NAND.

Save `backup-c6500xk.sh` on the mounted USB drive. Review the script and confirm the mount before running this command from the modem root shell.

```sh
sh /mnt/sda1/backup-c6500xk.sh
```

This reusable wrapper is reconstructed from the session; it has not itself been run on the modem.

> [!IMPORTANT]
> **About existing partial files**
>
> The script writes new temporary files with .work suffixes. It never deletes the previously failed mtd2_kernel.bin.partial. A completed image is skipped only if its size matches sysfs.

```sh
#!/bin/sh
# C6500XK read-only NAND backup to an already-mounted FAT32 USB drive.
# Reconstructed from a successful 2026-11-07 backup session.
# Does not write to MTD devices. Run as root after checking the target mount.
set -eu

USB=/mnt/sda1
OUT="$USB/C6500XK-backup"

if ! grep -q ' /mnt/sda1 ' /proc/mounts; then
    echo "ERROR: $USB is not a mounted filesystem. Stop."
    exit 1
fi
if [ "$(id -u)" != 0 ]; then
    echo "ERROR: A root shell is required to read the MTD devices."
    exit 1
fi
if ! command -v nanddump >/dev/null 2>&1 || ! command -v dd >/dev/null 2>&1; then
    echo "ERROR: nanddump and dd must be available."
    exit 1
fi

mkdir -p "$OUT"

# Preserve the observed NAND/UBI layout and running environment.
cat /proc/mtd > "$OUT/partition-map.txt"
uname -a > "$OUT/kernel-version.txt"
cat /proc/cmdline > "$OUT/kernel-cmdline.txt"
cat /proc/mounts > "$OUT/mounted-filesystems.txt"
mtdinfo -a > "$OUT/mtd-info.txt" 2>&1 || echo 'WARNING: mtdinfo metadata failed.'
ubinfo -a > "$OUT/ubi-info.txt" 2>&1 || echo 'WARNING: ubinfo metadata failed.'

# mtd2, mtd3, mtd5, and mtd6 have partial eraseblocks.
# nanddump --bb=padbad fails on mtd2 with this firmware's partition sizes.
# Direct reads through /dev/mtdNro were successful for these four partitions.
for i in 0 1 2 3 4 5 6 7 8 9 10; do
    NAME=$(cat "/sys/class/mtd/mtd$i/name")
    EXPECTED=$(cat "/sys/class/mtd/mtd$i/size")
    FILE="$OUT/mtd${i}_${NAME}.bin"
    WORK="$FILE.work"
    LOG="$OUT/mtd${i}_${NAME}.dump.log"

    if [ -f "$FILE" ]; then
        ACTUAL=$(wc -c < "$FILE")
        if [ "$ACTUAL" -ne "$EXPECTED" ]; then
            echo "ERROR: Existing file has wrong size: $FILE"
            exit 1
        fi
        echo "SKIP: $FILE already has $EXPECTED bytes"
        continue
    fi
    if [ -e "$WORK" ]; then
        echo "ERROR: Incomplete working file exists: $WORK"
        echo "Preserve it for diagnosis; do not overwrite it automatically."
        exit 1
    fi

    echo "BACKUP: mtd$i ($NAME), expected $EXPECTED bytes"
    if [ "$i" = 2 ] || [ "$i" = 3 ] || [ "$i" = 5 ] || [ "$i" = 6 ]; then
        if ! dd if="/dev/mtd${i}ro" of="$WORK" bs=4096 > "$LOG" 2>&1; then
            echo "ERROR: Direct read failed: mtd$i. Review $LOG"
            exit 1
        fi
    else
        if ! nanddump --bb=padbad --omitoob -f "$WORK" "/dev/mtd$i" > "$LOG" 2>&1; then
            echo "ERROR: NAND dump failed: mtd$i. Review $LOG"
            exit 1
        fi
    fi

    ACTUAL=$(wc -c < "$WORK")
    if [ "$ACTUAL" -ne "$EXPECTED" ]; then
        echo "ERROR: Wrong size for mtd$i: got $ACTUAL, expected $EXPECTED"
        exit 1
    fi
    mv "$WORK" "$FILE"
    echo "SUCCESS: mtd$i ($NAME), $ACTUAL bytes"
done

cd "$OUT"
sha256sum mtd*.bin > SHA256SUMS
sha256sum -c SHA256SUMS
sync

echo 'Completed. Check that all 11 files passed SHA-256 validation.'
echo 'Keep the USB mounted until all writes are flushed and checks succeed.'
```

## Appendix B. Evidence recorded in the successful session

- Root shell: uid 0 on hostname modem.
- Kernel: Linux 4.4.115; SoC: EcoNet EN7580; boot argument ubi.mtd=system.
- NAND: 262,144-byte eraseblocks, 4,096-byte pages, 128-byte OOB.
- USB: /dev/sda1, FAT, mounted at /mnt/sda1; 32.09 GB drive.
- mtd0 and mtd1: 2,097,152 bytes each; no reported ECC errors.
- mtd2: nanddump failed on partial eraseblock 9; dd via /dev/mtd2ro recovered exactly 2,590,920 bytes.
- mtd3, mtd5, and mtd6: direct MTD character reads succeeded.
- mtd4, mtd7, mtd8, mtd9, and mtd10: nanddump completed without reported ECC errors or bad blocks.
- All 11 SHA-256 verification results were OK; final sync completed.
- Optical status reported Up/GOOD after the backup.
- The raw images remained on the USB drive and were not uploaded.

The evidence comes from commands, diagnostics, partition listing, and completion status provided during the 7 November 2026 troubleshooting session. This guide does not claim an independent review of the user-local diagnostic log files.

## Appendix C. Offline firmware findings

Results supplied after the 11-image NAND backup, 7 November 2026.

### Validated checks and image structure

All 11 saved images passed SHA-256 validation on the offline copy. The four unaligned MTD regions were read through the MTD read-only character devices. Both combined tclinux images were checked byte-for-byte against the separate kernel and SquashFS images; the component ranges matched exactly.

| Image slot | Firmware version | Kernel offset to SquashFS |
| --- | --- | --- |
| Primary (mtd4) | CKT001-02.02.39.00 | 0x2788C8 |
| Secondary (mtd7) | CKT002-02.04.56.00 | 0x276AD5 |

### SquashFS metadata

Primary rootfs (mtd3): 22,382,502 bytes compressed; 2,782 inodes; SquashFS v4, gzip/zlib; created 15 Mar 2022 at 13:05:05. Secondary rootfs (mtd6): 36,356,060 bytes compressed; 3,107 inodes; SquashFS v4, gzip/zlib; created 30 Oct 2024 at 13:45:34.

### Differences relevant to the XGS-PON investigation

Different between slots: xpon.ko, xpon_10g.ko, xponmap.ko, the OMCI daemon, and the platform manager. Byte-identical between slots: gponmgr and gpon_flow.ko. This directs offline analysis toward the changed XPON and OMCI components. It does not by itself reveal the ONU authentication method or secrets.

### Suggested offline, read-only comparison (Linux/WSL)

```sh
mkdir -p analysis/primary analysis/secondary
unsquashfs -d analysis/primary mtd3_rootfs.bin
unsquashfs -d analysis/secondary mtd6_rootfs_slave.bin
diff -qr analysis/primary analysis/secondary > analysis/diff.txt
```

> [!IMPORTANT]
> **Interpretation / security**
>
> The running 2024 kernel build is consistent with the secondary image, but it does not independently prove which boot slot is active. Confirm the boot selection before making that claim. Extracted files may contain private credentials. Keep the image files and all extracted configuration data in private storage.

## Appendix D. Router-side VLAN mode follows the loaded profile

*Field verified 17 November 2026 on the installed replacement ONU, from the boot log and the live traffic-control filters. Read-only observation; nothing was changed to obtain it.*

The replacement firmware's VLAN fixer does not read a fixed router-side tagging mode. It re-detects the configuration from the effective MIB on every boot and writes the result to `/tmp/8311-config.sh` as `INTERNET_VLAN`. Changing the MIB profile therefore changes the encapsulation presented on the router-facing link.

| Loaded profile | `INTERNET_VLAN` | Router-facing link |
| --- | --- | --- |
| stock `prx300_1U.ini` | the Internet service VLAN | tagged |
| reviewed identity profile | `0` | untagged |

Installed filters, same firmware and hardware, on consecutive boots. Service VLAN values are shown as placeholders:

```text
# stock profile -> tagged
ingress <pmapper>: flower action vlan modify id <internet-vlan> protocol 802.1Q
egress  <pmapper>: flower vlan_id <internet-vlan> action vlan modify id <service-vlan>
                   flower action drop                    pref 1
                   flower protocol all action drop       pref 3

# reviewed profile -> untagged
ingress <pmapper>: flower action vlan pop
egress  <pmapper>: flower action drop                    pref 1
                   flower protocol all action vlan push id <service-vlan>
```

The two modes are mutually exclusive, and the router port must match whichever one is installed. A port configured untagged, pointed at a module that has fallen back to the stock profile, shows link up and receives frames it discards: registration reaches O5.1, OMCI provisioning completes, and no DHCP lease appears. That presents as an associated ONU with no Internet, and it is **not** a VLAN-table fault. The fixer is doing the right thing for the profile it was given.

Three read-only checks distinguish the modes:

```sh
cat /tmp/8311-config.sh                    # INTERNET_VLAN=0 means untagged
tc filter show dev <pmapper> ingress
tc filter show dev <pmapper> egress
```

The boot log records every programmed rule verbatim, in order:

```sh
logread | grep -i -E 'vlan|pmapper'
```

Recovery is to point the MIB-file variable back at the reviewed profile, restore the stock template if it was overwritten, and restart the daemon. The fixer returns to the mode that profile implies.

### D.1 The profile pointer can revert while the profile survives

The persistent environment was found naming the stock template while the reviewed profile was still present and hash-intact. The identity was therefore half applied: serial number, vendor ID and equipment ID derive from environment variables and survived, while values that exist only inside the profile reverted. Both sets were read back from the ONU2-G instance.

A profile that is present is not proof that it is loaded. Read the pointer and the profile-only attributes.

### D.2 The daemon overwrites whichever path the pointer names

The daemon stores the effective MIB back into the path named by the MIB-file variable. With the stock path selected, the packaged stock template is rewritten in place.

| State | Bytes | SHA-256 |
| --- | ---: | --- |
| as shipped | 21,497 | `676871578948468b43a2b3e0dc05b6ecc70a9ba961e2c5e1974c407a33f2d687` |
| after one boot with it selected | 21,476 | `dda1c3e25b0627824121fcf3e6e8f503d34c826f143644cdb186a02d36a8f682` |

The stock fallback then no longer matches the shipped image. Restore it from the pinned firmware copy rather than assuming it is still pristine.

## Appendix E. No upstream rate cap in the replacement's OMCI contract

*Field verified 17 November 2026 by read-only traversal of the live MIB on the installed module. Only the daemon's read verbs were used: no Set, Create, Delete, store or reboot.*

Several hundred managed entities were present. Traffic descriptors (class 280) appear in no shipped template; every one of them was created at runtime by the OLT. Most carried a peak information rate set just above the subscribed line rate, symmetric between upstream and downstream. The remaining few carried a very low rate and are referenced by the Dot1 rate limiter for upstream unknown-unicast, broadcast and multicast flood only.

The chain was followed instance by instance. Every GEM port network CTP (class 268) terminates on the single provisioned T-CONT (class 262) that holds an allocated Alloc-ID; the remaining T-CONTs stay at the unassigned Alloc-ID. Each GEM port references a distinct upstream and a distinct downstream traffic descriptor, and both directions resolve to the same headroom figure. Each GEM port also carries its own downstream priority-queue pointer.

The ONU advertises full traffic-management support in the ONU-G traffic-management option. That advertisement is what entitles the OLT to create those descriptors at all; with the option absent the ONU would hold no traffic descriptor and no rate object whatsoever.

**Conclusion, with its limit stated: no rate object reachable through the replacement's OMCI contract constrains the upstream below the provisioned rate.** A shortfall in that direction is not explained by the text profile. The candidate explanations remain OLT scheduling, service provisioning, and measurement itself. The discriminator is the original unit on the same fibre, which needs an outage and has not been performed.

The exact provisioned rates, descriptor count, GEM port identifiers and T-CONT assignments are omitted here on purpose: they describe one subscriber's service profile. The structural result above does not depend on them.

The read-only traversal used two daemon verbs:

```sh
omci_pipe.sh md                  # enumerate the managed entities in the MIB
omci_pipe.sh meg <class> <inst>  # dump one entity, attribute by attribute
```

## Appendix F. Replacement identity checklist for a C6500XK swap

*Field verified 17 November 2026 on the installed replacement ONU. Every value below was read from the running unit and compared against the shipped templates.*

The OLT compares a small set of attributes before it will provision service. Those attributes do not all come from the same place, and that split is the usual cause of a half-applied identity.

| Reported attribute | Source | Masked example |
| --- | --- | --- |
| ONU-G vendor ID | first four characters of the serial | `<vendor>` |
| ONU-G version (reported hardware) | hardware-version variable | `<model>` |
| ONU-G serial number | four ASCII characters plus four binary bytes | `<pon-serial>` |
| ONU2-G equipment ID | equipment ID / CLEI variable | `<equipment-id>` |
| ONU2-G OMCC version | OMCC variable, mirrored into the OMCI config | `0xNN` |
| ONU2-G vendor product code | **profile only** | `0xNNNN` |
| ONU2-G total traffic schedulers | **profile only** | integer |
| ONU2-G total priority queues | **profile only** | integer |
| ONU2-G total GEM port ID number | **profile only** | integer |
| ONU-G traffic management option | OMCI config, shipped default `2` | `2` |
| PON slot | PON slot variable | integer |
| IP host MAC | IP-host MAC variable | `<wan-mac>` |
| Software A / B | software-version variables | `NN.NN.NN.NN` |
| Reported active / committed bank | bank override variables | letter pair |

### F.1 The two halves that get out of step

The **profile-only** rows above are the ones to watch. They exist nowhere outside the loaded MIB, so they revert the moment the MIB pointer moves, while the environment-derived rows keep whatever the last `setenv` wrote.

This was observed directly. After the pointer reverted to the stock template, the serial, vendor ID and equipment ID still read correctly on ONU-G, while the vendor product code came back as `0x0000` and the traffic-scheduler count fell from 16 to 8 on ONU2-G. Registration succeeded and the OLT provisioned service anyway, because it keys the subscriber on the serial. A working link is not evidence that the identity is complete.

Note also that the reported hardware string is an OMCI value, not the printed hardware revision, and that the bank override changes what OMCI reports rather than which firmware image boots.

### F.2 Environment beats configuration

At boot the OMCI init script copies the pointer out of the U-Boot environment into the OMCI configuration, overwriting whatever is there:

```sh
tmp=$(fw_printenv -n <pointer-variable> 2>&-)
[ -f "$tmp" ] && uci set omci.default.mib_file="$tmp"
```

The environment is therefore authoritative and the configuration database is downstream of it. A change that only reaches the configuration database, which is what a web-interface save does, looks correct until the next boot and then silently reverts.

Set the pointer with the environment tool, read it back from the environment, and confirm it from the boot log rather than from any web page:

```sh
fw_setenv <pointer-variable> <profile-path>
fw_printenv <pointer-variable>
logread | grep -i 'MIB file'
```

Do not write the custom profile into the packaged template path. The daemon stores the effective MIB back into whatever path the pointer names, so the shipped template is destroyed and no longer matches the firmware image. See [Appendix D.2](#d2-the-daemon-overwrites-whichever-path-the-pointer-names).

### F.3 Read-only verification

Registration state alone is insufficient. Read the identity back from both management entities, plus the two mask variables, which are separate and must not be conflated:

```sh
omci_pipe.sh meg 256 0     # ONU-G: vendor, version, serial, traffic-management option
omci_pipe.sh meg 257 0     # ONU2-G: equipment id, OMCC, product code, queue and scheduler counts
pon gsg                    # expect O5.1, FEC state, upstream and downstream rate
fw_printenv | grep -i -E 'iop_mask|mib_file'
uci get gpon.ponip.iop_mask
```

A boot log line reporting a prompt-state of `51` is O5.1, which means associated. It does not by itself mean a lease was issued; the check for that is a WAN DHCP lease and working Internet access.

### F.4 Do not reuse another subscriber's values

Equipment ID, serial, IP-host MAC and bank selection are per-unit. They are read from the original modem, not copied from a guide, and a guide that shows them is showing one subscriber's identity. Registration ID, LOID and logical password are blank when the line authenticates on serial alone; adding values that the original unit does not send is a change, not a default.

The software-version variables accept an extraction pattern rather than a literal in some builds. Where that applies, the pattern is stored base64-encoded in the environment and decodes to a single capturing group such as `^(\d{2}(?:\.\d{2}){3})$`, with group 1 used as the reported version. That pattern selects digits out of a string; it does not select a firmware bank.

### F.5 Sample profile

[profiles/c6500xk-sample.ini](profiles/c6500xk-sample.ini) is the profile format with the two per-unit values replaced by placeholders. Everything else is already correct for a C6500XK: the vendor product code, the traffic-scheduler and queue counts, the traffic-management option, and the blank serial that the daemon fills from PLOAM.

Only two things need editing:

| Placeholder | Occurrences | Replace with |
| --- | ---: | --- |
| `XXXX` | 4 | the first four characters of your FSAN |
| `XXXXXXXXXX` | 7 | your ten-character CLEI, leaving the trailing `\0` padding intact |

Do not set the serial to a literal, and do not upload the file with the placeholders still in it; it would present a wrong vendor ID and a wrong equipment ID.

Two honest limits. The file was normalised by the module's own daemon from a real unit, so it reflects that daemon version's output rather than the shipped template byte for byte. And it was observed on one line against one OLT; the OLT-owned service provisioning is replayed at runtime and is not contained in this file at all.

Slot 8 is already baked in. The class 5 and 6 rows sit at instance `0x0108`, and the class 277 related-port fields read `0x0801xxxx`. The boot helper only rewrites rows that still read `0x0101`, so changing `pon_slot` on top of this file will not renumber it. Keep `pon_slot` at 8, which reproduces the numbering the original unit reported, or renumber those rows by hand if your original unit used a different number. The numbering is chosen by the ONU rather than assigned by the OLT, so a difference is not fatal, but it does stop the profile from mirroring the original unit.
