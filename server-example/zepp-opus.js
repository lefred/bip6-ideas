const fs = require('fs')

const SAMPLE_RATE = 48000
const CHANNELS = 1
const PRE_SKIP = 312
const OGG_CRC_TABLE = buildOggCrcTable()

function convertZeppOpusToOgg(inputPath, outputPath) {
  const packets = readZeppPackets(inputPath)
  const serial = 0x56494445
  let sequence = 0
  let granule = 0
  const pages = []

  pages.push(oggPage(serial, sequence, 0, 0x02, [opusHead()]))
  sequence += 1
  pages.push(oggPage(serial, sequence, 0, 0x00, [opusTags()]))
  sequence += 1

  for (const packet of packets) {
    granule += opusSamplesPerPacket(packet)
    pages.push(oggPage(serial, sequence, granule, 0x00, [packet]))
    sequence += 1
  }

  fs.writeFileSync(outputPath, Buffer.concat(pages))
  return {
    packets: packets.length,
    outputPath
  }
}

function readZeppPackets(inputPath) {
  const data = fs.readFileSync(inputPath)
  const packets = []
  let offset = 0

  while (offset + 4 <= data.length) {
    const sizeField = data.readUInt32BE(offset)
    offset += 4
    // Bip 6 / Zepp OS writes: uint32_be opus_size, uint32_be timestamp, opus_packet.
    const frameSize = sizeField + 4

    if (sizeField <= 0 || offset + frameSize > data.length) {
      throw new Error(`Invalid Zepp Opus frame at offset ${offset - 4}`)
    }

    packets.push(data.subarray(offset + 4, offset + frameSize))
    offset += frameSize
  }

  if (offset !== data.length) {
    throw new Error(`Trailing bytes after last packet: ${data.length - offset}`)
  }

  if (!packets.length) {
    throw new Error('No Zepp Opus packets found')
  }

  return packets
}

function opusSamplesPerPacket(packet) {
  if (!packet.length) {
    return 960
  }

  const toc = packet[0]
  const code = toc & 0x03
  let samplesPerFrame

  if (toc & 0x80) {
    samplesPerFrame = (SAMPLE_RATE << ((toc >> 3) & 0x03)) / 400
  } else if ((toc & 0x60) === 0x60) {
    samplesPerFrame = toc & 0x08 ? SAMPLE_RATE / 50 : SAMPLE_RATE / 100
  } else {
    const mode = toc & 0x0c
    if (mode === 0x0c) {
      samplesPerFrame = SAMPLE_RATE / 50
    } else if (mode === 0x08) {
      samplesPerFrame = SAMPLE_RATE / 100
    } else if (mode === 0x04) {
      samplesPerFrame = SAMPLE_RATE / 200
    } else {
      samplesPerFrame = SAMPLE_RATE / 400
    }
  }

  let frames = 1
  if (code === 1 || code === 2) {
    frames = 2
  } else if (code === 3 && packet.length > 1) {
    frames = packet[1] & 0x3f
  }

  return samplesPerFrame * frames
}

function oggPage(serial, sequence, granulePosition, flags, packets) {
  const segments = []
  const bodyParts = []

  for (const packet of packets) {
    let offset = 0
    let remaining = packet.length

    while (remaining >= 255) {
      segments.push(255)
      bodyParts.push(packet.subarray(offset, offset + 255))
      offset += 255
      remaining -= 255
    }

    segments.push(remaining)
    bodyParts.push(packet.subarray(offset, offset + remaining))
  }

  const body = Buffer.concat(bodyParts)
  const header = Buffer.alloc(27 + segments.length)

  header.write('OggS', 0, 'ascii')
  header[4] = 0
  header[5] = flags
  writeUInt64LE(header, granulePosition, 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(sequence, 18)
  header.writeUInt32LE(0, 22)
  header[26] = segments.length
  Buffer.from(segments).copy(header, 27)

  const page = Buffer.concat([header, body])
  page.writeUInt32LE(oggCrc(page), 22)

  return page
}

function opusHead() {
  const buffer = Buffer.alloc(19)
  buffer.write('OpusHead', 0, 'ascii')
  buffer[8] = 1
  buffer[9] = CHANNELS
  buffer.writeUInt16LE(PRE_SKIP, 10)
  buffer.writeUInt32LE(SAMPLE_RATE, 12)
  buffer.writeInt16LE(0, 16)
  buffer[18] = 0
  return buffer
}

function opusTags() {
  const vendor = Buffer.from('Voice Ideas Zepp OS')
  const buffer = Buffer.alloc(8 + 4 + vendor.length + 4)
  buffer.write('OpusTags', 0, 'ascii')
  buffer.writeUInt32LE(vendor.length, 8)
  vendor.copy(buffer, 12)
  buffer.writeUInt32LE(0, 12 + vendor.length)
  return buffer
}

function buildOggCrcTable() {
  const table = []

  for (let value = 0; value < 256; value += 1) {
    let register = value << 24

    for (let bit = 0; bit < 8; bit += 1) {
      register = register & 0x80000000
        ? ((register << 1) ^ 0x04c11db7) >>> 0
        : (register << 1) >>> 0
    }

    table.push(register >>> 0)
  }

  return table
}

function oggCrc(buffer) {
  let checksum = 0

  for (const byte of buffer) {
    const index = ((checksum >>> 24) & 0xff) ^ byte
    checksum = (((checksum << 8) >>> 0) ^ OGG_CRC_TABLE[index]) >>> 0
  }

  return checksum >>> 0
}

function writeUInt64LE(buffer, value, offset) {
  const low = value >>> 0
  const high = Math.floor(value / 0x100000000) >>> 0
  buffer.writeUInt32LE(low, offset)
  buffer.writeUInt32LE(high, offset + 4)
}

module.exports = {
  convertZeppOpusToOgg
}
