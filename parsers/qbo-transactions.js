// ─────────────────────────────────────────────────────────────────────────
// PARSER — Transaction Detail by Account
//
// Captures: account totals + per-account transaction items (date, type,
// name/customer, amount). Merge strategy — every upload extends history.
//
// IMPORTANT — AR transactions are kept UNCAPPED.
// The Accounts Receivable account is the source of truth for the
// auto-computed DSO / collections forecast (see computeDSOFromTransactions
// in core/dash.js). We need every Invoice and every Payment row tied to
// AR, with customer name and date, so FIFO matching can pair them up. A
// 500-row cap on AR would silently truncate older invoices and skew DSO.
// Other accounts still cap at 500 to keep Firebase payload small.
//
// Detection of "the AR account": names containing "accounts receivable",
// "a/r", or "ar" (whole word) match. Adjust isAccountsReceivable() below
// if Dylan renames the AR account in QBO.
// ─────────────────────────────────────────────────────────────────────────
 
function isAccountsReceivable(accountName) {
  if (!accountName) return false;
  const n = accountName.toLowerCase();
  return /accounts\s*receivable/.test(n) || /\ba\/?r\b/.test(n);
}
 
const PARSER_TXN = {
  id: 'qbo-transactions',
  label: 'QuickBooks — Transaction Detail by Account',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Transaction Detail by Account → Export to CSV',
  storageStrategy: 'merge',
  expectedReportType: /transaction\s*detail/i,
 
  getPeriodKey(data) {
    return data.meta?.period || 'all-dates';
  },
 
  async parse(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Transaction date')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('Could not find header row in Transaction Detail CSV');
    const reportType = lines[0] ? lines[0].split(',')[0].replace(/^"|"$/g,'').trim() : '';
    const period     = lines[2] ? lines[2].replace(/^"|"$/g,'').replace(/,+$/,'').trim() : '';
 
    const dateIdx=1, typeIdx=2, nameIdx=4, splitIdx=6, amtIdx=7;
    const accounts = {};
    let currentAccount = '';
 
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = splitCSVRow(lines[i]);
      if (!cols) continue;
      if (cols[0] && cols[0].trim() && !cols[1]) {
        const name = cols[0].replace(/^"|"$/g,'').trim();
        if (!name.startsWith('Total for') && name) {
          currentAccount = name;
          if (!accounts[name]) accounts[name] = { name, total: 0, txCount: 0, items: [], isAR: isAccountsReceivable(name) };
        }
        continue;
      }
      if (cols[0] && cols[0].includes('Total for')) continue;
      const dateStr = cols[dateIdx] ? cols[dateIdx].replace(/^"|"$/g,'').trim() : '';
      const amt = parseAmount(cols[amtIdx]);
      if (!dateStr || amt == null || !currentAccount) continue;
      const txType = cols[typeIdx] ? cols[typeIdx].replace(/^"|"$/g,'').trim() : '';
      const name = cols[nameIdx] ? cols[nameIdx].replace(/^"|"$/g,'').trim() : '';
      const acct = accounts[currentAccount];
      if (acct) {
        acct.total += amt;
        acct.txCount++;
        // AR is uncapped — needed for DSO computation. Other accounts cap at 500.
        if (acct.isAR || acct.items.length < 500) {
          acct.items.push({ date: dateStr, type: txType, name, amount: amt });
        }
      }
    }
 
    const accountSummary = Object.values(accounts)
      .map(a => ({ name: a.name, total: +a.total.toFixed(2), txCount: a.txCount, isAR: a.isAR }))
      .filter(a => a.txCount > 0)
      .sort((a,b) => Math.abs(b.total) - Math.abs(a.total));
 
    // Detail: top 10 accounts by absolute balance, last 100 items each.
    // EXCEPTION: AR account keeps full item history (regardless of size)
    // because computeDSOFromTransactions needs every Invoice + Payment.
    const accountDetail = {};
    Object.entries(accounts).filter(([,a])=>a.txCount>0)
      .sort((a,b)=>Math.abs(b[1].total)-Math.abs(a[1].total)).slice(0,10)
      .forEach(([k,a]) => {
        accountDetail[k] = { total: +a.total.toFixed(2), items: a.items.slice(-100), isAR: a.isAR };
      });
    // Always include AR detail in full, even if not in top-10 by balance.
    Object.entries(accounts)
      .filter(([,a]) => a.isAR && a.txCount > 0)
      .forEach(([k,a]) => {
        accountDetail[k] = { total: +a.total.toFixed(2), items: a.items, isAR: true };
      });
 
    return {
      meta: { reportType, period, parsedAt: new Date().toISOString() },
      accountSummary, accountDetail
    };
  },
 
  validate(data) {
    const errors = [], warnings = [];
    if (!data.accountSummary || data.accountSummary.length === 0) {
      errors.push('No account rows parsed — file may not be a Transaction Detail export.');
    }
    if (data.accountSummary && data.accountSummary.length < 3) {
      warnings.push(`Only ${data.accountSummary.length} account(s) found — verify the export wasn't filtered.`);
    }
    return { errors, warnings };
  },
 
  renderPreview(data) {
    const d = data;
    const rows = (d.accountSummary||[]).slice(0,20).map(a =>
      `<tr><td>${a.name}</td><td style="color:${a.total>=0?'var(--green)':'var(--red)'}">${fmt(a.total)}</td><td class="muted">${a.txCount} tx</td></tr>`
    ).join('');
    return `
      <div class="preview-meta">${d.meta.period} · Strategy: <strong>MERGE</strong> — account data merged with existing</div>
      <table class="preview-table">
        <tr><th>Account</th><th>Net Balance</th><th>Transactions</th></tr>
        ${rows}
      </table>`;
  }
};
