import { unzipSync, strFromU8 } from 'fflate';

export function excelDate(value: number, date1904 = false): string {
  if (!Number.isFinite(value)) throw new Error('Invalid Excel date value.');
  if (!date1904 && Math.floor(value) === 60) return '1900-02-29 (Excel leap-year placeholder)';
  const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
  const corrected = !date1904 && value < 60 ? value + 1 : value;
  const date = new Date(epoch + Math.round(corrected * 86400000));
  if (!Number.isFinite(date.getTime())) throw new Error('Excel date is outside the supported range.');
  const iso = date.toISOString();
  return Number.isInteger(value) ? iso.slice(0,10) : iso.slice(0,19).replace('T',' ');
}

/** Read cell values only. Macros, links and formulas are never executed. */
export function extractWorkbook(bytes: Uint8Array): string {
  let total = 0;
  const files = unzipSync(bytes, { filter(entry) {
    if (!/^xl\/(workbook\.xml|styles\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet[^/]*\.xml)$/.test(entry.name)) return false;
    total += entry.originalSize;
    if (total > 4 * 1024 * 1024) throw new Error('Workbook is too large to extract. Export the needed sheets as CSV.');
    return true;
  }});
  const xml = (path: string) => {
    if (!files[path]) throw new Error(`Workbook is missing ${path}.`);
    const doc = new DOMParser().parseFromString(strFromU8(files[path]), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('This workbook contains damaged XML.');
    return doc;
  };
  const texts = (el: Element) => [...el.getElementsByTagNameNS('*', 't')].map((n) => n.textContent ?? '').join('');
  const strings = files['xl/sharedStrings.xml']
    ? [...xml('xl/sharedStrings.xml').getElementsByTagNameNS('*', 'si')].map(texts) : [];
  const rels = new Map([...xml('xl/_rels/workbook.xml.rels').getElementsByTagNameNS('*', 'Relationship')]
    .filter((r) => r.getAttribute('TargetMode') !== 'External')
    .map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']));
  const workbook = xml('xl/workbook.xml');
  const date1904 = ['1','true'].includes(workbook.getElementsByTagNameNS('*','workbookPr')[0]?.getAttribute('date1904') ?? '');
  const styles = files['xl/styles.xml'] ? xml('xl/styles.xml') : null;
  const formats = new Map([...(styles?.getElementsByTagNameNS('*','numFmt') ?? [])].map((el) => [Number(el.getAttribute('numFmtId')), el.getAttribute('formatCode') ?? '']));
  const dateStyles = [...(styles?.getElementsByTagNameNS('*','cellXfs')[0]?.children ?? [])].map((el) => {
    const id = Number(el.getAttribute('numFmtId'));
    const format = (formats.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    return (id >= 14 && id <= 17) || id === 22 || /[yd]/i.test(format);
  });
  const sheets = [...workbook.getElementsByTagNameNS('*', 'sheet')];
  if (!sheets.length || sheets.length > 25) throw new Error('Choose a workbook with 1–25 sheets.');
  return sheets.map((sheet) => {
    const id = sheet.getAttribute('r:id') ?? sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = rels.get(id) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path)) throw new Error('Unsupported worksheet location.');
    const rows = [...xml(path).getElementsByTagNameNS('*', 'row')].map((row) => {
      const cells = [...row.getElementsByTagNameNS('*', 'c')].map((cell) => {
        const type = cell.getAttribute('t');
        const raw = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent;
        let value = type === 's' ? strings[Number(raw)] : type === 'inlineStr' ? texts(cell) : raw;
        if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        if ((!type || type === 'n') && raw && dateStyles[Number(cell.getAttribute('s'))])
          value = excelDate(Number(raw), date1904);
        if (cell.getElementsByTagNameNS('*', 'f').length && raw == null)
          value = '[Formula has no saved value: recalculate and save in Excel]';
        return value == null || value === '' ? '' : `${cell.getAttribute('r')}: ${value}`;
      }).filter(Boolean);
      return cells.join(' | ');
    }).filter(Boolean);
    return `[Sheet: ${sheet.getAttribute('name')}]\n${rows.join('\n')}`;
  }).join('\n\n');
}
