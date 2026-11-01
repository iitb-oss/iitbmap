// Short forms OSM names lack; fuzzy.ts derives initialisms. Keys are exact building names.
export const BUILDING_ALIASES: Record<string, string[]> = {
  KReSIT: ["Kanwal Rekhi", "CMINDS"],
  "Department of Bio sciences and Bio engineering": ["BSBE", "Biosciences"],
  "Department of Metalurgical and Material Science Engineering": ["MEMS", "Metallurgy"],
  "Department of Energy Science and Engineering": ["ESE", "DESE", "CCD", "Cafe Coffee Day", "ESED", "Environmental Science and Engineering", "Department of Environmental Science and Engineering"],
  Gulmohar: ["Gullu"],
  "Lecture Hall": ["LHC", "Lecture Hall Complex"],
  "Lecture Hall Complex 3": ["LHC3", "LHC 3", "Krishnamurthy Lecture Hall Complex", "Krishnamurthy"],
  SOM: ["SJMSOM", "School of Management"],
  "Viktor Menezes Convention Centre": ["VMCC", "Victor Menezes Convention Centre"],
  "PC Saxena Auditorium LT": ["PCSA", "PC Saxena Auditorium"],
  "Staff Hostel Annexe": ["SHA"],
  "Department of Chemical Engineering and Chemistry": ["ChemE", "Chemistry", "Chemical Engineering"],
  "Aerospace Department": ["AE"],
  "Aerospace Engineering (Annex) + HSS": ["HSS", "Humanities", "Humanities and Social Sciences"],
  "Mathematics Department": ["Maths"],
  // opposite CSRE
  "Old CESE Building": ["CESE"],
  "Nandan Nilekani Main Building": ["MB"],
  SAC: ["Student Activity Centre"],
  "State Bank of India": ["SBI", "Bank", "ATM"],
  Hospital: ["IIT Hospital"],
  "Post Office": ["IIT Bombay Post Office", "PO"],
  "New SAC": ["New Student Activity Centre", "New Students Activity Centre"],
  "COPT - Aerospace (New) Department": ["New Aerospace", "Aerospace New"],
  "Rahul Bajaj Technology Innovation Centre": ["Industrial Design Centre", "Quantum Cafe"],
  AB1: ["Academic Building 1"],
  AB2: ["Academic Building 2"],
  "Fire and Safety Department": ["Fire Station", "Fire Brigade"],
  "Society for Applied Microwave Electronics Engineering & Research": ["SAMEER"],
  "Mechanical Engineering Department": ["ME", "Mech"],
  "A91 Eco Hub": ["Economics", "A91 Economics"],
  // block codes from before OSM renamed them
  "Nilgiri (268-326)": ["B 24"],
  "Satpura (123-146)": ["B 21"],
  "Shivalik (187-240)": ["C 23"],
  "Estate Office (Central Area)": ["B-1"],
  "Computer Science & Engineering Center (New)": ["CC", "New CC", "Computer Centre", "Computer Center"],
  "OLD CSE": ["CSE", "Computer Science and Engineering"],
  "Padmavati Devi Temple": ["Devi Temple", "Padmavati Temple", "Devi Mandir"],
  Gowshala: ["Cow Shed", "Goshala"],
  "Shri Hanuman Mandir Hillside": ["Hanuman Temple", "Hanuman Mandir"],
  "B-19 Jayantia Building (75-98)": ["B19", "Jayantia"],
  "ASPIRE Research Park": ["IITB Research Park"],
  "H-15 Wing B": ["H15"],
  "Lake Side Gate (Gate 1)": ["Gate 1", "Lakeside Gate", "Lake Gate"],
  "Main Gate (Gate 2)": ["Gate 2", "IITB Main Gate"],
  "Market Gate (Gate 3)": ["Gate 3", "YP Gate"],
};
// Bungalows are also called A-1, A-2, ...
for (let n = 1; n <= 19; n++) BUILDING_ALIASES[n === 1 ? "Bungalow 1 (Directors Bungalow)" : `Bungalow ${n}`] = [`A-${n}`];

// offices inside buildings: floor as in iitb-rooms.json, at = pin spot (default the centre)
export interface Office {
  building: string;
  names: string[];
  floor: string;
  at?: [number, number];
}
export const OFFICES: Office[] = [
  { building: "KReSIT", names: ["KCDH", "Koita Centre for Digital Health"], floor: "B", at: [72.91592, 19.13026] }, // south end
  { building: "Old CESE Building", names: ["GESH", "Research Hub for Green Energy and Sustainability"], floor: "2" },
  { building: "COPT - Aerospace (New) Department", names: ["BETIC", "IITB-ICICI BETIC Hub"], floor: "6" },
  { building: "Rahul Bajaj Technology Innovation Centre", names: ["SINE", "Society for Innovation and Entrepreneurship"], floor: "5" },
  { building: "Rahul Bajaj Technology Innovation Centre", names: ["IRCC", "Industrial Research and Consulting Centre"], floor: "2" },
];
for (const o of OFFICES) (BUILDING_ALIASES[o.building] ??= []).push(...o.names);
export const OFFICE_BY_NAME = new Map(OFFICES.flatMap((o) => o.names.map((n) => [n, o] as const)));
