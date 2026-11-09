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
