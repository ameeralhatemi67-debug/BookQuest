// Generates small, original test books into e2e/.fixtures (git-ignored):
//   the-lighthouse.epub   — a 12-chapter EPUB 3 with a table of contents and cover
//   field-notes.pdf       — a 24-page PDF with real, selectable text
//   large.pdf             — optional synthetic large PDF (`--large <MB>`), for upload tests
//
// All text is generated here, so nothing copyrighted is ever needed or committed.
import JSZip from "jszip";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "e2e", ".fixtures");

// ---------------------------------------------------------------- text
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0xffffffff;
  };
}

const SUBJECTS = ["The keeper", "Mara", "The old captain", "A gull", "The tide", "Her brother", "The lamp", "Nobody", "The harbour", "A stranger", "The storm", "Morning"];
const VERBS = ["watched", "remembered", "carried", "counted", "forgot", "followed", "waited for", "listened to", "turned toward", "wrote about", "measured", "doubted"];
const OBJECTS = ["the long stair", "a letter nobody sent", "the far light", "the salt on the glass", "every ship that passed", "the quiet between waves", "a name scratched in the rail", "the weather of that year", "the first boat out", "what the sea kept", "a door left open", "the hour before dawn"];
const TAILS = ["without a word", "as if it mattered", "for the second time that week", "and said nothing of it", "while the kettle sang", "until the fog came in", "with a patience that surprised her", "though the wind was rising", "and the light went round", "the way her mother had", "because someone had to", "long after the others slept"];

function sentence(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  return `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}.`;
}

function paragraph(random, sentences) {
  return Array.from({ length: sentences }, () => sentence(random)).join(" ");
}

const CHAPTER_TITLES = [
  "The Long Stair", "Salt on the Glass", "A Letter Nobody Sent", "The First Boat Out", "What the Sea Kept", "Fog",
  "The Hour Before Dawn", "A Door Left Open", "Every Ship That Passed", "The Weather of That Year", "The Far Light", "Morning",
];

// ---------------------------------------------------------------- EPUB
const escapeXml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A tiny valid PNG (a 2×3 terracotta rectangle) used as cover art.
const COVER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFUlEQVR4nGPYEqT1//9/BhDeEqQFADyOB7fT3u7uAAAAAElFTkSuQmCC",
  "base64",
);

async function makeEpub() {
  const random = rng(20260930);
  const zip = new JSZip();
  // The mimetype entry must be first and uncompressed.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );

  const chapters = CHAPTER_TITLES.map((title, index) => {
    const paragraphs = Array.from({ length: 26 }, () => `<p>${escapeXml(paragraph(random, 5 + Math.floor(random() * 4)))}</p>`).join("\n");
    const file = `chapter-${String(index + 1).padStart(2, "0")}.xhtml`;
    const html = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><section epub:type="chapter"><h1>Chapter ${index + 1}</h1><h2>${escapeXml(title)}</h2>
${paragraphs}
</section></body></html>`;
    zip.file(`OEBPS/${file}`, html);
    return { file, title: `Chapter ${index + 1} · ${title}`, id: `ch${index + 1}` };
  });

  zip.file("OEBPS/style.css", "body{font-family:serif;line-height:1.5}h1{font-size:1.1em;letter-spacing:.1em;text-transform:uppercase}h2{font-size:1.6em;margin-top:0}p{margin:0 0 1em;text-indent:1.2em}");
  zip.file("OEBPS/cover.png", COVER_PNG);
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters
      .map((c) => `<li><a href="${c.file}">${escapeXml(c.title)}</a></li>`)
      .join("")}</ol></nav></body></html>`,
  );
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:7b1d1f0e-3c5a-4b7e-9a51-0d5f4c2e9a10"/></head><docTitle><text>The Lighthouse Keeper's Year</text></docTitle><navMap>${chapters
      .map((c, i) => `<navPoint id="${c.id}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="${c.file}"/></navPoint>`)
      .join("")}</navMap></ncx>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:7b1d1f0e-3c5a-4b7e-9a51-0d5f4c2e9a10</dc:identifier>
    <dc:title>The Lighthouse Keeper's Year</dc:title>
    <dc:creator>A. N. Original</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Fixture Press</dc:publisher>
    <meta property="dcterms:modified">2026-09-30T00:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    ${chapters.map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${chapters.map((c) => `<itemref idref="${c.id}"/>`).join("\n    ")}
  </spine>
</package>`,
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/epub+zip" });
}

// ---------------------------------------------------------------- PDF
function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/** Builds a PDF by hand: `pages` A5-ish pages of Times text, plus optional filler to reach `padToBytes`. */
function makePdf(pages, padToBytes = 0, seed = 7) {
  const random = rng(seed);
  const objects = [];
  const add = (body) => objects.push(body) && objects.length; // returns 1-based object number

  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];

  for (let p = 1; p <= pages; p++) {
    const lines = [];
    while (lines.length < 34) lines.push(...wrap(paragraph(random, 4), 62), "");
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    let stream = `BT /F2 15 Tf 54 590 Td (Field Notes, page ${p}) Tj ET\nBT /F1 11.5 Tf 54 560 Td 15.5 TL\n`;
    for (const line of lines.slice(0, 34)) stream += `(${esc(line)}) Tj T*\n`;
    stream += `ET\nBT /F1 9 Tf 205 36 Td (${p} / ${pages}) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 432 648] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`));
  }

  if (padToBytes > 0) {
    // An unreferenced stream object: valid PDF, incompressible-ish filler for large-upload tests.
    const size = Math.max(0, padToBytes - 200_000);
    const filler = Buffer.alloc(size);
    const fill = rng(seed + 92);
    for (let i = 0; i < size; i += 4096) filler.writeUInt32LE(Math.floor(fill() * 0xffffffff), Math.min(i, size - 4));
    objects.push({ raw: Buffer.concat([Buffer.from(`<< /Length ${size} >>\nstream\n`, "latin1"), filler, Buffer.from("\nendstream", "latin1")]) });
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages} >>`;
  const info = add(`<< /Title (Field Notes) /Author (A. N. Original) /Producer (fixture generator) >>`);

  const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [];
  let position = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const head = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const data = typeof body === "string" ? Buffer.from(body, "latin1") : body.raw;
    const tail = Buffer.from("\nendobj\n", "latin1");
    chunks.push(head, data, tail);
    position += head.length + data.length + tail.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------- main
const largeIndex = process.argv.indexOf("--large");
const largeMb = largeIndex === -1 ? 0 : Number(process.argv[largeIndex + 1] ?? 64);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "the-lighthouse.epub"), await makeEpub());
await writeFile(join(outDir, "field-notes.pdf"), makePdf(24));
// Files that must be rejected.
await writeFile(join(outDir, "not-a-book.pdf"), Buffer.from("MZ\x90\x00 this is not a pdf at all"));
await writeFile(join(outDir, "corrupt.epub"), Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.alloc(26), Buffer.from("mimetypeapplication/epub+zip", "latin1"), Buffer.alloc(400, 7)]));
if (largeMb > 0) {
  await writeFile(join(outDir, "large.pdf"), makePdf(12, largeMb * 1024 * 1024));
  // A second, different large file for the cancel test.
  await writeFile(join(outDir, "cancel-me.pdf"), makePdf(6, 24 * 1024 * 1024, 11));
}
console.log(`fixtures written to ${outDir}${largeMb ? ` (including a ${largeMb} MB large.pdf)` : ""}`);
