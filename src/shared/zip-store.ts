const crcTable = buildCrcTable();

const localSignature = 0x04034b50;
const centralSignature = 0x02014b50;
const eocdSignature = 0x06054b50;
const utf8Flag = 0x0800;

export function zipStore(files: Readonly<Record<string, string>>): Uint8Array {
  const names = Object.keys(files);
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(files[name] ?? "");
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, localSignature, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, utf8Flag, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, centralSignature, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, utf8Flag, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  const directory = concat(centrals);
  eocdView.setUint32(0, eocdSignature, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, names.length, true);
  eocdView.setUint16(10, names.length, true);
  eocdView.setUint32(12, directory.length, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);
  return concat([...locals, directory, eocd]);
}

export function unzipStore(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (directoryOffset + directorySize > bytes.length) {
    throw new Error("The .swarm file is not a zip archive");
  }

  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== centralSignature) {
      throw new Error("The .swarm file is not a zip archive");
    }
    const method = view.getUint16(cursor + 10, true);
    const checksum = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) {
      throw new Error("The .swarm file is not a zip archive");
    }
    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    cursor = nameEnd + extraLength + commentLength;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== localSignature) {
      throw new Error("The .swarm file is not a zip archive");
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > bytes.length) {
      throw new Error("The .swarm file is not a zip archive");
    }
    if (method !== 0) {
      throw new Error(`The .swarm file uses an unsupported compression method (${method})`);
    }
    const raw = bytes.subarray(start, end);
    if (crc32(raw) !== checksum) {
      throw new Error("The .swarm file is corrupted");
    }
    files.set(name, decoder.decode(raw));
  }
  return files;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === eocdSignature) {
      return offset;
    }
  }
  throw new Error("The .swarm file is not a zip archive");
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const entry = crcTable[(crc ^ byte) & 0xff] ?? 0;
    crc = (entry ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
