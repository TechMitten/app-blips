// A minimal ustar writer for Surge uploads (surgeApi.js), which take a
// gzipped tar. Only plain files with short ASCII names (page names are
// checked first), so no long-name or pax extensions. Web primitives only,
// like the rest of this folder: the gzip step is CompressionStream.

const BLOCK = 512;
const encoder = new TextEncoder();

const writeString = (header, offset, length, text) => {
  header.set(encoder.encode(text).subarray(0, length), offset);
};

// Numeric fields are zero-padded octal ending in NUL.
const writeOctal = (header, offset, length, value) => {
  writeString(header, offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
};

function fileHeader(name, size, mtime) {
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header[156] = 0x30; // '0': regular file
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  // The checksum is summed with its own field as spaces, then written as six
  // octal digits, NUL, space.
  header.fill(0x20, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  writeString(header, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return header;
}

// [{ name, data: string | Uint8Array }] -> tar bytes.
export function createTar(entries, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  const parts = [];
  let length = 0;
  for (const { name, data } of entries) {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    const padded = Math.ceil(bytes.length / BLOCK) * BLOCK;
    parts.push(fileHeader(name, bytes.length, mtime), bytes, new Uint8Array(padded - bytes.length));
    length += BLOCK + padded;
  }
  // Two empty blocks end the archive.
  parts.push(new Uint8Array(BLOCK * 2));
  length += BLOCK * 2;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
