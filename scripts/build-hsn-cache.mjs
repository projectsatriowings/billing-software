import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function extractHsnData() {
  const pdfPath = path.join(rootDir, 'server/src/HSN_SAC.pdf');
  const outDir = path.join(rootDir, 'server/src/data');
  const outPath = path.join(outDir, 'hsn_data.json');

  if (!fs.existsSync(pdfPath)) {
    console.error('PDF not found at:', pdfPath);
    process.exit(1);
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('Reading HSN_SAC.pdf...');
  const buf = fs.readFileSync(pdfPath);
  console.log('Parsing PDF text with pdf-parse...');
  const t0 = Date.now();
  const parser = new PDFParse({ data: buf });
  const res = await parser.getText();
  console.log(`Extracted in ${(Date.now() - t0) / 1000}s, text length: ${res.text.length}`);

  const lines = res.text.split('\n');
  const codeMap = new Map();
  const regex = /^([0-9]{2,8})\s+(.*)$/;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('HSN_CD') || line.includes(' of 6594')) continue;
    const match = line.match(regex);
    if (match) {
      const code = match[1];
      const desc = match[2].trim().replace(/\s+/g, ' ');
      // Keep most descriptive text if duplicate
      if (!codeMap.has(code) || codeMap.get(code).length < desc.length) {
        codeMap.set(code, desc);
      }
    }
  }

  // Include standard Indian GST Services (SAC - Chapter 99)
  const standardSacList = [
    { code: '9954', desc: 'CONSTRUCTION SERVICES' },
    { code: '995411', desc: 'CONSTRUCTION SERVICES OF SINGLE DWELLING OR MULTI DWELLING RESIDENTIAL BUILDINGS' },
    { code: '995421', desc: 'GENERAL CONSTRUCTION SERVICES OF HIGHWAYS, STREETS, ROADS, BRIDGES' },
    { code: '9961', desc: 'SERVICES IN WHOLESALE TRADE' },
    { code: '9962', desc: 'SERVICES IN RETAIL TRADE' },
    { code: '9963', desc: 'ACCOMMODATION, FOOD AND BEVERAGE SERVICES' },
    { code: '996311', desc: 'ROOM OR UNIT ACCOMMODATION SERVICES FOR VISITORS' },
    { code: '996331', desc: 'RESTAURANT AND MOBILE FOOD SERVICE (DINE IN / TAKE AWAY)' },
    { code: '996337', desc: 'OUTDOOR CATERING SERVICES' },
    { code: '9964', desc: 'PASSENGER TRANSPORT SERVICES' },
    { code: '9965', desc: 'GOODS TRANSPORT SERVICES (GTA / FREIGHT)' },
    { code: '996511', desc: 'ROAD TRANSPORT SERVICES OF GOODS INCLUDING BY TRUCK, CONTAINER' },
    { code: '9967', desc: 'SUPPORTING SERVICES IN TRANSPORT, CARGO HANDLING, STORAGE AND WAREHOUSING' },
    { code: '996711', desc: 'CONTAINER HANDLING SERVICES' },
    { code: '996721', desc: 'STORAGE AND WAREHOUSING SERVICES OF REFRIGERATED GOODS' },
    { code: '996729', desc: 'OTHER STORAGE AND WAREHOUSING SERVICES (GRAIN, MERCHANDISE)' },
    { code: '9971', desc: 'FINANCIAL AND RELATED SERVICES, BANKING, LOANS, INSURANCE' },
    { code: '9972', desc: 'REAL ESTATE SERVICES (RENTING OF COMMERCIAL / RESIDENTIAL PROPERTY)' },
    { code: '9973', desc: 'LEASING OR RENTAL SERVICES WITHOUT OPERATOR' },
    { code: '9981', desc: 'RESEARCH AND DEVELOPMENT SERVICES' },
    { code: '9982', desc: 'LEGAL AND ACCOUNTING SERVICES' },
    { code: '998211', desc: 'LEGAL ADVISORY AND REPRESENTATION SERVICES' },
    { code: '998222', desc: 'ACCOUNTING, AUDITING AND BOOKKEEPING SERVICES' },
    { code: '9983', desc: 'OTHER PROFESSIONAL, TECHNICAL AND BUSINESS SERVICES (IT, CONSULTING)' },
    { code: '998311', desc: 'INFORMATION TECHNOLOGY CONSULTING AND SUPPORT SERVICES' },
    { code: '998313', desc: 'INFORMATION TECHNOLOGY (IT) DESIGN AND DEVELOPMENT SERVICES' },
    { code: '998314', desc: 'INTERNET TELECOMMUNICATION / HOSTING AND IT INFRASTRUCTURE PROVISION' },
    { code: '9984', desc: 'TELECOMMUNICATIONS, BROADCASTING AND INFORMATION SUPPLY SERVICES' },
    { code: '9985', desc: 'SUPPORT SERVICES (SECURITY, CLEANING, STAFFING)' },
    { code: '9987', desc: 'MAINTENANCE, REPAIR AND INSTALLATION SERVICES' },
    { code: '998713', desc: 'MAINTENANCE AND REPAIR OF MOTOR VEHICLES' },
    { code: '998716', desc: 'MAINTENANCE AND REPAIR SERVICES OF COMPUTERS AND OFFICE EQUIPMENT' },
    { code: '9988', desc: 'MANUFACTURING SERVICES ON PHYSICAL INPUTS (GOODS) OWNED BY OTHERS (JOB WORK)' },
    { code: '9991', desc: 'PUBLIC ADMINISTRATION AND OTHER SERVICES TO THE COMMUNITY' },
    { code: '9992', desc: 'EDUCATION SERVICES' },
    { code: '9993', desc: 'HUMAN HEALTH AND SOCIAL CARE SERVICES' },
    { code: '9995', desc: 'SERVICES OF MEMBERSHIP ORGANIZATIONS' },
    { code: '9996', desc: 'RECREATIONAL, CULTURAL AND SPORTING SERVICES' },
    { code: '9997', desc: 'OTHER SERVICES (HAIR DRESSING, LAUNDRY, BEAUTY TREATMENT)' },
    { code: '9999', desc: 'SERVICES PROVIDED BY EXTRA-TERRITORIAL ORGANIZATIONS' },
  ];

  for (const sac of standardSacList) {
    if (!codeMap.has(sac.code)) {
      codeMap.set(sac.code, sac.desc);
    }
  }

  const items = Array.from(codeMap.entries()).map(([code, desc]) => ({
    code,
    desc,
    type: code.startsWith('99') ? 'SAC' : 'HSN',
  }));

  // Sort by code length then code
  items.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  console.log(`Writing ${items.length} items to ${outPath}...`);
  fs.writeFileSync(outPath, JSON.stringify(items));
  const stats = fs.statSync(outPath);
  console.log(`Success! File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
}

extractHsnData().catch((err) => {
  console.error('Extraction failed:', err);
  process.exit(1);
});
