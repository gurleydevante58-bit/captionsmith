'use strict';
/* Shared by the Edit and Captions screens. */
/* ============ Recording repair ============
   Phone/Chrome recorders write "fragmented" MP4s (or WebMs) with no real duration in the header.
   YouTube and many players then think the clip is a few seconds long. These functions rewrite the
   file in place-free fashion: same audio/video data, proper header with the true length. */
function fmp4ToMp4(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  const str = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  function boxes(start, end) {
    const out = []; let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o), hdr = 8; const type = str(o + 4);
      if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr || o + size > end) break;
      out.push({ type, start: o, end: o + size, body: o + hdr }); o += size;
    }
    return out;
  }
  const child = (b, t) => boxes(b.body, b.end).find(x => x.type === t);
  const top = boxes(0, u8.length);
  const moov = top.find(b => b.type === 'moov'); if (!moov) throw new Error('no moov');
  const moofs = top.filter(b => b.type === 'moof'); if (!moofs.length) return null; // already a normal MP4
  const raw = b => u8.subarray(b.start, b.end);
  const tracks = new Map();
  boxes(moov.body, moov.end).filter(b => b.type === 'trak').forEach(trak => {
    const tkhd = child(trak, 'tkhd'), mdia = child(trak, 'mdia'), mdhd = child(mdia, 'mdhd'), hdlr = child(mdia, 'hdlr'), minf = child(mdia, 'minf');
    const stbl = child(minf, 'stbl'), stsd = child(stbl, 'stsd');
    const tv = u8[tkhd.body], id = dv.getUint32(tkhd.body + (tv ? 20 : 12));
    const mv = u8[mdhd.body], timescale = dv.getUint32(mdhd.body + (mv ? 20 : 12));
    const handler = str(hdlr.body + 8);
    const mhd = boxes(minf.body, minf.end).find(b => b.type === 'vmhd' || b.type === 'smhd' || b.type === 'nmhd');
    tracks.set(id, { id, timescale, handler, tkhd: raw(tkhd), mdhd: raw(mdhd), hdlr: raw(hdlr), mhd: mhd ? raw(mhd) : null, dinf: child(minf, 'dinf') ? raw(child(minf, 'dinf')) : null, stsd: raw(stsd), samples: [], def: { dur: 0, size: 0, flags: 0 } });
  });
  const mvex = child(moov, 'mvex');
  if (mvex) boxes(mvex.body, mvex.end).filter(b => b.type === 'trex').forEach(t => { const tr = tracks.get(dv.getUint32(t.body + 4)); if (tr) tr.def = { dur: dv.getUint32(t.body + 12), size: dv.getUint32(t.body + 16), flags: dv.getUint32(t.body + 20) }; });
  moofs.forEach(moof => {
    let prevEnd = moof.start;
    boxes(moof.body, moof.end).filter(b => b.type === 'traf').forEach(traf => {
      const tfhd = child(traf, 'tfhd'); const ff = dv.getUint32(tfhd.body) & 0xffffff; let p = tfhd.body + 4;
      const tr = tracks.get(dv.getUint32(p)); p += 4; if (!tr) return;
      let base = (ff & 0x20000) ? moof.start : prevEnd; let dDur = tr.def.dur, dSize = tr.def.size, dFlags = tr.def.flags;
      if (ff & 0x1) { base = Number(dv.getBigUint64(p)); p += 8; }
      if (ff & 0x2) p += 4;
      if (ff & 0x8) { dDur = dv.getUint32(p); p += 4; }
      if (ff & 0x10) { dSize = dv.getUint32(p); p += 4; }
      if (ff & 0x20) { dFlags = dv.getUint32(p); p += 4; }
      const tfdt = child(traf, 'tfdt'); let t = tfdt ? (u8[tfdt.body] ? Number(dv.getBigUint64(tfdt.body + 4)) : dv.getUint32(tfdt.body + 4)) : null;
      let dataPtr = base;
      boxes(traf.body, traf.end).filter(b => b.type === 'trun').forEach(trun => {
        const ver = u8[trun.body], fl = dv.getUint32(trun.body) & 0xffffff; let q = trun.body + 4;
        const n = dv.getUint32(q); q += 4;
        if (fl & 0x1) { dataPtr = base + dv.getInt32(q); q += 4; }
        let first = null; if (fl & 0x4) { first = dv.getUint32(q); q += 4; }
        for (let i = 0; i < n; i++) {
          let dur = dDur, size = dSize, flags = dFlags, cto = 0;
          if (fl & 0x100) { dur = dv.getUint32(q); q += 4; }
          if (fl & 0x200) { size = dv.getUint32(q); q += 4; }
          if (fl & 0x400) { flags = dv.getUint32(q); q += 4; } else if (i === 0 && first !== null) flags = first;
          if (fl & 0x800) { cto = ver ? dv.getInt32(q) : dv.getUint32(q); q += 4; }
          tr.samples.push({ off: dataPtr, size, dur, cto, sync: !(flags & 0x10000), dts: t });
          dataPtr += size; if (t !== null) t += dur;
        }
      });
      prevEnd = dataPtr;
    });
  });
  const list = [...tracks.values()].filter(t => t.samples.length);
  if (!list.length) throw new Error('no samples');
  // ---- writers ----
  const parts = []; const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const box = (type, ...payloads) => { let len = 8; payloads.forEach(p => len += p.length); const out = new Uint8Array(len); out.set(be32(len), 0); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); let o = 8; payloads.forEach(p => { out.set(p, o); o += p.length; }); return out; };
  const u32s = arr => { const out = new Uint8Array(arr.length * 4); const d = new DataView(out.buffer); arr.forEach((v, i) => d.setUint32(i * 4, v >>> 0)); return out; };
  const ftyp = box('ftyp', new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50, 97, 118, 99, 49, 109, 112, 52, 49]));
  // mdat: each track's samples back to back (one chunk per track)
  let payload = 0; list.forEach(t => { t.chunkOff = payload; t.samples.forEach(s => payload += s.size); });
  const big = payload + 8 > 0xffffffff; const mdatHdr = big ? new Uint8Array(16) : new Uint8Array(8);
  { const d = new DataView(mdatHdr.buffer); if (big) { d.setUint32(0, 1); mdatHdr.set([109, 100, 97, 116], 4); d.setBigUint64(8, BigInt(payload + 16)); } else { d.setUint32(0, payload + 8); mdatHdr.set([109, 100, 97, 116], 4); } }
  const dataStart = ftyp.length + mdatHdr.length;
  const mdatParts = [];
  list.forEach(t => { let runS = -1, runE = -1; t.samples.forEach(s => { if (s.off === runE) runE += s.size; else { if (runS >= 0) mdatParts.push(u8.subarray(runS, runE)); runS = s.off; runE = s.off + s.size; } }); if (runS >= 0) mdatParts.push(u8.subarray(runS, runE)); });
  const movieTS = 1000; let movieDur = 0;
  const traks = list.map(t => {
    const total = t.samples.reduce((a, s) => a + s.dur, 0); const durMs = Math.round(total / t.timescale * 1000); movieDur = Math.max(movieDur, durMs);
    const tk = t.tkhd.slice(); const tkd = new DataView(tk.buffer); if (tk[8]) { tkd.setBigUint64(8 + 28, BigInt(durMs)); } else tkd.setUint32(8 + 20, durMs); tk[11] = tk[11] | 3; // enabled + in movie
    const md = t.mdhd.slice(); const mdd = new DataView(md.buffer); if (md[8]) mdd.setBigUint64(8 + 24, BigInt(total)); else mdd.setUint32(8 + 16, Math.min(total, 0xffffffff));
    const stts = []; t.samples.forEach(s => { const l = stts[stts.length - 1]; if (l && l[1] === s.dur) l[0]++; else stts.push([1, s.dur]); });
    const anyCto = t.samples.some(s => s.cto); const ctts = []; if (anyCto) t.samples.forEach(s => { const l = ctts[ctts.length - 1]; if (l && l[1] === s.cto) l[0]++; else ctts.push([1, s.cto]); });
    const syncs = t.samples.map((s, i) => s.sync ? i + 1 : 0).filter(Boolean);
    const stblKids = [
      t.stsd,
      box('stts', u32s([0, stts.length, ...stts.flat()])),
      ...(anyCto ? [box('ctts', u32s([t.samples.some(s => s.cto < 0) ? 0x01000000 : 0, ctts.length, ...ctts.flat()]))] : []),
      ...(t.handler === 'vide' && syncs.length < t.samples.length ? [box('stss', u32s([0, syncs.length, ...syncs]))] : []),
      box('stsc', u32s([0, 1, 1, t.samples.length, 1])),
      box('stsz', u32s([0, 0, t.samples.length, ...t.samples.map(s => s.size)])),
    ];
    const off = dataStart + t.chunkOff;
    stblKids.push(off > 0xffffffff ? (() => { const b = new Uint8Array(16); const d = new DataView(b.buffer); d.setUint32(4, 1); d.setBigUint64(8, BigInt(off)); return box('co64', b); })() : box('stco', u32s([0, 1, off])));
    const minf = box('minf', ...[t.mhd, t.dinf || box('dinf', box('dref', u32s([0, 1]), box('url ', u32s([1]))))].filter(Boolean), box('stbl', ...stblKids));
    const startTicks = t.samples[0].dts || 0; let edts = [];
    if (startTicks > 0) { const gap = Math.round(startTicks / t.timescale * movieTS); edts = [box('edts', box('elst', u32s([0, 2, gap, 0xffffffff, 0x00010000, durMs, 0, 0x00010000])))]; }
    return box('trak', tk, ...edts, box('mdia', md, t.hdlr, minf));
  });
  const mvhd = new Uint8Array(100); { const d = new DataView(mvhd.buffer); d.setUint32(12, movieTS); d.setUint32(16, movieDur); d.setUint32(20, 0x00010000); d.setUint16(24, 0x0100); [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((v, i) => d.setUint32(36 + i * 4, v)); d.setUint32(96, Math.max(...list.map(t => t.id)) + 1); }
  const moovOut = box('moov', box('mvhd', mvhd), ...traks);
  parts.push(ftyp, mdatHdr, ...mdatParts, moovOut);
  return { parts, duration: movieDur / 1000 };
}

function webmSetDuration(buf, seconds) {
  // Insert or replace the Duration element inside Segment > Info (MediaRecorder WebMs leave it out)
  const u8 = new Uint8Array(buf);
  const vint = o => { const b = u8[o]; let len = 1, mask = 0x80; while (len <= 8 && !(b & mask)) { len++; mask >>= 1; } let v = b & (mask - 1); for (let i = 1; i < len; i++) v = v * 256 + u8[o + i]; const unknown = v === Math.pow(2, 7 * len) - 1; return { len, v, unknown }; };
  const idLen = o => { const b = u8[o]; return b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : 4; };
  const idAt = (o, n) => Array.from(u8.subarray(o, o + n)).map(x => x.toString(16).padStart(2, '0')).join('');
  // find Segment
  let o = 0; { const il = idLen(o); const s = vint(o + il); o = o + il + s.len + s.v; } // skip EBML header
  if (idAt(o, 4) !== '18538067') throw new Error('no segment');
  const segSize = vint(o + 4); let p = o + 4 + segSize.len;
  while (p < u8.length) {
    const il = idLen(p), id = idAt(p, il), sz = vint(p + il), body = p + il + sz.len;
    if (id === '1549a966') {
      // collect Info children, minus any Duration
      const keep = []; let tsScale = 1000000; let q = body;
      while (q < body + sz.v) { const cl = idLen(q), cid = idAt(q, cl), cs = vint(q + cl), end = q + cl + cs.len + cs.v; if (cid === '2ad7b1') { tsScale = 0; for (let i = q + cl + cs.len; i < end; i++) tsScale = tsScale * 256 + u8[i]; } if (cid !== '4489') keep.push(u8.subarray(q, end)); q = end; }
      const dur = new Uint8Array(11); dur.set([0x44, 0x89, 0x88]); new DataView(dur.buffer).setFloat64(3, seconds * 1e9 / tsScale);
      const content = keep.reduce((a, k) => a + k.length, 0) + dur.length;
      const head = new Uint8Array(12); head.set([0x15, 0x49, 0xa9, 0x66, 0x01]); { let v = content; for (let i = 11; i >= 5; i--) { head[i] = v & 255; v = Math.floor(v / 256); } }
      return { parts: [u8.subarray(0, p), head, ...keep, dur, u8.subarray(body + sz.v)] };
    }
    if (sz.unknown) break; p = body + sz.v;
  }
  throw new Error('no info');
}

async function repairRecording(blob, type, seconds) {
  try {
    const buf = await blob.arrayBuffer();
    const r = type.includes('mp4') ? fmp4ToMp4(buf) : webmSetDuration(buf, seconds);
    if (!r) return blob;
    return new Blob(r.parts, { type });
  } catch (e) { console.warn('Could not repair recording', e); return blob; }
}
if (typeof module !== 'undefined') module.exports = { fmp4ToMp4, webmSetDuration };
