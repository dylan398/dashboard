const fmt  = (v, d=0) => v == null ? '—' :
  (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});

const fmtK = v => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return sign + '$' + (abs/1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs/1e3).toFixed(0) + 'K';
  return sign + '$' + abs.toFixed(0);
};

const fmtPct = (v, total) => total ? (v/total*100).toFixed(1)+'%' : '—';

const fmtNum = (v, d=0) => v == null ? '—' :
  v.toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});

const parseAmount = str => {
  if (!str && str !== 0) return null;
  const s = String(str).replace(/[$,\s]/g,'').replace(/[()]/g, m => m==='(' ? '-' : '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

// Parse QBO-style CSV into array of {name, value, indent, isTotal, section} rows
function parseQBORows(csvText) {
  const lines = csvText.split(/\r?\n/);
  const rows = [];
  let meta = {};

  for (let i = 0; i < lines.length; i++) {
    // Parse meta from top 3 rows
    if (i === 0) { meta.reportType = lines[i].split(',')[0].trim(); continue; }
    if (i === 1) { meta.company = lines[i].split(',')[0].trim(); continue; }
    if (i === 2) { meta.period = lines[i].split(',')[0].replace(/^"|"$/g,'').trim(); continue; }
    if (i <= 4) continue; // skip blank + header row

    // Parse CSV row (simple: split on comma, handle quoted fields)
    const cols = splitCSVRow(lines[i]);
    if (!cols || cols.length < 2) continue;

    const name = cols[0].replace(/^"|"$/g,'').trim();
    const rawVal = cols[1] ? cols[1].replace(/^"|"$/g,'').trim() : '';
    if (!name) continue;

    const value = parseAmount(rawVal);
    const isTotal = name.startsWith('Total for ') || name.startsWith('Net ') ||
                    name === 'Gross Profit' || name === 'Net Operating Income' ||
                    name.startsWith('CASH AT') || name.startsWith('NET CASH') ||
                    name.startsWith('Cash at');
    const indent = (cols[0].match(/^(\s*)/) || ['',''])[1].length;

    rows.push({ name, value, rawVal, indent, isTotal });
  }
  return { meta, rows };
}

function splitCSVRow(line) {
  const result = [];
  let inQuotes = false, cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// Find first row whose name matches any of the given patterns (case-insensitive)
function findRow(rows, ...patterns) {
  const pats = patterns.map(p => p.toLowerCase());
  for (const r of rows) {
    const n = r.name.toLowerCase();
    if (pats.some(p => n === p || n.startsWith(p))) return r;
  }
  return null;
}

// Find all rows within a section (between startPattern and endPattern)
function findSection(rows, startPat, endPat) {
  let inside = false;
  const result = [];
  for (const r of rows) {
    const n = r.name.toLowerCase();
    if (!inside && n.includes(startPat.toLowerCase())) { inside = true; continue; }
    if (inside && endPat && n.includes(endPat.toLowerCase())) break;
    if (inside) result.push(r);
  }
  return result;
}
