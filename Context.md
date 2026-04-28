SFS Dashboard — Context for Future Claude Chats

Read this file first. Every metric and threshold in this dashboard
sits on top of business and industry context that changes how the
numbers should be interpreted. A Claude chat that reasons about the
data without this context will get things confidently wrong — flagging
healthy patterns as alarms, and dismissing real problems as normal.


1. Who Semper Fi Striping LLC Is
The business in one paragraph. Pavement marking and striping subcontractor
serving the Dallas–Fort Worth metroplex out of Haslet, TX (with roots and a
shop in the Tolar/Stephenville area). Founded in 2014 by Tyler Petty (COO)
and James Thetford (CRO), both U.S. Marine Corps veterans (Sgt., MOS 0847,
14th Marine Regiment / Fort Worth) who started part-time in Stephenville and
went full-time after a couple years. Dylan Petty (CEO, Tyler's brother)
joined to run the company. SDVOSB-certified.
Service mix:

Parking-lot striping (initial layout, restripe)
Thermoplastic markings (longer-lasting, used on highways and high-traffic lots)
Hot-tape products
ADA blue blocks, fire lanes, load zones, stencils
Reflective markings, traffic paint
Sealcoating (smaller share, often bundled with striping)

Customer model: ~95% subcontractor work for general contractors
(GCs) on commercial pavement projects (new construction parking lots,
warehouses, retail, schools, distribution centers, etc.). Some direct work
for property managers and small commercial owners (the long tail of the
customer book). Almost no government / TxDOT direct work currently — that
remains an SDVOSB growth opportunity.
Geographic concentration: DFW metro core (Tarrant + Dallas counties),
expanding to Austin, San Antonio, Houston. A few one-off out-of-state jobs
appear (e.g., a New Orleans PaveX entry in 2026 OpEx) — those are
exceptions, not a strategy.
Reputation: 4.9-star rating across 74+ Birdeye reviews. A+ Better
Business Bureau. The brand is built on speed, professionalism, and the
veteran-owned story.
Headcount (inferable from P&L): based on Wages(COGS) + Salaries lines,
roughly 8-15 field crew members + small admin/sales team. Not a 50-person
shop.

2. Industry Reality That Overrides "Best Practices"
These are the rules Claude needs to follow when interpreting metrics for
this specific business.
2.1 "Past due" is meaningless in TX subcontracting
In Texas commercial subcontracting:

Invoice due date = invoice send date. SFS's accounting workflow
defaults to "Due on receipt" with the due date set the same day the
invoice goes out. This is for SFS's own ease, not contract reality.
Subs can't force collection. Even though the Texas Prompt Payment
Act technically requires GCs to pay within 7 days of receiving owner
payment (private projects) or 10 days (public), GCs routinely pay on
their own schedule. The interest remedy (1.5%/month) is rarely pursued
because pursuing it endangers the relationship.
Pay-if-paid clauses are enforceable in TX. A GC contract often
contains a clause saying SFS only gets paid if the GC gets paid. So
when an owner withholds payment from the GC, it propagates down to SFS
with no recourse. The only escape is a written 45-day objection
procedure under Texas Business & Commerce Code Chapter 56 — almost
never used because, again, relationship.
Therefore: the "daysPastDue" field in our open-invoice data is
really "days since invoice sent." It's a measure of how long
customers take to pay, not how late they are. Aging buckets are
informational, not alarms. Do not treat them as collections crises.

Industry DSO benchmarks (median, not aspirational):
SegmentTypical DSOConstruction overall60–90 daysEngineering & construction~100 daysHVAC / mechanical35–55 daysPlumbing30–50 daysElectrical40–60 daysPavement marking (SFS)~50–75 days normal, 90+ for slow GCs
A SFS DSO under 60 is excellent. 60–80 is normal. 80–100 means a
specific GC or two is dragging the average. Over 100 across the book
indicates a real issue. A single 164-day customer is not the dashboard
catching fire — it's a known slow GC.
2.2 The Knowify data is dirty
SFS doesn't use Knowify the way the software vendor designed it.
Specifically:

Stale bids stay open in "Bidding" status indefinitely. Awards
actually happen in 30–60 days. Anything still bidding after 120 days
is realistically a loss. The dashboard reclassifies these → loss.
Closed jobs with $0 invoiced are functional losses. Job opens,
gets won on paper, then never gets invoiced because the actual work
shifted, was cancelled, or fell through. Our reclassifier flips these → loss.
Sales Lead is used inconsistently. Three values are
"relationship-channel" (pre-sold work where outcome is determined by
trust/relationship, not price competitiveness):

James Thetford (CRO)
Tyler Petty (COO)
Jenna Napier (relationship manager)
(Dylan Petty rarely appears as a Sales Lead — confirm with him before
adding to the relationship-leads list. He's the CEO, not a salesperson.)
Bids led by these names are excluded from win-rate calculations
because their outcomes don't reflect price competitiveness.


The competitive set is everything else: Estimating Department,
blank Sales Lead, all Rejected jobs. Win-rate metrics are computed
only on this set.
Multi-GC dedup. A SFS bid for "Walmart Plano" might be submitted
through 3 different GCs simultaneously. Only one GC wins the prime.
The other 2 record as losses for SFS even though SFS wasn't outbid —
the GC just didn't win. Per-GC-bid is the right unit for measuring
"which GCs to pursue," but loss counts are inflated by multi-GC
duplication. Our dashboard annotates this; don't try to deduplicate
the underlying bids.

The single source of truth for these rules is applyKnowifyRules() in
core/dash.js. Don't re-implement them in report pages.
2.3 Margins for parking-lot striping are tighter than they look
Industry sources sometimes cite "90% gross margin" for striping, but those
numbers are misleading for SFS-style commercial work:

Reality at the SFS scale: gross margin 30–45% on commercial
parking-lot work, 20–30% on TxDOT-style highway thermoplastic, and
40–55% on small private restripe jobs. The 90% number applies only
to single-person owner-operator routes with no employee labor.
Top decile pavement-maintenance contractors post >20% net margins.
SFS's 2025 net margin (2.17%) is well below that — the 2025 P&L
already shows the cause: Salaries, Taxes, R&M ratios all jumped
materially as a share of revenue YoY.
Bid math: typical add for overhead + profit on a competitive
commercial bid is 30-40% on top of estimated cost. Less than that
margin means SFS is buying market share, not generating profit.

2.4 Strong seasonality — and Texas's mitigated version of it
Pavement marking requires:

Air + ground temperature ≥ 45°F (some paints want 50°F)
Humidity < 50%
No precipitation forecast for several hours

In DFW:

Peak season: April–November. The bulk of revenue books in
June–October.
Shoulder: March + late November/early December. Workable days
exist but unpredictable.
Slow: December, January, February. Some thermoplastic work is
still possible (it tolerates colder cure temps), but most lots wait.
Off-season billings often spike anyway because GCs catch up paying
for the previous fall's work.

For dashboard interpretation: Q1 revenue should be expected to be
the smallest quarter, Q3 the biggest. A "down" January isn't a problem;
a down July would be.
2.5 SDVOSB / Veteran-Owned Business reality
SFS holds SDVOSB certification. This means:

Federal goal: the federal government targets 5% of all contracting
dollars to SDVOSBs (recently raised from 3%). VA targets 7%.
Sole-source authority: federal contracting officers can award
contracts up to certain thresholds to a single SDVOSB without
competition.
In practice for SFS: the certification has not been heavily
monetized yet. Federal pavement work is a real but underexploited
channel. The DBE (Disadvantaged Business Enterprise) angle on TxDOT
primes is more immediate — primes need DBE/SDVOSB sub participation
to win projects.


3. Competitor Landscape (DFW Pavement Marking)
The local market SFS competes in. Win-rate context: when SFS loses a
bid, it's typically to one of these names.
CompanyNotesGeneral Striping, LLCMajor DFW player. Broad services (markings + decorative coatings + concrete polish + signage). Larger, established.Advanced Texas StripingSanger, TX. Serves DFW + south OK. Pavement-maintenance generalist.Supreme Striping LLCDFW-focused. ADA + fire lane specialist. Direct competitor on commercial restripe.Proper Striping LLCPlano/Frisco/McKinney/Rockwall focus. Suburban commercial. Direct competitor.DFW Striping & Sealcoating(formerly Stripe-A-Lane). Sealcoating + striping bundled. Competes on price.Tiger StripesArlington base. Pressure washing + striping. Often mid-market.Linear Traffic MarkingsFounded 2017. Highway-grade markings. Competes on TxDOT-style work.Traffic Highway Maintenance (THM)Dallas, founded 2003. Highway maintenance + pavement marking. Competes on larger TxDOT subbing.Stripe Doctor / Yellowstone Concrete Striping / othersSmaller mom-and-pop competitors at the bottom of the market.
SFS's positioning: mid-market commercial subcontractor with
above-average reputation (4.9⭐), veteran-owned story, and aggressive
growth trajectory ($267K → $2.84M revenue 2020–2025 = 60% CAGR).
Differentiates on speed and quality, not lowest price.

4. Financial Benchmark Context
When evaluating SFS metrics, here are the apples-to-apples industry
norms for a sub-$50M-revenue commercial construction subcontractor:
4.1 P&L ratios
MetricSFS healthy bandIndustry typicalGross margin35–50%30–60% (varies wildly)Net margin5–15% target5–10% subcontractors median; >20% top decileOperating margin8–18%6–12% typicalRevenue per crew member (annualized)$200–350K$150–250K typicalOpEx % of revenue20–35%varies
Interpretation rules:

2.17% net margin in 2025 is NOT healthy despite the revenue
growth. The "growing pains" framing is real but if it persists into
2026 it's a margin discipline problem, not a scaling problem.
2022's -10.4% net loss during early growth phase is forgivable as
ramp investment; not a structural concern.

4.2 Balance sheet ratios
RatioHealthy benchmarkCrisis thresholdCurrent ratio1.5–2.0<1.0Quick ratio (~current here)1.4+<1.0Debt-to-equity<2.0>3.0 or negative equityWorking capital (positive)alwaysnegative is alarmWorking capital turnover6–10x>15 = needs more WC; <4 = overcapitalized
Construction industry average current ratio: 1.5; for sub-$50M firms,
1.8. For sub-$50M contractors, average working capital turnover is 6.8x.
4.3 Cash flow / collections
MetricHealthy band for SFSConstruction avgDSO50–80 days60–90 daysDPO30–45 days30–60 daysCash conversion cycle (DSO − DPO)20–50 days30–60 daysOCF / NI70–120%60–100% in growth phases
When dashboard says "DSO is 63.8d" that's right in the middle of
healthy for this industry. Don't show it as a yellow/orange "warning."
4.4 SBA loan readiness
SBA 7(a) loan requirements for construction subcontractors:
CriterionSBA thresholdLender preferenceDSCR (EBITDA / debt service)≥1.15x≥1.25xPersonal credit score≥680≥700+Collateral coverage75%+ for ≥$25K100%Time in business2+ years3+ yearsOwner equity injection10% (acquisition), variablevariesUse of funds clarityrequiredrequired
SFS likely qualifies — DSCR 2.33x (current calc), 11+ years in business,
clean BBB record, growing revenue. The narrative will need to address
the 2.17% 2025 net margin and rising cost ratios.

5. Pricing & Cost Reality (for sanity-checking parser output)
To recognize obviously-wrong data:

Striping per linear foot: $0.20–$0.75 typical, TX runs $0.30–0.50
Removal of old lines: adds $0.50–1.00/linear foot
Standard 75-space retail lot restripe: $400–700 labor + $180–250 materials = ~$700-1,000 invoice
A $66K invoice (EMJ Corporation 2026): that's a large new-construction lot or thermoplastic highway work, not a typical restripe
Field tech wages: $18–25/hour in DFW (matches SFS 2025 wage breakdown)

If a parsed P&L line shows revenue $260K with COGS $9.7K (the 2020
figures), interpret as: small operation, owner+1 worker, mostly painting
labor. That fits Tyler+James doing it themselves with a contractor or
two.

6. Knowify Data Quality Caveats (recap and detail)
The Knowify export from SFS is messy. Specific issues to expect:

"State" is often blank — defaulted to TX in our parser when missing
Dates can be either real Date objects or M/D/YYYY strings depending
on Knowify settings; the parser handles both
Sales Lead is sometimes assigned wrong — e.g., when the Estimating
Department prepared a bid that Tyler ultimately closed, it might be
recorded under Tyler. We can't perfectly correct this.
Profit / Projected Profitability fields are unreliable — Dylan has
noted these need a Knowify rework before being trusted. Don't surface
them as authoritative metrics.
"Active" jobs with old start dates are sometimes complete but
not yet moved to Closed status. We don't (yet) flag these.


7. Data Quirks and Quality Notes
These are the "this is not a bug, this is the data" things to know:

CF 2024 originally only ran Jan 1 - Dec 1, 2024. The Dec 1
end-cash didn't match Jan 1 2025 begin-cash by ~$7,724 until it was
re-uploaded. Same risk applies to any other year if the date range
in the QBO export is wrong.
Apr 21, 2026 BS snapshot showed negative equity (-$36,818). The
week of Apr 21 saw a new BB-SBA Loan ($99,032) appear on credit cards;
equity recovered to +$98,049 by Apr 28. This is real, just a brief
timing artifact during a financing event.
Sales by Customer Detail revenue ≠ P&L Revenue. The sales report
captures only customer-tagged invoiced revenue. P&L revenue includes
uncategorized income, deposits, returns. Expect 5-25% gap depending
on the year.
Customer names with special characters get sanitized when written
to Firebase ($, /, ., #, [, ] become _). The display
names will look slightly different from QBO source.
Transaction Detail upload may be YTD only, not full history. If
the dashboard shows ~135 accounts, that's probably Jan 1, 2026 – Apr
forward, not all-time. To get full history, re-export from QBO with
"All Dates" range.
Data starts Jan 1, 2020. No Balance Sheet Jan 1, 2020 will ever
exist (QuickBooks account didn't exist that day).


8. The Dashboard's Architectural Rules
To avoid drift across future Claude chats:

One source of truth per concept. Knowify rules in
applyKnowifyRules(). Customer concentration in customerConcentration().
Days to pay in daysToPayStats(). Don't re-implement.
Days-to-pay framing, not past-due framing. Aging UI is
informational time bands. Color coding can use orange for >120 days
(informational), but copy should say "days out" not "days past due."
Reserve red for situations that actually represent crisis (e.g.,
negative working capital, DSCR <1.0, cash-on-hand vs liabilities
mismatch).
Industry-aware thresholds. dash.js should encode the bands in
§4 above, not arbitrary "60% top-5 = warning" guesses.
Per-page detail, shared metrics. Reports only render. Compute in
dash.js. If a metric is needed in two reports, it lives in
dash.js.
Storage strategies are immutable. Don't change a dataset's
strategy without a migration plan — it would orphan historical data.


9. Quick Reference for Future Edits
When a future Claude chat is asked to "improve the dashboard," check:

Is this a real improvement or a misinterpretation of an alarm?
Re-read §2 first.
Does the new metric have an industry benchmark? Cite it from §4.
Is the new derived metric pure? Take normalized D, return number
or null, never NaN. (See dash.js ADD-METRIC rules.)
Have you read core/dash.js's top-of-file context block? It is
the canonical short-form context. THIS file is the long-form.

When asked to "interpret the dashboard for me":

Use industry medians (§4) as the comparison, not generic benchmarks.
Distinguish YTD-current-year from full-prior-year before quoting
growth rates. The dashboard handles this in _latestAnnualPL().
Flag the data-quality caveats (§7) when they affect the conclusion.

When asked to "add a new report":

Start by checking dash.js to see if the underlying metric exists.
If yes, the new report is purely presentational. If no, add the
metric to dash.js first with a JSDoc-style header explaining
business meaning + threshold.
Add the page to core/nav.js NAV_PAGES array.
Match the existing report styles (CSS variables, Barlow Condensed
for headings, JetBrains Mono for numbers).


10. What's Still Missing / Future Data Adds
Things that would make this dashboard much sharper but require more data:

Job-level profitability — Knowify has the fields but Dylan has
flagged the data quality isn't there yet. Future state: per-project
P&L with material/labor breakdown.
Time-from-bid-to-revenue — Knowify tracks created date and
invoiced amount, but we don't store the date of first invoice. Adding
it would let us measure pipeline-to-cash velocity.
Crew utilization — SFS has a separate crew scheduler app at
Firebase path /sched. Pulling utilization rates would tie revenue
to capacity and surface "we said yes to too much work" warnings.
Customer payment-pattern history — currently we only have a
snapshot of open invoices. Building a history of "this GC paid their
last 12 invoices in an average of 73 days" would feed pricing decisions.
Project-level GP / margin tracking — once Knowify's profit fields
are reliable.
Backlog / scheduled-revenue forward calendar — what's on the
schedule in the next 30/60/90 days, by GC.


Sources used in compiling this document

Semper Fi Striping company website + About page
BBB / Birdeye / ZoomInfo public profiles for Tyler Petty, James Thetford
Texas Prompt Payment Act analyses (Levelset, Haley & Olson, Porter Hedges)
Texas Construction Law Blog on pay-if-paid clauses and Chapter 56
For Construction Pros 2025 Top 50 Striping / Pavement Maintenance Contractors
Paving Marketers 2025 Industry Market Report
TxDOT Contractor Prequalification documentation
SBA SDVOSB Program guidance and FAR 6.206 / 19.14
Construction industry DSO benchmarks (CCFG Credit, CreditPulse, Vergo)
CFMA 2022 Construction Financial Benchmarker
Construction subcontractor financial-ratio benchmarks (Billd, Foundation Software, RSM US, FoundationSoft)
Knowify product documentation
Public Texas pavement marking cost guides


This document is the SFS dashboard's shared mental model. Update it
whenever you learn something material about the business or industry
that future chats should know. Bias toward over-documentation —
context that isn't here gets reinvented (badly) every time a fresh
chat opens the repo.
