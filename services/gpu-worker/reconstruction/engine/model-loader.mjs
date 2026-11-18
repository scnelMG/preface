// Parse avatar/editable.json + editable.bin (browser or Node). Returns typed arrays that are treated as immutable.
export function parseEditable(json, arrayBuffer) {
  const lay = json.buffers.layout;
  const view = (name, Ctor) => {
    const l = lay[name];
    // copy so the original ArrayBuffer is never aliased by edits
    return new Ctor(arrayBuffer.slice(l.byteOffset, l.byteOffset + l.byteLength));
  };
  const positions = view('position', Float32Array);
  const normals = view('normal', Float32Array);
  const colors = view('color', Float32Array);
  const index = view('index', Uint32Array);
  const weld = view('weld_group', Uint32Array);
  Object.freeze(json);
  return { model: { ...json }, positions, normals, colors, index, weld };
}

export async function sha256Hex(buf) {
  const bytes = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const h = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}
