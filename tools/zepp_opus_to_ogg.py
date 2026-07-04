#!/usr/bin/env python3
import argparse
import re
import os
import struct
from datetime import datetime, timezone


SAMPLE_RATE = 48000
CHANNELS = 1
PRE_SKIP = 312


def build_ogg_crc_table():
    table = []

    for value in range(256):
        register = value << 24

        for _ in range(8):
            if register & 0x80000000:
                register = ((register << 1) ^ 0x04C11DB7) & 0xFFFFFFFF
            else:
                register = (register << 1) & 0xFFFFFFFF

        table.append(register)

    return table


OGG_CRC_TABLE = build_ogg_crc_table()


def ogg_crc(data):
    checksum = 0

    for byte in data:
        index = ((checksum >> 24) & 0xFF) ^ byte
        checksum = ((checksum << 8) & 0xFFFFFFFF) ^ OGG_CRC_TABLE[index]

    return checksum


def read_zepp_packets(path):
    data = open(path, "rb").read()
    packets = []
    offset = 0

    while offset + 4 <= len(data):
        size_field = struct.unpack(">I", data[offset:offset + 4])[0]
        offset += 4
        # Zepp OS writes raw Opus packets in a private frame format. On the
        # Bip 6 sample files, each frame is:
        #   uint32_be opus_size, uint32_be zepp_timestamp, opus_packet
        size = size_field + 4

        if size <= 0 or offset + size > len(data):
            raise ValueError(f"Invalid packet size {size} at offset {offset - 4}")

        packets.append(data[offset + 4:offset + size])
        offset += size

    if offset != len(data):
        raise ValueError(f"Trailing bytes after last packet: {len(data) - offset}")

    if not packets:
        raise ValueError("No Opus packets found")

    return packets


def opus_samples_per_packet(packet):
    if not packet:
        return 960

    toc = packet[0]
    code = toc & 0x03

    if toc & 0x80:
        samples_per_frame = (SAMPLE_RATE << ((toc >> 3) & 0x03)) // 400
    elif (toc & 0x60) == 0x60:
        samples_per_frame = SAMPLE_RATE // 50 if (toc & 0x08) else SAMPLE_RATE // 100
    else:
        mode = toc & 0x0C
        if mode == 0x0C:
            samples_per_frame = SAMPLE_RATE // 50
        elif mode == 0x08:
            samples_per_frame = SAMPLE_RATE // 100
        elif mode == 0x04:
            samples_per_frame = SAMPLE_RATE // 200
        else:
            samples_per_frame = SAMPLE_RATE // 400

    if code == 0:
        frames = 1
    elif code in (1, 2):
        frames = 2
    elif len(packet) > 1:
        frames = packet[1] & 0x3F
    else:
        frames = 1

    return samples_per_frame * frames


def ogg_page(serial, sequence, granule_position, flags, packets):
    segment_table = []
    body = bytearray()

    for packet in packets:
        remaining = len(packet)
        pos = 0

        while remaining >= 255:
            segment_table.append(255)
            body.extend(packet[pos:pos + 255])
            pos += 255
            remaining -= 255

        segment_table.append(remaining)
        body.extend(packet[pos:pos + remaining])

    header = bytearray()
    header.extend(b"OggS")
    header.append(0)
    header.append(flags)
    header.extend(struct.pack("<Q", granule_position))
    header.extend(struct.pack("<I", serial))
    header.extend(struct.pack("<I", sequence))
    header.extend(struct.pack("<I", 0))
    header.append(len(segment_table))
    header.extend(bytes(segment_table))

    header[22:26] = struct.pack("<I", ogg_crc(bytes(header) + bytes(body)))

    return bytes(header) + bytes(body)


def opus_head():
    return (
        b"OpusHead"
        + bytes([1, CHANNELS])
        + struct.pack("<H", PRE_SKIP)
        + struct.pack("<I", SAMPLE_RATE)
        + struct.pack("<h", 0)
        + bytes([0])
    )


def opus_tags():
    vendor = b"Voice Ideas Zepp OS"
    return b"OpusTags" + struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", 0)


def convert(input_path, output_path):
    packets = read_zepp_packets(input_path)
    serial = 0x56494445
    sequence = 0
    granule = 0

    with open(output_path, "wb") as out:
        out.write(ogg_page(serial, sequence, 0, 0x02, [opus_head()]))
        sequence += 1
        out.write(ogg_page(serial, sequence, 0, 0x00, [opus_tags()]))
        sequence += 1

        for packet in packets:
            granule += opus_samples_per_packet(packet)
            out.write(ogg_page(serial, sequence, granule, 0x00, [packet]))
            sequence += 1


def readable_output_path(input_path, use_local_time=False):
    directory = os.path.dirname(input_path)
    filename = os.path.basename(input_path)
    match = re.match(r"^(\d{13})", filename)

    if not match:
        base, _ = os.path.splitext(input_path)
        return f"{base}.ogg"

    timestamp_ms = int(match.group(1))
    if use_local_time:
        recorded_at = datetime.fromtimestamp(timestamp_ms / 1000)
    else:
        recorded_at = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)

    output_name = f"{recorded_at.strftime('%Y-%m-%d_%H-%M-%S')}-idea.ogg"
    return os.path.join(directory, output_name)


def main():
    parser = argparse.ArgumentParser(description="Convert Zepp OS length-prefixed Opus to Ogg Opus.")
    parser.add_argument("input")
    parser.add_argument("output", nargs="?")
    parser.add_argument(
        "--local-time",
        action="store_true",
        help="Use the computer local timezone instead of UTC for the generated file name.",
    )
    args = parser.parse_args()

    output = args.output
    if not output:
        output = readable_output_path(args.input, args.local_time)

    convert(args.input, output)
    print(output)


if __name__ == "__main__":
    main()
