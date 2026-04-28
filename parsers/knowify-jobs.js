const PARSER_KNOWIFY = {
  id: 'knowify-jobs',
  label: 'Knowify — Advanced Jobs Report',
  fileType: 'xlsx',
  accept: '.xlsx',
  hint: 'Export: Knowify → Jobs → Advanced Jobs Report → Export XLSX',
  storageStrategy: 'merge',  // latest summary always current, history archived by date
  // No expectedReportType — XLSX files don't have a header row to sniff.
  // Wrong-zone detection relies on validate() finding zero jobs.

  getPeriodKey(data) {
    return data.meta?.parsedAt?.slice(0,10) || new Date().toISOString().slice(0,10);
  },

  async parse(file) {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array', cellDates: true });
    const SHEETS = ['Active', 'Rejected', 'Bidding', 'Closed'];
    const HEADER_ROW = 4;
    const COL = {
      jobName:'Job name', client:'Client', createdDate:'Creation Date', state:'State',
      startDate:'Start Date', endDate:'End Date', salesLead:'Sales Lead', pm:'Project Manager',
      origContract:'Original Contract', changeOrders:'Change Orders', contractTotal:'Contract Total',
      invoiced:'Invoiced', profit:'Profit Amount', projProfit:'Projected Profitability', tags:'Tags'
    };

    const allJobs = [];
    const bySheet = {};
    SHEETS.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      if (!ws) return;
      const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, defval:'' });
      if (rawRows.length < HEADER_ROW + 2) return;
      const headers = rawRows[HEADER_ROW];
      const colIdx = {};
      headers.forEach((h,i) => { if (h) colIdx[h] = i; });
      const jobs = [];
      for (let r = HEADER_ROW + 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row[colIdx[COL.jobName]]) continue;
        const get = key => { const idx = colIdx[COL[key]]; return idx != null ? row[idx] : ''; };
        const getNum = key => {
          const v = get(key);
          if (!v && v !== 0) return null;
          const n = parseFloat(String(v).replace(/[$,%]/g,'').replace(/,/g,''));
          return isNaN(n) ? null : n;
        };
        jobs.push({
          status: sheetName, jobName: get('jobName'), client: get('client'),
          state: get('state') || 'TX', salesLead: get('salesLead'), pm: get('pm'),
          createdDate: get('createdDate'), startDate: get('startDate'), endDate: get('endDate'),
          origContract: getNum('origContract'), changeOrders: getNum('changeOrders'),
          contractTotal: getNum('contractTotal'), invoiced: getNum('invoiced'),
          profit: getNum('profit'), projProfit: getNum('projProfit'), tags: get('tags'),
        });
      }
      bySheet[sheetName] = jobs;
      allJobs.push(...jobs);
    });

    const wonJobs = [...(bySheet.Active||[]), ...(bySheet.Closed||[])];
    const totalWonCV = wonJobs.reduce((s,j)=>s+(j.contractTotal||0),0);
    const totalInvoiced = wonJobs.reduce((s,j)=>s+(j.invoiced||0),0);
    const decided = wonJobs.length + (bySheet.Rejected||[]).length;
    const winRate = decided > 0 ? +(wonJobs.length/decided*100).toFixed(1) : 0;

    const clientMap = {};
    wonJobs.forEach(j => {
      if (!j.client) return;
      if (!clientMap[j.client]) clientMap[j.client] = { name: j.client, total: 0, count: 0 };
      clientMap[j.client].total += j.contractTotal || 0;
      clientMap[j.client].count++;
    });
    const topClients = Object.values(clientMap).sort((a,b)=>b.total-a.total).slice(0,20)
      .map(c=>({...c, total:+c.total.toFixed(2)}));

    const pipelineTotal = (bySheet.Bidding||[]).reduce((s,j)=>s+(j.contractTotal||0),0);

    return {
      meta: { parsedAt: new Date().toISOString(), totalJobs: allJobs.length },
      summary: {
        activeJobs: (bySheet.Active||[]).length,
        closedJobs: (bySheet.Closed||[]).length,
        biddingJobs: (bySheet.Bidding||[]).length,
        rejectedJobs: (bySheet.Rejected||[]).length,
        totalWonCV: +totalWonCV.toFixed(2),
        totalInvoiced: +totalInvoiced.toFixed(2),
        avgContract: wonJobs.length ? +(totalWonCV/wonJobs.length).toFixed(2) : 0,
        winRate, pipelineTotal: +pipelineTotal.toFixed(2),
      },
      topClients,
      // No slicing — Pipeline analysis (Dylan's win-rate rules) needs every
      // bidding job. With ~1,500 bidding rows the JSON is ~1MB, well within
      // Firebase Realtime DB's per-write 16MB limit.
      jobs: {
        Active:   bySheet.Active   || [],
        Closed:   bySheet.Closed   || [],
        Bidding:  bySheet.Bidding  || [],
        Rejected: bySheet.Rejected || [],
      }
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    const total = data.meta?.totalJobs || 0;
    if (total === 0) {
      errors.push('No jobs found in any sheet — make sure all four tabs (Active, Rejected, Bidding, Closed) are present in the XLSX.');
    }
    const s = data.summary || {};
    if (total > 0 && s.activeJobs === 0 && s.closedJobs === 0) {
      warnings.push('No active or closed jobs — only bidding/rejected. Verify export covers all tabs.');
    }
    if (s.winRate != null && s.winRate < 5 && (s.rejectedJobs || 0) > 0) {
      warnings.push(`Win rate is ${s.winRate}% — unusually low; verify Active and Closed tabs are populated.`);
    }
    return { errors, warnings };
  },

  renderPreview(data) {
    const s = data.summary||{};
    const kpi = (label, val, cls='') =>
      `<div class="pkpi"><span class="pkpi-label">${label}</span><span class="pkpi-val ${cls}">${val}</span></div>`;
    const clientRows = (data.topClients||[]).slice(0,10).map((c,i) =>
      `<tr><td class="muted">${i+1}</td><td>${c.name}</td><td>${fmt(c.total)}</td><td class="muted">${c.count} jobs</td></tr>`
    ).join('');
    return `
      <div class="preview-meta">Exported ${data.meta?.parsedAt?.slice(0,10)} · Strategy: <strong>MERGE</strong> — summary updates, dated snapshot archived</div>
      <div class="preview-kpis">
        ${kpi('Active Jobs', s.activeJobs, 'green')}
        ${kpi('Pipeline', fmt(s.pipelineTotal), 'yellow')}
        ${kpi('Won CV', fmt(s.totalWonCV), 'green')}
        ${kpi('Avg Contract', fmt(s.avgContract))}
        ${kpi('Win Rate', s.winRate+'%', s.winRate>20?'green':'orange')}
        ${kpi('Invoiced', fmt(s.totalInvoiced))}
      </div>
      <div class="preview-sub-title">Top 10 Clients</div>
      <table class="preview-table">
        <tr><th>#</th><th>Client</th><th>Contract Value</th><th>Jobs</th></tr>
        ${clientRows}
      </table>`;
  }
};
