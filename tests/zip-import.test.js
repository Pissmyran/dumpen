import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync, deflateRawSync } from "node:zlib";
import {
  autodetectImagePath,
  autodetectR2Key,
  buildStoredZip,
  fillMissingThemes,
  readImageZip,
  imageDimensions,
  validateMediesviten,
  MEDIESVITEN_APPS,
} from "../public/zip-import.js";

function png(width = 512, height = 512) {
  const b = new Uint8Array(33);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([73, 72, 68, 82], 12);
  v.setUint32(16, width);
  v.setUint32(20, height);
  b[24] = 8;
  b[25] = 6;
  return b;
}
let table;
function crc32(buf) {
  if (!table)
    table = Array.from({ length: 256 }, (_, i) => {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  let c = ~0;
  for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ ~0) >>> 0;
}
function put16(a, n) {
  a.push(n & 255, (n >>> 8) & 255);
}
function put32(a, n) {
  put16(a, n);
  put16(a, n >>> 16);
}
function zip(entries, overrideCrc = false) {
  let local = [],
    central = [],
    pos = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i],
      name = new TextEncoder().encode(e.name),
      data = e.data ?? png(),
      deflated = e.method === 0 ? data : deflateRawSync(data);
    const method = e.method ?? 8,
      crc = crc32(data);
    let header = [];
    put32(header, 0x04034b50);
    put16(header, 20);
    put16(header, 2048);
    put16(header, method);
    put32(header, 0);
    put32(header, overrideCrc && i === 0 ? crc + 1 : crc);
    put32(header, deflated.length);
    put32(header, data.length);
    put16(header, name.length);
    put16(header, 0);
    local.push(...header, ...name, ...deflated);
    let cd = [];
    put32(cd, 0x02014b50);
    put16(cd, 20);
    put16(cd, 20);
    put16(cd, 2048);
    put16(cd, method);
    put32(cd, 0);
    put32(cd, overrideCrc && i === 0 ? crc + 1 : crc);
    put32(cd, deflated.length);
    put32(cd, data.length);
    put16(cd, name.length);
    put16(cd, 0);
    put16(cd, 0);
    put16(cd, 0);
    put16(cd, 0);
    put32(cd, 0);
    put32(cd, pos);
    central.push(...cd, ...name);
    pos = local.length;
  }
  let end = [];
  put32(end, 0x06054b50);
  put16(end, 0);
  put16(end, 0);
  put16(end, entries.length);
  put16(end, entries.length);
  put32(end, central.length);
  put32(end, local.length);
  put16(end, 0);
  return new File([new Uint8Array([...local, ...central, ...end])], "bilder.zip", {
    type: "application/zip",
  });
}
const inflate = (data) => inflateRawSync(data);
test("Auto detects app and theme paths and filename clues", () => {
  assert.deepEqual(autodetectImagePath("appar/plex/ikon-512.png"), {
    category: "apps",
    app: "plex",
    theme: "",
    variant: "",
    ready: true,
  });
  assert.deepEqual(autodetectImagePath("teman/midnatt/plex/bild.png"), {
    category: "themes",
    app: "plex",
    theme: "midnatt",
    variant: "",
    ready: true,
  });
  assert.deepEqual(autodetectImagePath("exports/sonarr-1254.png"), {
    category: "apps",
    app: "sonarr",
    theme: "",
    variant: "",
    ready: true,
  });
  assert.deepEqual(autodetectImagePath("plex-dark-512.png"), {
    category: "themes",
    app: "plex",
    theme: "dark",
    variant: "",
    ready: true,
  });
  assert.equal(autodetectImagePath("images/icon.png").ready, false);
});
test("Missing or generic theme names fall back to the ZIP file name", () => {
  const unnamed = autodetectImagePath("teman/untitled/plex/bild.png");
  assert.deepEqual(unnamed, {
    category: "themes",
    app: "plex",
    theme: "",
    variant: "",
    ready: false,
  });
  const [filled] = fillMissingThemes([unnamed], "Neon Glow.zip");
  assert.equal(filled.theme, "neon-glow");
  assert.equal(filled.ready, true);
  assert.equal(fillMissingThemes([unnamed], "tema.zip")[0].theme, "");
  const named = autodetectImagePath("teman/midnatt/plex/bild.png");
  assert.equal(fillMissingThemes([named], "Neon.zip")[0].theme, "midnatt");
});
test("ZIP with deflate and stored PNG files detects category and resolution", async () => {
  const out = await readImageZip(
    zip([
      { name: "appar/plex/icon.png", data: png() },
      { name: "teman/midnatt/sonarr/icon.png", data: png(1254, 1254), method: 0 },
      { name: "readme.txt", data: new TextEncoder().encode("hello") },
    ]),
    inflate,
  );
  assert.equal(out.images.length, 2);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.images[0].app, "plex");
  assert.equal(out.images[1].theme, "midnatt");
  assert.equal(out.images[1].size, "1254x1254");
  assert.equal(out.images[1].file.type, "image/png");
});
test("ZIP unsafe paths are rejected even if image looks valid", async () => {
  await assert.rejects(
    readImageZip(zip([{ name: "../apps/plex.png", data: png() }]), inflate),
    /osäker filsökväg/,
  );
});
test("Corrupted CRC and bad dimensions are excluded", async () => {
  await assert.rejects(
    readImageZip(zip([{ name: "plex.png", data: png() }], true), inflate),
    /inga giltiga PNG/,
  );
  await assert.rejects(
    readImageZip(zip([{ name: "plex.png", data: png(600, 600) }]), inflate),
    /inga giltiga PNG/,
  );
});
test("ZIP wrapper folder with multiple apps is not mistaken for app name", async () => {
  const out = await readImageZip(
    zip([
      { name: "Nya bilder/plex-512.png", data: png() },
      { name: "Nya bilder/sonarr-512.png", data: png() },
    ]),
    inflate,
  );
  assert.deepEqual(
    out.images.map((x) => x.app),
    ["plex", "sonarr"],
  );
});
test("ZIP repeated filenames are ignored; rejects garbage ZIP", async () => {
  const out = await readImageZip(
    zip([
      { name: "plex.png", data: png() },
      { name: "plex.png", data: png() },
    ]),
    inflate,
  );
  assert.equal(out.images.length, 1);
  assert.equal(out.skipped.length, 1);
  await assert.rejects(
    readImageZip(new File([new Uint8Array(40)], "trash.zip"), inflate),
    /fullständig ZIP/,
  );
});
test("PNG parser requires expected signature and dimensions", () => {
  assert.equal(imageDimensions(png()), "512x512");
  assert.equal(imageDimensions(png(1254, 1254)), "1254x1254");
  assert.equal(imageDimensions(png(512, 1254)), null);
});

test("Recognizes complete theme archives and nested variants", () => {
  assert.deepEqual(autodetectImagePath("Monument/plex/monument-plex-512x512.png"), {
    category: "themes",
    app: "plex",
    theme: "monument",
    variant: "",
    ready: true,
  });
  assert.deepEqual(
    autodetectImagePath(
      "Monument/whisparr/variants/maskerad/monument-whisparr-maskerad-512x512.png",
    ),
    { category: "themes", app: "whisparr", theme: "monument", variant: "maskerad", ready: true },
  );
  assert.deepEqual(
    autodetectImagePath("Mediesviten 14/Monument/sonarr/monument-sonarr-512x512.png"),
    { category: "themes", app: "sonarr", theme: "monument", variant: "", ready: true },
  );
});
test("Rejects incomplete full theme or mixed themes", () => {
  const all = MEDIESVITEN_APPS.flatMap((app) =>
    ["512x512", "1254x1254"].map((size) => ({
      category: "themes",
      theme: "monument",
      app,
      variant: "",
      size,
      selected: true,
    })),
  );
  assert.equal(validateMediesviten(all).valid, true);
  assert.equal(validateMediesviten(all.slice(1)).valid, false);
  assert.equal(
    validateMediesviten([
      ...all,
      { category: "themes", theme: "other", app: "plex", size: "512x512", selected: true },
    ]).valid,
    false,
  );
});
test("R2 keys: numbered sets become one theme per number", () => {
  assert.deepEqual(autodetectR2Key("imported/apps/plex/plex-3-512.png"), {
    category: "themes",
    app: "plex",
    theme: "tema-3",
    variant: "",
    ready: true,
  });
  assert.equal(autodetectR2Key("apps/sonarr/sonarr-07.png").theme, "tema-7");
  assert.equal(autodetectR2Key("imported/teman/midnatt/plex/bild.png").theme, "midnatt");
  assert.equal(
    autodetectR2Key(
      "imported/uploads/0c2068f2403006368ab8f6beca0f2117/22FA5DA7-4255-4E6E-9B61-902A54136D84.png",
    ).ready,
    false,
  );
});
test("A downloaded theme ZIP imports back into the same theme and apps", async () => {
  const blob = buildStoredZip([
    { path: "themes/midnatt/plex/midnatt-plex-512x512-aaaaaaaa.png", bytes: png() },
    {
      path: "themes/midnatt/whisparr/variants/rida/midnatt-whisparr-rida-1254x1254-bbbbbbbb.png",
      bytes: png(1254, 1254),
    },
  ]);
  const out = await readImageZip(new File([blob], "midnatt.zip"), inflate);
  assert.equal(out.images.length, 2);
  const [plex, whisparr] = out.images;
  assert.equal(plex.theme, "midnatt");
  assert.equal(plex.app, "plex");
  assert.equal(whisparr.app, "whisparr");
  assert.equal(whisparr.variant, "rida");
  assert.equal(whisparr.size, "1254x1254");
});

// Central directory entries can all refer to the same local data.
function repeatedDataZip(data, sizes, crc = 0) {
  const name = new TextEncoder().encode("shared.png");
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint16(26, name.length, true);
  const central = sizes
    .map(({ expanded, compressed = data.length }, i) => {
      const entryName = new TextEncoder().encode(`image-${i}.png`);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(10, 8, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, compressed, true);
      entry.setUint32(24, expanded, true);
      entry.setUint16(28, entryName.length, true);
      return [entry, entryName];
    })
    .flat();
  const offset = local.byteLength + name.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, sizes.length, true);
  end.setUint16(10, sizes.length, true);
  end.setUint32(
    12,
    central.reduce((n, x) => n + x.byteLength, 0),
    true,
  );
  end.setUint32(16, offset, true);
  return new File([local, name, data, ...central, end], "shared.zip");
}

test("ZIP expansion budget counts entries that fail decompression or validation", async () => {
  const size = 10 * 1024 * 1024;
  const invalidImage = new Uint8Array(size);
  const data = deflateRawSync(invalidImage);
  const sizes = [...Array(14).fill({ expanded: size }), { expanded: 33 }];
  for (const failure of ["inflate", "length", "crc", "dimensions"]) {
    const archive = repeatedDataZip(
      data,
      sizes,
      failure === "dimensions" ? crc32(invalidImage) : 1,
    );
    let calls = 0;
    await assert.rejects(
      readImageZip(archive, () => {
        calls++;
        if (failure === "inflate") throw new Error("invalid deflate");
        if (failure === "length") return new Uint8Array(0);
        return invalidImage;
      }),
      /140 MB/,
      failure,
    );
    assert.equal(calls, 14, failure);
  }
});

test("ZIP compressed work budget counts repeated failed entries", async () => {
  const mb = 1024 * 1024;
  const data = new Uint8Array(12 * mb);
  const sizes = [
    ...Array(11).fill({ expanded: 33, compressed: 12 * mb }),
    { expanded: 33, compressed: 8 * mb },
    { expanded: 33, compressed: 1 },
  ];
  let calls = 0;
  await assert.rejects(
    readImageZip(repeatedDataZip(data, sizes), () => {
      calls++;
      throw new Error("invalid deflate");
    }),
    /140 MB/,
  );
  assert.equal(calls, 12);
});

test("ZIP imports valid images alongside rejected entries within the work budget", async () => {
  const result = await readImageZip(
    zip(
      [
        { name: "bad-crc.png", data: png() },
        { name: "bad-size.png", data: png(600, 600) },
        { name: "plex.png", data: png() },
      ],
      true,
    ),
    inflate,
  );
  assert.deepEqual(
    result.images.map((image) => image.path),
    ["plex.png"],
  );
  assert.equal(result.skipped.length, 2);
});
