// Seed brand profile + sample submissions so the workspace is never empty.
import { runTextChecks, imageFindings } from "./checker.js";

export const USERS = {
  manager: { name: "Anika Rao", title: "Brand Manager" },
  creator: { name: "Priya Shah", title: "Content Creator" },
  reviewer: { name: "Rohan Mehta", title: "Reviewer" },
};

export const CONTENT_TYPES = [
  { id: "blog", label: "Blog post" },
  { id: "social", label: "Social post" },
  { id: "ad", label: "Advertisement" },
  { id: "email", label: "Email" },
  { id: "document", label: "Document" },
];

// Used by the "Which rules are mandatory?" setup question.
export const RULE_GROUPS = [
  { id: "names", label: "Product name", rules: ["T-NAME"] },
  { id: "claims", label: "Approved claims", rules: ["C-FAST", "C-BEST", "C-GUAR", "C-SECURE", "C-STAT"] },
  { id: "visual", label: "Logo & visuals", rules: [], image: ["logo", "fonts"] },
  { id: "access", label: "Accessibility", rules: [], image: ["alt"] },
  { id: "tone", label: "Tone & language", rules: ["T-CUST", "T-SALES", "V-FORMAL", "V-EXCL", "V-CAPS", "V-LONG"] },
];

export const SEED_PROFILE = {
  version: 2,
  brandName: "Nova",
  productName: { current: "Nova", former: ["Alpha"] },
  voice: ["warm", "clear", "direct"],
  approvedClaims: ["Built for local businesses", "2,000+ local businesses"],
  palette: [
    { name: "Nova Violet", hex: "#5B4CE0" },
    { name: "Ink Navy", hex: "#12163A" },
    { name: "Signal Teal", hex: "#1FAA8C" },
    { name: "Coral", hex: "#FF6B5E" },
    { name: "Cloud", hex: "#F3F1FD" },
  ],
  fonts: ["Inter", "Playfair Display"],
  approvedAssets: ["Logo-Primary-2026.svg"],
  deprecatedAssets: ["Logo-Primary-2023", "logo-old", "Alpha-Logo"],
  imageRules: { logo: "mandatory", alt: "mandatory", fonts: "mandatory", palette: "flexible" },
  rules: [
    {
      id: "T-NAME", kind: "term", strictness: "mandatory", since: 2, label: "Outdated product name",
      category: "Terminology", caseSensitive: true, pairs: [["Alpha", "Nova"]],
      why: "The product was renamed from Alpha to Nova. The old name must not appear in public content.",
      source: { doc: "Brand Guidelines", ref: "§2.1 Product naming" },
    },
    {
      id: "T-CUST", kind: "term", strictness: "flexible", since: 1, label: "Preferred term",
      category: "Terminology", pairs: [["users", "customers"], ["user", "customer"]],
      why: "Brand Guidelines call the people we serve “customers”.",
      source: { doc: "Brand Guidelines", ref: "§3.2 Preferred terms" },
    },
    {
      id: "T-SALES", kind: "term", strictness: "flexible", since: 1, label: "Preferred term",
      category: "Terminology", pairs: [["customers", "clients"], ["customer", "client"]],
      why: "The Sales Playbook calls the people we serve “clients”.",
      source: { doc: "Sales Playbook 2025", ref: "§4 Language" },
    },
    {
      id: "C-FAST", kind: "claim", strictness: "mandatory", since: 1, label: "Claim needs a source",
      category: "Facts & claims",
      patterns: [{ src: "\\b(?:the\\s+)?fastest\\s+(?:service|platform|tool)(?:\\s+in\\s+the\\s+(?:country|world|industry|market))?", flags: "i", replacement: "a fast service designed for local businesses" }],
      why: "The approved fact sheet and linked study do not support this comparison.",
      source: { doc: "Approved Fact Sheet", ref: "Approved claims" },
    },
    {
      id: "C-BEST", kind: "claim", strictness: "mandatory", since: 1, label: "Claim needs a source",
      category: "Facts & claims",
      patterns: [{ src: "\\b(?:the\\s+)?(?:best|#1|number[- ]one|leading)\\s+(?:[a-z]+\\s+){0,2}?(?:in\\s+the\\s+(?:country|world|industry|market)|on\\s+the\\s+market)", flags: "i", replacement: "built for local businesses" }],
      why: "“Best” and “leading” rankings are not backed by an approved source.",
      source: { doc: "Approved Fact Sheet", ref: "Approved claims" },
    },
    {
      id: "C-GUAR", kind: "claim", strictness: "mandatory", since: 1, label: "Claim needs a source",
      category: "Facts & claims",
      patterns: [{ src: "\\bguaranteed\\s+(?:results?|success|growth)\\b", flags: "i", replacement: "results you can track" }],
      why: "Guarantees are not part of the approved claims.",
      source: { doc: "Approved Fact Sheet", ref: "Approved claims" },
    },
    {
      id: "C-SECURE", kind: "claim", strictness: "mandatory", since: 1, label: "Claim needs a source",
      category: "Facts & claims",
      patterns: [{ src: "\\b(?:100%\\s+secure|unhackable|completely\\s+secure)\\b", flags: "i", replacement: "built with security in mind" }],
      why: "Absolute security claims are not supported by approved evidence.",
      source: { doc: "Approved Fact Sheet", ref: "Security statements" },
    },
    {
      id: "C-STAT", kind: "stat", strictness: "mandatory", since: 1, label: "Unverified statistic",
      category: "Facts & claims",
      src: "\\b\\d[\\d,]*\\+?\\s+(?:local\\s+)?(?:businesses|customers|clients|teams|brands)\\b",
      approved: ["2,000+ local businesses"],
      why: "This figure is not in the approved fact sheet.",
      source: { doc: "Approved Fact Sheet", ref: "Key figures" },
    },
    {
      id: "V-FORMAL", kind: "tone", strictness: "flexible", since: 1, label: "Off-tone wording",
      category: "Language & tone",
      pairs: [["utilize", "use"], ["utilise", "use"], ["leverage", "use"], ["facilitate", "help"], ["in order to", "to"], ["commence", "start"], ["endeavour", "try"], ["purchase", "buy"], ["assistance", "help"], ["numerous", "many"], ["subsequently", "then"], ["cutting-edge", "modern"], ["state-of-the-art", "modern"], ["synergies", "teamwork"]],
      why: "The brand voice is warm, clear and direct. This wording is more formal than the approved examples.",
      source: { doc: "Voice & Tone Guide", ref: "Warm · clear · direct" },
    },
    {
      id: "V-CONTR", kind: "tone", rewriteOnly: true, strictness: "flexible", since: 1, label: "Warmer phrasing",
      category: "Language & tone",
      pairs: [["do not", "don’t"], ["cannot", "can’t"], ["you will", "you’ll"], ["we are", "we’re"]],
      why: "Contractions keep the voice warm and direct.",
      source: { doc: "Voice & Tone Guide", ref: "Warm · clear · direct" },
    },
    {
      id: "V-EXCL", kind: "exclaim", strictness: "flexible", since: 1, label: "Too many exclamation marks",
      category: "Brand aura",
      why: "The brand aura is confident and calm. Keep to one exclamation mark at most.",
      source: { doc: "Voice & Tone Guide", ref: "Punctuation" },
    },
    {
      id: "V-CAPS", kind: "caps", strictness: "flexible", since: 1, label: "All-caps wording",
      category: "Access & channel fit",
      why: "All-caps words read as shouting and are harder to read with assistive technology.",
      source: { doc: "Accessibility Standards", ref: "Readable text" },
    },
    {
      id: "V-LONG", kind: "long", strictness: "flexible", since: 1, label: "Sentence is too long",
      category: "Language & tone",
      why: "The brand voice is direct. Sentences over 30 words are hard to follow.",
      source: { doc: "Voice & Tone Guide", ref: "Short sentences" },
    },
    {
      id: "A-LINK", kind: "link", strictness: "flexible", since: 1, label: "Vague link text",
      category: "Access & channel fit",
      why: "Link text should describe where it goes, so screen-reader users can understand it out of context.",
      source: { doc: "Accessibility Standards", ref: "Link text" },
    },
    { id: "P-STRUCT", kind: "structure", strictness: "flexible", since: 1, label: "Content pattern", category: "Content patterns" },
  ],
};

// A sample draft per content type, so the demo can start instantly.
export const SAMPLE_DRAFTS = {
  blog: {
    title: "How Alpha helps local shops",
    audience: "Small business owners",
    purpose: "Explain the product and drive sign-ups",
    content:
      "Alpha is the fastest service in the country. Our users utilize it in order to manage bookings, and numerous customers tell us they save hours every week! Already 10,000 customers trust us, and we are 100% secure, so you can focus on running your shop while we handle the rest of the work for you every single day without any extra effort.\n\nClick here to read more.",
  },
  social: {
    title: "Social: spring launch",
    audience: "Local shop owners",
    purpose: "Announce the launch",
    content: "NEW: Alpha is the best platform on the market. Guaranteed results for every shop! Try it today! #launch #local #shops #sale #nova",
  },
  ad: {
    title: "Search ad: bookings",
    audience: "Salon and cafe owners",
    purpose: "Drive clicks to the landing page",
    content: "Nova: the leading booking tool in the country. Leverage state-of-the-art scheduling for your shop.",
  },
  email: {
    title: "Email: onboarding",
    audience: "New customers",
    purpose: "Welcome and activation",
    content: "Thanks for joining Alpha. Our users can commence setup in a few minutes, and our team will provide assistance whenever you need it.",
  },
  document: {
    title: "One-pager: local business offer",
    audience: "Partners",
    purpose: "Summarise the offer",
    content: "Nova is built for local businesses. Over 2,000+ local businesses use Nova to manage bookings. Customers can start in minutes.",
  },
};

const day = 86400000;
const ago = (d, h = 0) => new Date(Date.now() - d * day - h * 3600000).toISOString();

const SEEDS = [
  {
    id: "S-1001", title: "Spring launch blog", type: "blog", author: "Priya Shah", status: "in_review",
    audience: "Small business owners", purpose: "Announce the spring release", created: ago(1, 3), profileVersion: 2,
    v1: "Alpha is the fastest service in the country for local businesses. Our users utilize it in order to manage bookings every day. Customers love how quickly they can get set up!\n\nSubscribe to learn more.",
    comments: [{ by: "Priya Shah", role: "creator", text: "First draft for the spring launch.", at: ago(1, 3) }],
  },
  {
    id: "S-1002", title: "Instagram: holiday offer", type: "social", author: "Rahul Verma", status: "changes_requested",
    audience: "Local shop owners", purpose: "Promote the holiday offer", created: ago(2, 5), profileVersion: 2,
    v1: "HOLIDAY OFFER! Nova is the best platform on the market!! #holiday #nova",
    image: { name: "holiday-post-Logo-Primary-2023.png", alt: "", fonts: "Comic Sans, Inter", textInImage: "" },
    extra: [
      { ruleId: "IMG-LOGO", label: "Old logo", category: "Visual identity", strictness: "mandatory", quote: "holiday-post-Logo-Primary-2023.png", status: "open" },
      { ruleId: "IMG-ALT", label: "Missing alt text", category: "Access & channel fit", strictness: "mandatory", quote: "(image)", status: "open" },
      { ruleId: "IMG-FONT", label: "Unapproved font", category: "Visual identity", strictness: "mandatory", quote: "Comic Sans", status: "open" },
    ],
    comments: [
      { by: "Rahul Verma", role: "creator", text: "Holiday creative attached.", at: ago(2, 5) },
      { by: "Rohan Mehta", role: "reviewer", text: "The creative uses the old logo and an unapproved font. Please replace both and add alt text.", at: ago(1, 20) },
    ],
    decision: { status: "changes_requested", by: "Rohan Mehta", at: ago(1, 20) },
  },
  {
    id: "S-1003", title: "Email: onboarding series", type: "email", author: "Meera Iyer", status: "approved",
    audience: "New customers", purpose: "Welcome and activation", created: ago(6, 2), profileVersion: 1,
    v1: "Subject: Welcome aboard\n\nHi there,\n\nThanks for joining Alpha. We cannot wait to help you get started, and our team will provide assistance whenever you need it.",
    v2: "Subject: Welcome aboard\n\nHi there,\n\nThanks for joining Alpha. We can’t wait to help you get started, and our team will help whenever you need it.",
    comments: [{ by: "Rohan Mehta", role: "reviewer", text: "Approved. Tone is warm and clear.", at: ago(5, 4) }],
    decision: { status: "approved", by: "Rohan Mehta", at: ago(5, 4) },
    rejectRules: [],
  },
  {
    id: "S-1004", title: "Search ad: bookings", type: "ad", author: "Dev Patel", status: "in_review",
    audience: "Salon and cafe owners", purpose: "Drive clicks to the landing page", created: ago(0, 6), profileVersion: 2,
    v1: "Nova: the leading booking tool in the country. Leverage state-of-the-art scheduling for your shop.",
    comments: [{ by: "Dev Patel", role: "creator", text: "Ad copy for the local-SEO campaign.", at: ago(0, 6) }],
  },
  {
    id: "S-1005", title: "Blog: five scheduling tips", type: "blog", author: "Priya Shah", status: "approved",
    audience: "Small business owners", purpose: "Educate and drive sign-ups", created: ago(9, 1), profileVersion: 1,
    v1: "Scheduling should feel simple. Here are five tips that numerous Alpha shop owners use to cut no-shows.\n\nStart with Nova today.",
    v2: "Scheduling should feel simple. Here are five tips that many Alpha shop owners use to cut no-shows.\n\nStart with Nova today.",
    comments: [{ by: "Rohan Mehta", role: "reviewer", text: "Approved with the tone fixes applied.", at: ago(8, 2) }],
    decision: { status: "approved", by: "Rohan Mehta", at: ago(8, 2) },
  },
  {
    id: "S-1006", title: "LinkedIn: founder story", type: "social", author: "Rahul Verma", status: "rejected",
    audience: "Partners", purpose: "Thought leadership", created: ago(11, 2), profileVersion: 1,
    v1: "Over 15,000 clients trust our platform. We leverage cutting-edge technology to facilitate growth! Learn more here: click here",
    image: { name: "founder-banner.png", alt: "", fonts: "Impact", textInImage: "" },
    extra: [
      { ruleId: "IMG-FONT", label: "Unapproved font", category: "Visual identity", strictness: "mandatory", quote: "Impact", status: "open" },
      { ruleId: "IMG-ALT", label: "Missing alt text", category: "Access & channel fit", strictness: "mandatory", quote: "(image)", status: "open" },
    ],
    comments: [{ by: "Rohan Mehta", role: "reviewer", text: "The reach figure is unverified. Please resubmit with an approved statistic.", at: ago(10, 3) }],
    decision: { status: "rejected", by: "Rohan Mehta", at: ago(10, 3) },
    rejectRules: ["V-FORMAL"],
  },
];

function profileAt(profile, version) {
  return { ...profile, rules: profile.rules.filter((r) => (r.since || 1) <= version) };
}

export function buildSeedSubmissions(profile) {
  return SEEDS.map((s) => {
    const p = profileAt(profile, s.profileVersion);
    const meta = { type: s.type, audience: s.audience, purpose: s.purpose };
    const raised = runTextChecks(s.v1, meta, p).map((f) => ({
      key: f.key, ruleId: f.ruleId, label: f.label, category: f.category, strictness: f.strictness, quote: f.quote, status: "open",
    }));
    const hasV2 = !!s.v2;
    const final = raised.map((f) => {
      let status = "open";
      if (s.rejectRules && s.rejectRules.includes(f.ruleId)) status = "rejected";
      else if (hasV2) status = "accepted";
      return { ...f, status, note: status === "rejected" ? "Keeps the tone of the original announcement." : undefined };
    });
    const findings = [...final, ...(s.extra || [])];
    const versions = [{ n: 1, content: s.v1, at: s.created, by: s.author, note: "First submission" }];
    if (hasV2) versions.push({ n: 2, content: s.v2, at: s.decision ? s.decision.at : s.created, by: s.author, note: "Applied review suggestions" });
    return {
      id: s.id, title: s.title, type: s.type, audience: s.audience, purpose: s.purpose, author: s.author,
      status: s.status, createdAt: s.created, updatedAt: s.decision ? s.decision.at : s.created,
      profileVersion: s.profileVersion, versions, image: s.image || null, findings,
      comments: s.comments.map((c, i) => ({ id: `${s.id}-c${i}`, ...c })),
      activity: [
        { at: s.created, by: s.author, text: "Submitted for review" },
        ...(s.decision ? [{ at: s.decision.at, by: s.decision.by, text: labelStatus(s.decision.status) }] : []),
      ],
    };
  });
}

function labelStatus(s) {
  return { approved: "Approved the content", changes_requested: "Requested changes", rejected: "Rejected the content" }[s] || s;
}

export function seedChangelog() {
  return [
    { version: 1, at: ago(30), by: "Anika Rao", summary: "Initial brand profile created" },
    { version: 2, at: ago(2), by: "Anika Rao", summary: "Product renamed Alpha → Nova; old name is now a mandatory rule" },
  ];
}

export { imageFindings };
