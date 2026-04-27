const PARSER_TXN = {
  id: 'qbo-transactions',
  label: 'QuickBooks — Transaction Detail by Account',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Transaction Detail by Account → Export to CSV',

  async parse(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);

    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Transaction date')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('Could not find header row in Transaction Detail CSV');

    const period = lines[2] ? lines[2].replace(/^"|"$/g,'').replace(/,+$/,'').trim() : '';
    // Headers: [blank, date, type, num, name, description, split, amount, balance]
    const dateIdx=1, typeIdx=2, nameIdx=4, splitIdx=6, amtIdx=7;

    const accounts = {};  // account name → { name, total, txCount, items[] }
    let currentAccount = '';
    const monthly = {}; // "YYYY-MM" → amount

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = splitCSVRow(lines[i]);
      if (!cols) continue;

      // Account header row
      if (cols[0] && cols[0].trim() && !cols[1]) {
        const name = cols[0].replace(/^"|"$/g,'').trim();
        if (!name.startsWith('Total for') && name) {
          currentAccount = name;
          if (!accounts[name]) accounts[name] = { name, total: 0, txCount: 0, items: [] };
        }
        continue;
      }
      if (cols[0] && cols[0].includes('Total for')) continue;

      const dateStr = cols[dateIdx] ? cols[dateIdx].replace(/^"|"$/g,'').trim() : '';
      const amt = parseAmount(cols[amtIdx]);
      if (!dateStr || amt == null || !currentAccount) continue;

      const txType = cols[typeIdx] ? cols[typeIdx].replace(/^"|"$/g,'').trim() : '';
      const name = cols[nameIdx] ? cols[nameIdx].replace(/^"|"$/g,'').trim() : '';
      const split = cols[splitIdx] ? cols[splitIdx].replace(/^"|"$/g,'').trim() : '';

      if (accounts[currentAccount]) {
        accounts[currentAccount].total += amt;
        accounts[currentAccount].txCount++;
        // Only keep recent items to avoid huge payload
        if (accounts[currentAccount].items.length < 500) {
          accounts[currentAccount].items.push({ date: dateStr, type: txType, name, split, amount: amt });
        }
      }

      // Monthly if it looks like a cash/bank account
      const acctLower = currentAccount.toLowerCase();
      if (acctLower.includes('chk') || acctLower.includes('checking') || acctLower.includes('bus')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const key = parts[2] + '-' + parts[0].padStart(2,'0');
          monthly[key] = (monthly[key] || 0) + amt;
        }
      }
    }

    // Account summary (exclude zero-balance)
    const accountSummary = Object.values(accounts)
      .map(a => ({ name: a.name, total: +a.total.toFixed(2), txCount: a.txCount }))
      .filter(a => a.txCount > 0)
      .sort((a,b) => Math.abs(b.total) - Math.abs(a.total));

    // Detailed accounts (top ones with items for viewer)
    const accountDetail = {};
    Object.entries(accounts)
      .filter(([,a]) => a.txCount > 0)
      .sort((a,b) => Math.abs(b[1].total) - Math.abs(a[1].total))
      .slice(0, 10)
      .forEach(([k, a]) => {
        accountDetail[k] = {
          total: +a.total.toFixed(2),
          items: a.items.slice(-100)  // last 100 transactions
        };
      });

    return {
      meta: { period, parsedAt: new Date().toISOString() },
      accountSummary,
      accountDetail,
      monthlyBankFlow: monthly
    };
  },

  renderPreview(data) {
    const d = data;
    const rows = (d.accountSummary||[]).slice(0,20).map(a =>
      `<tr><td>${a.name}</td><td style="color:${a.total>=0?'var(--green)':'var(--red)'}">${fmt(a.total)}</td><td class="muted">${a.txCount} tx</td></tr>`
    ).join('');

    return `
      <div class="preview-meta">${d.meta.period}</div>
      <table class="preview-table">
        <tr><th>Account</th><th>Net Balance</th><th>Transactions</th></tr>
        ${rows}
      </table>`;
  }
};
