/* A small Excel (.xlsx) writer, no libraries: one sheet with a title row,
   a bold header that stays on screen when scrolling, real numbers (with
   thousands separators), real dates, sized columns and a bold total row.

   An .xlsx file is a ZIP of a few XML files; the ZIP here is "stored"
   (not compressed), which every Excel, LibreOffice and Google Sheets opens. */

type Cell = string | number | null | undefined;

const enc = new TextEncoder();

/* ---------- ZIP (stored) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // DOS date/time: 2026-01-01 00:00 (fixed; Excel doesn't care)
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true); cen.setUint32(24, f.data.length, true); cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/* ---------- sheet ---------- */

const xml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // characters XML 1.0 doesn't allow
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Excel stores dates as days since 1899-12-30. */
function excelDate(s: string): number | null {
  const m = ISO_DAY.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : t / 86_400_000 + 25569;
}

/* style ids (cellXfs order in styles.xml below) */
const S = { text: 0, title: 1, head: 2, money: 3, int: 4, date: 5, totalMoney: 6, totalText: 7, pct: 8, totalInt: 9, headNum: 10, totalPct: 11, num: 12, totalNum: 13 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="0.0"/><numFmt numFmtId="167" formatCode="#,##0.0#"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8A8984"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF8A8984"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" wrapText="1" vertical="center"/></xf>
<xf numFmtId="166" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** What kind of numbers a column holds, from its header and values. */
const MONEY = /ETB|sales|cost|amount|revenue|cash|vat|profit|price|value|expense|birr|telebirr|other|ticket|waste|labor|rent|supplies|food|utilities|pay|wage|salary|tax|pension/i;

function colKinds(columns: string[], rows: Cell[][]): ("int" | "num" | "money" | "pct" | "date" | "text")[] {
  return columns.map((h, c) => {
    const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== "");
    if (vals.length && vals.every((v) => typeof v === "string" && (ISO_DAY.test(v) || /^total$/i.test(v)))) return "date";
    const nums = vals.filter((v): v is number => typeof v === "number");
    if (!nums.length) return "text";
    if (/%/.test(h)) return "pct";
    if (MONEY.test(h)) return "money";
    return nums.every((n) => Number.isInteger(n)) ? "int" : "num";
  });
}

export interface Sheet { title: string; columns: string[]; rows: Cell[][]; sheetName?: string }

/** Build the .xlsx bytes. */
export function buildXlsx({ title, columns, rows, sheetName }: Sheet): Uint8Array {
  const kinds = colKinds(columns, rows);
  const width = columns.map((h, c) => {
    const longest = Math.max(h.length * 0.9, ...rows.map((r) => {
      const v = r[c];
      if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: kinds[c] === "money" ? 2 : 0 }).length + 1;
      return String(v ?? "").length;
    }));
    return Math.min(60, Math.max(8, Math.ceil(longest) + 2));
  });
  const cellXml = (v: Cell, r: number, c: number, total: boolean): string => {
    const ref = `${colName(c)}${r}`;
    if (v === null || v === undefined || v === "") return "";
    const k = kinds[c];
    if (typeof v === "number" && Number.isFinite(v)) {
      const s = k === "pct" ? (total ? S.totalPct : S.pct) : k === "int" ? (total ? S.totalInt : S.int)
        : k === "num" ? (total ? S.totalNum : S.num) : (total ? S.totalMoney : S.money);
      return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    }
    const str = String(v);
    const d = k === "date" ? excelDate(str) : null;
    if (d !== null) return `<c r="${ref}" s="${S.date}"><v>${d}</v></c>`;
    // a number that arrived as text (e.g. "1,234.50") becomes a real number
    if (k !== "text" && /^-?[\d,]+(\.\d+)?$/.test(str)) {
      const n = Number(str.replace(/,/g, ""));
      if (Number.isFinite(n)) return `<c r="${ref}" s="${total ? S.totalMoney : S.money}"><v>${n}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr" s="${total ? S.totalText : S.text}"><is><t xml:space="preserve">${xml(str)}</t></is></c>`;
  };
  const lines: string[] = [];
  lines.push(`<row r="1" ht="22" customHeight="1"><c r="A1" t="inlineStr" s="${S.title}"><is><t>${xml(title)}</t></is></c></row>`);
  lines.push(`<row r="2" ht="30" customHeight="1">${columns.map((h, c) =>
    `<c r="${colName(c)}2" t="inlineStr" s="${kinds[c] === "text" || kinds[c] === "date" ? S.head : S.headNum}"><is><t>${xml(h)}</t></is></c>`).join("")}</row>`);
  rows.forEach((row, i) => {
    const r = i + 3;
    const total = typeof row[0] === "string" && /^total/i.test(row[0]);
    lines.push(`<row r="${r}">${row.map((v, c) => cellXml(v, r, c, total)).join("")}</row>`);
  });
  const last = `${colName(Math.max(0, columns.length - 1))}${rows.length + 2}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${width.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${lines.join("")}</sheetData>
${rows.length ? `<autoFilter ref="A2:${last}"/>` : ""}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const name = xml((sheetName || title).replace(/[\[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Report");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title><dc:creator>SEER</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>
</cp:coreProperties>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>
${rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$2:$${colName(Math.max(0, columns.length - 1))}$${rows.length + 2}</definedName></definedNames>` : ""}
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheet,
  };
  return zip(Object.entries(files).map(([n, d]) => ({ name: n, data: enc.encode(d) })));
}

/** Build and download. */
export function downloadXlsx(filename: string, sheet: Sheet): void {
  const bytes = buildXlsx(sheet);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename.replace(/\.csv$/i, "") .replace(/\.xlsx$/i, "") + ".xlsx"; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
