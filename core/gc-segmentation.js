// Auto-generated from SFS_Outreach_Action_List.xlsx · 2026-04-29
// GC name → outreach group classification
// Source of truth for "Group A / B / C" segmentation in the dashboard.
//
// IMPORTANT — these are *descriptive groupings*, not action plans. The
// pricing-sensitivity analysis attached recommendations (e.g. "stop
// bidding here," "have a dinner with them") to each group; treat those
// recommendations with much less weight than the segmentation itself.
// The dashboard surfaces the groupings as context, NOT as auto-generated
// to-dos. See CONTEXT.md §2.5.
//
// Group A    = high win-rate relationships (computed live from Knowify byGC where wr ≥ 70 & bids ≥ 5)
// Group B    = active competitive (30-69% WR, 5+ bids)
// Group C-STOP-LIST = chain-locked GCs (zero-win pattern, descriptive only)
// Group C-PUB    = public sector zero-win (certification context)
// Group C-MIX    = mixed commercial zero-win
// CHAIN          = national chain brand (separate dimension — brand names, not GCs)
//
// PlanHub is INTENTIONALLY EXCLUDED from C-STOP-LIST. Won PlanHub bids
// get renamed to the real GC in Knowify after award — so the apparent
// 0% win rate is a Knowify reporting artifact, not a real signal. It's
// re-tagged 'DATA-ARTIFACT' below so reports can show it that way.

(function(){
const M = {};
M['20twentyconstruction']={raw:'20twenty construction',group:'B',count:11};
M['7bbuildingdevelopment7bcommercialconstruction']={raw:'7B Building & Development / 7B Commercial Construction',group:'C-MIX',count:7};
M['acmeenterprisesinc']={raw:'ACME Enterprises, Inc.',group:'C-STOP',count:6};
M['actionretailconstructionservices']={raw:'Action Retail Construction Services,',group:'C-MIX',count:5};
M['ambercrestconstructiongroup']={raw:'Ambercrest Construction Group',group:'C-MIX',count:9};
M['america9construction']={raw:'America 9 Construction',group:'C-STOP',count:10};
M['anchorconstructionandmanagementinc']={raw:'Anchor Construction and Management, Inc.',group:'C-MIX',count:27};
M['andresconstructionservices']={raw:'Andres Construction Services',group:'C-MIX',count:12};
M['anthonybryanconstruction']={raw:'Anthony Bryan Construction',group:'C-PUB',count:6};
M['aprgroupinc']={raw:'APR Group, Inc.',group:'C-PUB',count:11};
M['archerconstructionanddesign']={raw:'Archer Construction and Design',group:'C-MIX',count:5};
M['asherbuildersllc']={raw:'Asher Builders LLC',group:'C-MIX',count:11};
M['ashtoncommercialconstruction']={raw:'Ashton Commercial Construction',group:'C-MIX',count:20};
M['baileyconstruction']={raw:'Bailey Construction',group:'C-MIX',count:7};
M['bairdwilliamsconstruction']={raw:'Baird Williams Construction',group:'C-MIX',count:8};
M['bblbuildingcompany']={raw:'BBL Building Company',group:'B',count:19};
M['berryclayinc']={raw:'Berry & Clay Inc.',group:'C-PUB',count:7};
M['bigskyconstructioncoinc']={raw:'Big Sky Construction Co Inc',group:'C-PUB',count:46};
M['blackcanyonconstruction']={raw:'Black Canyon Construction',group:'C-MIX',count:17};
M['boldcommercialconstruction']={raw:'Bold Commercial Construction',group:'C-MIX',count:6};
M['bowaconstruction']={raw:'Bowa Construction',group:'C-MIX',count:12};
M['brothersgroupconstructioncompany']={raw:'Brothers Group Construction Company',group:'C-MIX',count:21};
M['buffaloconstructioninc']={raw:'Buffalo Construction, Inc.',group:'C-MIX',count:9};
M['cactuscommercial']={raw:'Cactus Commercial',group:'C-MIX',count:9};
M['caetconstruction']={raw:'CAET Construction',group:'CHAIN',count:59};
M['catamountconstructorsinc']={raw:'Catamount Constructors, Inc.',group:'C-MIX',count:16};
M['cbgbuildingcompany']={raw:'CBG Building Company',group:'C-MIX',count:9};
M['cdicontractorsllc']={raw:'CDI Contractors LLC',group:'C-PUB',count:8};
M['centralbuildersinc']={raw:'Central Builders, Inc',group:'C-MIX',count:10};
M['chcconstruction']={raw:'CHC Construction',group:'C-MIX',count:11};
M['cimageneralcontractorsinc']={raw:'CIMA General Contractors, Inc',group:'C-STOP',count:57};
M['citadeldevelopmentservices']={raw:'Citadel Development Services',group:'C-MIX',count:27};
M['citywide']={raw:'CityWide',group:'B',count:28};
M['coleconstructioninc']={raw:'Cole Construction Inc.',group:'C-PUB',count:12};
M['cooperconstruction']={raw:'Cooper Construction',group:'C-MIX',count:7};
M['cooperjensencontractors']={raw:'Cooper Jensen Contractors',group:'C-MIX',count:13};
M['corecmci']={raw:'Core CMCI',group:'C-STOP',count:11};
M['coreconstruction']={raw:'Core Construction',group:'B',count:76};
M['costco1173']={raw:'Costco #1173',group:'CHAIN',count:2};
M['criterioncontractors']={raw:'Criterion Contractors',group:'CHAIN',count:8};
M['csdevelopmentservicesllc']={raw:'C&S Development Services, LLC',group:'C-MIX',count:11};
M['culbertsoncontractorsllc']={raw:'Culbertson Contractors, LLC',group:'C-STOP',count:12};
M['d4constructionservicesllc']={raw:'D4 Construction Services, LLC',group:'C-STOP',count:8};
M['dallascommercialbuildersllc']={raw:'Dallas Commercial Builders, LLC',group:'C-MIX',count:11};
M['davidparmerconstruction']={raw:'David Parmer Construction',group:'B',count:6};
M['dbconstructors']={raw:'db Constructors',group:'B',count:13};
M['dfconstructors']={raw:'D&F Constructors',group:'C-MIX',count:5};
M['dfwpaving']={raw:'DFW Paving',group:'B',count:227};
M['dhunitedfuelingsolutions']={raw:'D&H United Fueling Solutions',group:'B',count:10};
M['dlmeacham']={raw:'DL Meacham',group:'C-PUB',count:11};
M['dooleymackconstructors']={raw:'Dooley Mack Constructors',group:'C-MIX',count:14};
M['draketappe']={raw:'Drake Tappe',group:'C-MIX',count:22};
M['dsacontractors']={raw:'DSA Contractors',group:'C-PUB',count:5};
M['ehrlichdesignbuildersinc']={raw:'Ehrlich Design Builders, Inc',group:'C-MIX',count:10};
M['embreeconstructiongroupinc']={raw:'Embree Construction Group, Inc.',group:'CHAIN',count:53};
M['emjcorporation']={raw:'EMJ Corporation',group:'CHAIN',count:44};
M['endeavorconstructionsolutions']={raw:'Endeavor Construction Solutions',group:'C-MIX',count:10};
M['estessinacoribuilders']={raw:'Estes + Sinacori Builders',group:'C-MIX',count:7};
M['falkenbergconstructioncompanyinc']={raw:'Falkenberg Construction Company Inc.',group:'C-MIX',count:22};
M['firebrandconstruction']={raw:'Firebrand Construction',group:'C-MIX',count:5};
M['forgeconstructors']={raw:'Forge Constructors',group:'C-MIX',count:7};
M['frontlineconstructionmanagementllc']={raw:'Frontline Construction Management, LLC',group:'B',count:9};
M['frybuildgroupinc']={raw:'Fry Build Group, Inc.',group:'C-MIX',count:6};
M['gadberryconstructioncompanyinc']={raw:'Gadberry Construction Company, Inc.',group:'C-MIX',count:15};
M['gallagherconstructionservices']={raw:'Gallagher Construction Services',group:'C-PUB',count:9};
M['gray']={raw:'Gray',group:'B',count:6};
M['grayconstruction']={raw:'Gray Construction',group:'CHAIN',count:6};
M['greenroadconstruction']={raw:'Greenroad Construction',group:'C-MIX',count:8};
M['hannadesigngroup']={raw:'Hanna Design Group',group:'C-STOP',count:18};
M['harendtconstructiongroupllc']={raw:'Harendt Construction Group, LLC',group:'C-MIX',count:6};
M['hcigeneralcontractors']={raw:'HCI General Contractors',group:'C-MIX',count:43};
M['helkerandcrawfordconstructors']={raw:'Helker And Crawford Constructors',group:'C-MIX',count:8};
M['highlandbuildersinc']={raw:'Highland Builders Inc',group:'C-MIX',count:19};
M['hillwilkinsongeneralcontractors']={raw:'Hill & Wilkinson General Contractors',group:'C-MIX',count:8};
M['hoarconstruction']={raw:'Hoar Construction',group:'C-MIX',count:5};
M['horizongeneralcontractors']={raw:'Horizon General Contractors',group:'C-MIX',count:12};
M['icconstructioncompany']={raw:'IC Construction Company',group:'B',count:12};
M['iciconstructioninc']={raw:'ICI CONSTRUCTION INC',group:'C-PUB',count:14};
M['imperialconstructioninc']={raw:'Imperial Construction, Inc.',group:'C-PUB',count:26};
M['innovativeconstructionsolutionsgroup']={raw:'Innovative Construction Solutions Group',group:'C-MIX',count:10};
M['innovativecsg']={raw:'Innovative CSG',group:'C-MIX',count:14};
M['jabesconstructorsinc']={raw:'Jabes Constructors Inc.',group:'C-MIX',count:15};
M['jascoconstructionllc']={raw:'Jasco Construction LLC',group:'C-MIX',count:9};
M['jbcollc']={raw:'J.B. & Co. LLC',group:'C-PUB',count:31};
M['jbsmanagementgroup']={raw:'JBS Management Group',group:'C-MIX',count:7};
M['jccommercialinc']={raw:'JC Commercial, Inc.',group:'C-PUB',count:9};
M['jerrykachelbuilderinc']={raw:'Jerry Kachel Builder, Inc.',group:'C-MIX',count:13};
M['jmconstructionsolutions']={raw:'JM Construction Solutions',group:'B',count:13};
M['joestaconstruction']={raw:'Joesta Construction',group:'C-PUB',count:8};
M['jonescogeneralcontractorsllc']={raw:'JonesCo General Contractors LLC.',group:'C-MIX',count:7};
// 'jpi' alias resolved to 'jpicompanies' via ALIASES below — single canonical row.
M['jpicompanies']={raw:'JPI Companies',group:'B',count:18};
M['kevinpsullivanbuildersinc']={raw:'Kevin P. Sullivan Builders Inc.',group:'C-STOP',count:6};
M['landmarkstructuralbuilders']={raw:'Landmark Structural Builders',group:'C-PUB',count:14};
M['leverconstruction']={raw:'Lever Construction',group:'C-PUB',count:12};
M['lgedesignbuild']={raw:'LGE Design Build',group:'B',count:11};
M['ljcompaniesllc']={raw:'LJ Companies LLC',group:'C-MIX',count:8};
M['macdougallpierceconstruction']={raw:'MacDougall Pierce Construction',group:'C-STOP',count:8};
M['marandbuildersinc']={raw:'Marand Builders, Inc.',group:'C-MIX',count:8};
M['marcocontractorsinc']={raw:'Marco Contractors, Inc.',group:'C-MIX',count:7};
M['martincgeneralcontractors']={raw:'Mart, Inc. General Contractors',group:'B',count:13};
M['maxxbuilders']={raw:'Maxx Builders',group:'C-MIX',count:11};
M['mcdonalds']={raw:'McDonalds',group:'CHAIN',count:3};
M['mcdonalds0421663redoaktxvsmacconstruction']={raw:'McDonald’s (042-1663) Red Oak TX vs. MAC Construction',group:'CHAIN',count:1};
M['mdgeneralcontracting']={raw:'M&D General Contracting',group:'C-MIX',count:7};
M['mecgeneralcontractor']={raw:'MEC General Contractor',group:'C-MIX',count:5};
M['menemshadevelopmentgroupinc']={raw:'Menemsha Development Group, Inc',group:'CHAIN',count:7};
M['messergrouptexasinc']={raw:'Messer Group Texas, Inc.',group:'C-MIX',count:9};
M['michaelwalkerconstruction']={raw:'Michael Walker Construction',group:'C-MIX',count:5};
M['millerhoaglandconstruction']={raw:'Miller-Hoagland Construction',group:'C-MIX',count:7};
M['millersierra']={raw:'Miller Sierra',group:'B',count:78};
M['mlgpllc']={raw:'MLGP, LLC',group:'B',count:15};
M['moderncontractors']={raw:'Modern Contractors',group:'C-MIX',count:15};
M['moralesconstructionservices']={raw:'Morales Construction Services',group:'C-PUB',count:35};
M['morrisonconstruction']={raw:'Morrison Construction',group:'C-STOP',count:50};
M['mowmanlawnservice']={raw:'Mowman Lawn Service',group:'CHAIN',count:6};
M['msfhospitalityllc']={raw:'MSF Hospitality LLC',group:'C-MIX',count:21};
M['mycongeneralcontractors']={raw:'Mycon General Contractors',group:'B',count:59};
M['nationalconveniencesolutions']={raw:'National Convenience Solutions',group:'CHAIN',count:3};
M['netleasedmanagement']={raw:'Net Leased Management',group:'CHAIN',count:2};
M['nniconstructionco']={raw:'NNI Construction Co.',group:'C-MIX',count:6};
M['nobleconstructionmanagement']={raw:'Noble Construction Management',group:'C-MIX',count:10};
M['northridgeconstructiongroup']={raw:'Northridge Construction Group',group:'B',count:25};
M['northrockconstruction']={raw:'North Rock Construction',group:'C-PUB',count:12};
M['northstarconstructionllc']={raw:'Northstar Construction, LLC',group:'C-PUB',count:11};
M['orionconstructiongroupinc']={raw:'Orion Construction Group Inc.',group:'C-MIX',count:8};
M['pavilionconstruction']={raw:'Pavilion Construction',group:'C-MIX',count:9};
M['perryconstruction']={raw:'Perry Construction',group:'C-STOP',count:16};
M['pgcbuilders']={raw:'PGC Builders',group:'C-STOP',count:8};
M['pinnacleconstructioninc']={raw:'Pinnacle Construction, Inc',group:'CHAIN',count:21};
M['planhub']={raw:'PlanHub',group:'DATA-ARTIFACT',count:177,note:'Won bids get renamed to real GC after award — apparent 0% WR is not a real signal.'};
M['pogueconstruction']={raw:'Pogue Construction',group:'C-PUB',count:11};
M['postlgroupconstruction']={raw:'Post L Group Construction',group:'C-PUB',count:13};
M['powerhouseretailservices']={raw:'Powerhouse Retail Services',group:'C-MIX',count:8};
M['prestonpierceconstruction']={raw:'Preston Pierce Construction',group:'CHAIN',count:17};
M['primconstruction']={raw:'Prim Construction',group:'C-MIX',count:13};
M['primeretailservicesinc']={raw:'Prime Retail Services, Inc.',group:'C-STOP',count:7};
M['professionalbuildersinc']={raw:'Professional Builders Inc.',group:'C-MIX',count:14};
M['ratliffhardscapeltd']={raw:'Ratliff Hardscape, Ltd',group:'C-MIX',count:26};
M['readyconstruction']={raw:'Ready Construction',group:'CHAIN',count:24};
M['readyconstructionservices']={raw:'Ready Construction Services',group:'C-MIX',count:15};
M['realconstructiongroup']={raw:'Real Construction Group',group:'C-MIX',count:25};
M['reconnconstruction']={raw:'Reconn Construction',group:'B',count:7};
M['reliantconstructiongroupllc']={raw:'Reliant Construction Group LLC',group:'C-MIX',count:6};
M['ridgemontcommercialconstruction']={raw:'Ridgemont Commercial Construction',group:'C-MIX',count:60};
M['rjmcontractorsinc']={raw:'RJM Contractors, Inc.',group:'C-PUB',count:17};
M['rltwfacilityservices']={raw:'RLTW Facility Services',group:'C-MIX',count:9};
M['robinsmorton']={raw:'Robins & Morton',group:'C-MIX',count:5};
M['rsiconstruction']={raw:'RSI Construction',group:'C-MIX',count:8};
M['rtdconstruction']={raw:'RTD Construction',group:'C-MIX',count:21};
M['ryconconstructioninc']={raw:'Rycon Construction Inc',group:'B',count:18};
M['rzrconstruction']={raw:'RZR Construction',group:'C-MIX',count:19};
M['satterfieldpontikesconstructioninc']={raw:'Satterfield & Pontikes Construction, Inc.',group:'C-PUB',count:14};
M['sbconstructiongroup']={raw:'S B Construction Group',group:'C-STOP',count:7};
M['schafferconstruction']={raw:'Schaffer Construction',group:'C-STOP',count:16};
M['sedalcoconstructionservices']={raw:'SEDALCO Construction Services',group:'B',count:19};
M['southwesternservices']={raw:'Southwestern Services',group:'C-MIX',count:6};
M['spinoffconstruction']={raw:'Spinoff Construction',group:'C-MIX',count:29};
M['srxgeneralcontractors']={raw:'Srx General Contractors',group:'C-MIX',count:9};
M['sscommercialbuildersllc']={raw:'SS Commercial Builders, LLC',group:'C-MIX',count:10};
M['stansellconstruction']={raw:'Stansell Construction',group:'CHAIN',count:56};
M['stansellpropertiesdevelopmentllc']={raw:'Stansell Properties & Development, LLC',group:'CHAIN',count:40};
M['storagedepotdfw']={raw:'Storage Depot DFW',group:'C-MIX',count:6};
M['stovallconstructioninc']={raw:'Stovall Construction, Inc.',group:'C-MIX',count:8};
M['sullivancontractingservices']={raw:'Sullivan Contracting Services',group:'B',count:26};
M['summitgeneralcontractors']={raw:'Summit General Contractors',group:'B',count:7};
M['summitgeneralcontractorsinc']={raw:'Summit General Contractors, Inc',group:'C-MIX',count:6};
M['summitpropertiesdevelopment']={raw:'Summit Properties & Development',group:'C-STOP',count:27};
M['superiorbuilders']={raw:'Superior Builders',group:'C-MIX',count:8};
M['swordconstruction']={raw:'Sword Construction',group:'C-MIX',count:36};
M['swxconstruction']={raw:'SWX Construction',group:'C-MIX',count:9};
M['tatcoconstruction']={raw:'Tatco Construction',group:'C-MIX',count:20};
M['tauruscommercialinc']={raw:'Taurus Commercial Inc.',group:'C-MIX',count:26};
M['tcmccommercial']={raw:'TCMC Commercial',group:'C-PUB',count:13};
M['techoneconstructioninc']={raw:'Tech One Construction, Inc.',group:'B',count:11};
M['texasalliancegroupinc']={raw:'Texas Alliance Group, Inc.',group:'C-STOP',count:17};
M['thefaingroupinc']={raw:'The Fain Group Inc',group:'C-MIX',count:9};
M['toddpetty']={raw:'Todd Petty',group:'CHAIN',count:1};
M['traconconstructionllc']={raw:'Tracon Construction LLC',group:'C-MIX',count:6};
M['triadretailconstructioninc']={raw:'Triad Retail Construction, Inc.',group:'C-STOP',count:55};
M['triarcconstructionllc']={raw:'TriArc Construction, LLC.',group:'C-MIX',count:19};
M['tritongc']={raw:'Triton GC',group:'C-MIX',count:24};
M['tritongeneralcontractors']={raw:'Triton General Contractors',group:'C-MIX',count:10};
M['uhcconstructionservicesnorthfield']={raw:'UHC Construction Services - Northfield',group:'C-STOP',count:16};
M['upriteconstruction']={raw:'Uprite Construction',group:'C-MIX',count:8};
M['usbuildersinc']={raw:'US Builders, Inc.',group:'C-MIX',count:12};
M['vantasselproctor']={raw:'VanTassel Proctor',group:'CHAIN',count:2};
M['vantasselproctorconstruction']={raw:'Van Tassel-Proctor Construction',group:'CHAIN',count:4};
M['vaughnconstruction']={raw:'Vaughn Construction',group:'C-MIX',count:10};
M['vitreousconstruction']={raw:'Vitreous Construction',group:'C-MIX',count:14};
M['vmcfacilitiesllc']={raw:'VMC Facilities, LLC',group:'C-MIX',count:9};
M['watermarkcommercialcontractorsllc']={raw:'Watermark Commercial Contractors, LLC',group:'C-MIX',count:6};
M['wayneperry']={raw:'Wayne Perry',group:'CHAIN',count:1};
M['westmorelandbuildersllc']={raw:'Westmoreland Builders, LLC.',group:'C-STOP',count:22};
M['wilcocommercial']={raw:'Wilco Commercial',group:'C-MIX',count:10};
M['wrlgeneralcontractorsllc']={raw:'WRL General Contractors, LLC.',group:'C-PUB',count:12};
M['wyattmanagement']={raw:'WYATT MANAGEMENT',group:'C-STOP',count:31};
M['zerncoinc']={raw:'Zernco Inc',group:'CHAIN',count:24};

const CHAINS = [
  {brand:'Starbucks',bids:22,wins:6,wr:'27.3%',pursuit:'PURSUE — Highest WR of any chain. No locked sub.',bestPath:'Deepen relationship with Preston Pierce Construction (4 wins). Also Menemsha Development and Net Leased Mgmt.',contactTarget:'Preston Pierce Construction (primary)',wonThrough:'Preston Pierce Construction, Menemsha Development Group, Net Leased Management'},
  {brand:'Casey\'s',bids:18,wins:4,wr:'22.2%',pursuit:'PURSUE — 22% WR through Zernco specifically.',bestPath:'Ask Zernco Inc about upcoming Casey\'s pipeline. They have 3 wins. National Convenience Solutions also delivered a win.',contactTarget:'Zernco Inc (primary)',wonThrough:'Zernco Inc, National Convenience Solutions'},
  {brand:'Costco',bids:17,wins:4,wr:'23.5%',pursuit:'PURSUE — 23.5% WR including $109K Forney job.',bestPath:'Gray is the key GC — $137K won CV. Ask about upcoming Costco projects in the Group B dinner.',contactTarget:'Gray (via Group B dinner)',wonThrough:'Gray, Wayne Perry'},
  {brand:'Walmart',bids:31,wins:3,wr:'9.7%',pursuit:'SELECTIVE — EMJ is the path (2 large wins).',bestPath:'Include in EMJ dinner conversation. Ask about upcoming Walmart projects.',contactTarget:'EMJ Corporation (via Group B)',wonThrough:'EMJ Corporation, Mycon General Contractors'},
  {brand:'McDonald\'s',bids:151,wins:14,wr:'9.3%',pursuit:'SELECTIVE — Stansell and CAET deliver wins. Morrison is 0-for-46.',bestPath:'Do NOT pursue through Morrison. Deepen Stansell Construction and CAET Construction relationships.',contactTarget:'Stansell Construction, CAET Construction',wonThrough:'Stansell Construction, Stansell Properties, CAET Construction'},
  {brand:'Chipotle',bids:37,wins:3,wr:'8.1%',pursuit:'SELECTIVE — Pinnacle and Preston Pierce are the GC paths.',bestPath:'WYATT and D4 are 0-wins on Chipotle. Pinnacle Construction and Preston Pierce have delivered wins.',contactTarget:'Pinnacle Construction, Preston Pierce',wonThrough:'Pinnacle Construction, Preston Pierce Construction'},
  {brand:'Bojangles',bids:12,wins:1,wr:'8.3%',pursuit:'SELECTIVE — 1 win through CAET. Morrison handles most — 0 wins.',bestPath:'Only pursue if CAET brings a Bojangles opportunity. Don\'t bid through Morrison.',contactTarget:'CAET Construction (if opportunity arises)',wonThrough:'CAET Construction'},
  {brand:'AutoZone',bids:182,wins:4,wr:'2.2%',pursuit:'LOW — 2.2% WR. Corporate preferred sub arrangement likely.',bestPath:'If pursuing: VanTassel Proctor and Summit General Contractors have each won AutoZone bids. Otherwise stop bidding.',contactTarget:'AutoZone corporate facilities (if pursuing)',wonThrough:'VanTassel Proctor, Summit General Contractors'},
  {brand:'Chick-fil-A',bids:41,wins:1,wr:'2.4%',pursuit:'LOW — Franchise-controlled. 1 win from 41 bids.',bestPath:'1 win through Embree Construction Group. No pattern. Not a priority.',contactTarget:'Embree Construction (if opportunity arises)',wonThrough:'Embree Construction Group'},
  {brand:'Murphy USA',bids:58,wins:1,wr:'1.7%',pursuit:'LOW — Sword handles most — 0 wins through Sword.',bestPath:'1 win through Ready Construction at $3.8K. Not worth dedicated pursuit.',contactTarget:'Low priority',wonThrough:'Ready Construction'},
  {brand:'CVS',bids:57,wins:0,wr:'0.0%',pursuit:'STOP — 0 wins. Summit Properties likely has locked preferred sub.',bestPath:'Stop bidding through GCs. If pursuing: CVS corporate facilities team directly.',contactTarget:'CVS corporate (only if pursuing brand directly)',wonThrough:'—'},
  {brand:'Brakes Plus',bids:54,wins:0,wr:'0.0%',pursuit:'STOP — 0 wins across all GCs.',bestPath:'Stop bidding. Franchisee GC model with locked sub agreements.',contactTarget:'N/A — stop bidding',wonThrough:'—'},
];

function _norm(s){ return (s||"").toString().toLowerCase().replace(/[^a-z0-9]+/g,""); }

// ─────────────────────────────────────────────────────────────────────────
// GC name aliases — same GC entered under multiple names in Knowify get
// merged into a single canonical record. Add new aliases here as Dylan
// flags them. Format: { aliasNormalizedName: canonicalDisplayName }.
// `canonicalGCName(rawName)` returns the canonical display name.
// `applyKnowifyRules()` in dash.js calls this before grouping by GC, so
// per-GC win rates and totals merge correctly.
// ─────────────────────────────────────────────────────────────────────────
const ALIASES = {
  // 'JPI' and 'JPI Companies' are the same GC.
  'jpi':           'JPI Companies',
  'jpicompanies':  'JPI Companies',
};

window.canonicalGCName = function(name){
  if (!name) return name;
  const n = _norm(name);
  return ALIASES[n] || name.toString().trim();
};

// Returns classification entry or null. For Group A we DON'T hardcode -
// it's derived dynamically from Knowify win rate (>= 70% & >= 5 bids).
window.classifyGC = function(name){
  // Always look up against the canonical name so aliases resolve.
  const canon = window.canonicalGCName(name);
  const n = _norm(canon);
  return M[n] || null;
};

window.GC_CLASSIFICATION = M;
window.NATIONAL_CHAINS    = CHAINS;
window.GC_ALIASES         = ALIASES;
})();