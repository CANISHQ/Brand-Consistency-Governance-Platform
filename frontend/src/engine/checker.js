// Local, rule-based brand checker. Same finding shape the backend returns, so the UI
// can switch between this engine and the Flask/Gemini API without changes.
//
// Finding: { id, key, ruleId, label, category, strictness, kind, scope, start, end, quote,
//            suggestion, why, source:{doc,ref}, confidence, needsHuman, options?, fix? }
//   kind: "replace" | "advice" | "conflict"     scope: "text" | "image" | "document"

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (t, flags) => new RegExp(`(?<![\\w-])${esc(t)}(?![\\w-])`, flags);
const lc = (s) => s.toLowerCase();
const norm = (s) => lc(s).replace(/[,\s]/g, "");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function matchCase(orig, repl) {
  const f = orig[0];
  if (f && f === f.toUpperCase() && f !== f.toLowerCase() && repl[0] === repl[0].toLowerCase()) return cap(repl);
  return repl;
}

function contextKey(content, start, end) {
  return content.slice(Math.max(0, start - 20), Math.min(content.length, end + 20)).toLowerCase();
}

function sentenceBounds(text, start, end) {
  let s = start;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s--;
  let e = end;
  while (e < text.length && !/[.!?\n]/.test(text[e])) e++;
  return [s, Math.min(e + 1, text.length)];
}

function mk(rule, content, start, end, extra) {
  const quote = content.slice(start, end);
  return {
    id: `${rule.id}:${start}`,
    key: `${rule.id}|${quote.toLowerCase()}|${contextKey(content, start, end)}`,
    ruleId: rule.id,
    label: rule.label,
    category: rule.category,
    strictness: rule.strictness,
    kind: "replace",
    scope: "text",
    start,
    end,
    quote,
    why: rule.why,
    source: rule.source,
    confidence: 0.9,
    ...extra,
  };
}

const PRIORITY = { mandatory: 3, flexible: 1 };
const prio = (f) => (f.kind === "conflict" ? 2 : PRIORITY[f.strictness] || 1);

function splitSentence(sentence) {
  const mid = sentence.length / 2;
  let best = null;
  for (const sep of [", and ", ", but ", "; ", ", so "]) {
    let i = sentence.indexOf(sep);
    while (i !== -1) {
      if (!best || Math.abs(i - mid) < Math.abs(best.i - mid)) best = { i, sep };
      i = sentence.indexOf(sep, i + 1);
    }
  }
  if (!best) return null;
  const left = sentence.slice(0, best.i).trim().replace(/[.!?]+$/, "");
  let right = sentence.slice(best.i + best.sep.length).trim();
  if (best.sep === ", but ") right = "But " + right;
  return `${left}. ${cap(right)}`;
}

export function runTextChecks(content, meta = {}, profile) {
  const out = [];
  const rules = (profile.rules || []).filter((r) => !r.rewriteOnly);
  const termRules = (profile.rules || []).filter((r) => r.kind === "term");

  for (const rule of rules) {
    if (rule.kind === "term" || rule.kind === "tone") {
      for (const [a, b] of rule.pairs || []) {
        for (const m of content.matchAll(wordRe(a, rule.caseSensitive ? "g" : "gi"))) {
          const f = mk(rule, content, m.index, m.index + m[0].length, {
            suggestion: matchCase(m[0], b),
            confidence: rule.kind === "term" ? 0.97 : 0.74,
          });
          if (rule.kind === "term") {
            const other = termRules.find(
              (r2) => r2.id !== rule.id && (r2.pairs || []).some(([x, y]) => lc(y) === lc(a) || lc(x) === lc(b))
            );
            if (other) {
              f.kind = "conflict";
              f.needsHuman = true;
              f.confidence = 0.5;
              f.conflict = { a: rule, b: other };
              f.options = [
                { label: `Follow ${rule.source.doc}: use “${f.suggestion}”`, text: f.suggestion, source: rule.source },
                { label: `Follow ${other.source.doc}: keep “${m[0]}”`, text: null, source: other.source },
              ];
              f.why = `${rule.source.doc} says “${m[0]}” should be “${f.suggestion}”, but ${other.source.doc} says otherwise. The platform will not guess.`;
            }
          }
          out.push(f);
        }
      }
    } else if (rule.kind === "claim") {
      for (const p of rule.patterns || []) {
        for (const m of content.matchAll(new RegExp(p.src, "g" + (p.flags || "")))) {
          out.push(mk(rule, content, m.index, m.index + m[0].length, { suggestion: p.replacement, confidence: 0.92, orSource: true }));
        }
      }
    } else if (rule.kind === "stat") {
      const approved = (rule.approved || []).map(norm);
      for (const m of content.matchAll(new RegExp(rule.src, "gi"))) {
        if (approved.includes(norm(m[0]))) continue;
        out.push(mk(rule, content, m.index, m.index + m[0].length, { suggestion: (rule.approved || [])[0] || "", confidence: 0.8, orSource: true }));
      }
    } else if (rule.kind === "exclaim") {
      let n = 0;
      for (const m of content.matchAll(/(\S*?)(!+)/g)) {
        n += 1;
        if (n === 1 && m[2].length === 1) continue;
        const word = m[1];
        const bang = m[2];
        const start = m.index;
        const end = m.index + m[0].length;
        if (n === 1 && bang.length > 1) {
          out.push(mk(rule, content, start, end, { suggestion: word + "!", confidence: 0.85 }));
        } else if (n > 1) {
          out.push(mk(rule, content, start, end, { suggestion: word + ".", confidence: 0.76 }));
        }
      }
    } else if (rule.kind === "caps") {
      const skip = new Set(["HTTP", "HTTPS", "FAQ", "SEO", "CRM", "SAAS", "NEW"]);
      for (const m of content.matchAll(/\b[A-Z]{4,}\b/g)) {
        if (skip.has(m[0])) continue;
        out.push(mk(rule, content, m.index, m.index + m[0].length, { suggestion: cap(m[0].toLowerCase()), confidence: 0.72 }));
      }
    } else if (rule.kind === "long") {
      for (const m of content.matchAll(/[^.!?\n]+[.!?]*/g)) {
        const words = m[0].trim().split(/\s+/).filter(Boolean);
        if (words.length <= 30) continue;
        const lead = m[0].length - m[0].trimStart().length;
        const start = m.index + lead;
        const end = m.index + m[0].trimEnd().length;
        const sentence = content.slice(start, end);
        const split = splitSentence(sentence);
        out.push(
          mk(rule, content, start, end, split
            ? { suggestion: split, confidence: 0.66, needsHuman: true }
            : { kind: "advice", suggestion: "Split this sentence into two shorter ones.", confidence: 0.6, needsHuman: true })
        );
      }
    } else if (rule.kind === "link") {
      for (const m of content.matchAll(/\b(click here|read more|learn more here)\b/gi)) {
        out.push(mk(rule, content, m.index, m.index + m[0].length, {
          kind: "advice", suggestion: "Describe the destination, for example “See the setup guide”.", confidence: 0.8,
        }));
      }
    } else if (rule.kind === "structure") {
      out.push(...structureChecks(rule, content, meta));
    }
  }

  // Resolve overlaps: keep the highest-priority finding, then the earlier one.
  const spans = out.filter((f) => f.scope === "text").sort((a, b) => a.start - b.start || prio(b) - prio(a));
  const kept = [];
  for (const f of spans) {
    const last = kept[kept.length - 1];
    if (last && f.start < last.end) {
      if (prio(f) > prio(last)) kept[kept.length - 1] = f;
      continue;
    }
    kept.push(f);
  }
  const docs = out.filter((f) => f.scope !== "text");
  const all = [...kept, ...docs];
  for (const f of all) if (f.needsHuman === undefined) f.needsHuman = f.confidence < 0.7;
  return all;
}

function structureChecks(rule, content, meta) {
  const res = [];
  const type = meta.type;
  const doc = (label, suggestion, fix, ref, confidence = 0.68) => ({
    id: `${rule.id}:${label}`,
    key: `${rule.id}|${label.toLowerCase()}`,
    ruleId: rule.id,
    label,
    category: rule.category,
    strictness: rule.strictness,
    kind: "advice",
    scope: "document",
    quote: "(whole draft)",
    suggestion,
    why: `Approved ${type} examples follow this pattern.`,
    source: { doc: "Approved Examples", ref },
    confidence,
    fix,
  });
  const cta = /\b(try nova|start with nova|get started|sign up|book a demo|contact us|start today|talk to us)\b/i;
  if ((type === "blog" || type === "ad") && content.trim() && !cta.test(content)) {
    res.push(doc("Missing call to action", "End with a clear next step, for example “Start with Nova today.”", { type: "append", text: "\n\nStart with Nova today." }, `${type === "blog" ? "Blog" : "Ad"} pattern`));
  }
  if (type === "email") {
    if (!/^subject:/im.test(content.trim()) && content.trim()) {
      res.push(doc("Missing subject line", "Emails open with a short subject line.", { type: "prepend", text: "Subject: [Add subject]\n\n" }, "Email pattern"));
    }
    if (!/\b(hi|hello|dear)\b/i.test(content.slice(0, 160)) && content.trim()) {
      res.push(doc("Missing greeting", "Open with a friendly greeting such as “Hi there,”.", null, "Email pattern"));
    }
  }
  if (type === "social") {
    if (content.length > 280) res.push(doc("Too long for the channel", "Keep social posts to 280 characters or fewer.", null, "Social pattern"));
    const tags = content.match(/#\w+/g) || [];
    if (tags.length > 3) res.push(doc("Too many hashtags", `Use three hashtags or fewer (found ${tags.length}).`, null, "Social pattern"));
  }
  return res;
}

// ---------- Images ----------
export function imageFindings(img, profile) {
  if (!img) return [];
  const rules = profile.imageRules || {};
  const out = [];
  const base = (ruleId, label, category, key, quote, suggestion, why, source, confidence, extra) => ({
    id: `${ruleId}:${key}`,
    key: `${ruleId}|${key}`,
    ruleId, label, category,
    strictness: rules[extra && extra.rule] || "flexible",
    kind: "advice", scope: "image", quote, suggestion, why, source, confidence, needsHuman: true,
    ...extra,
  });
  const name = (img.name || "").toLowerCase();
  const bad = (profile.deprecatedAssets || []).find((a) => name.includes(a.toLowerCase()));
  if (bad) {
    out.push(base("IMG-LOGO", "Old logo", "Visual identity", img.name, img.name,
      `Replace it with the approved logo asset, “${(profile.approvedAssets || [])[0] || "the approved logo"}”. Please verify the image before publication.`,
      "The file name matches a retired logo asset. Visual analysis can be uncertain, so a person should confirm.",
      { doc: "Brand Assets", ref: "Approved logo" }, 0.7, { rule: "logo" }));
  }
  if (!(img.alt || "").trim()) {
    out.push(base("IMG-ALT", "Missing alt text", "Access & channel fit", "alt", "(image has no alt text)",
      "Describe what the image shows in one short sentence.",
      "Images need alt text so screen-reader users get the same message.",
      { doc: "Accessibility Standards", ref: "Alt text" }, 0.95, { rule: "alt", fix: { type: "alt" }, needsHuman: false }));
  }
  const approvedFonts = (profile.fonts || []).map(lc);
  const used = (img.fonts || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const f of used) {
    if (!approvedFonts.includes(lc(f))) {
      out.push(base("IMG-FONT", "Unapproved font", "Visual identity", f, f,
        `Use an approved font: ${(profile.fonts || []).join(" or ")}.`,
        `“${f}” is not in the approved typography list.`,
        { doc: "Brand Guidelines", ref: "§5 Typography" }, 0.9, { rule: "fonts", needsHuman: false }));
    }
  }
  const a = img.analysis;
  if (a) {
    for (const c of a.offPalette || []) {
      out.push(base("IMG-PALETTE", "Off-palette colour", "Visual identity", c.hex, c.hex,
        `Dominant colour ${c.hex} (about ${Math.round(c.share * 100)}% of the image) is far from the brand palette. Nearest brand colour: ${c.nearest.name} ${c.nearest.hex}.`,
        "Visual analysis can be uncertain, so this is routed to a person.",
        { doc: "Brand Guidelines", ref: "§4 Colour palette" }, 0.58, { rule: "palette", swatch: c.hex }));
    }
    if (a.lowContrast) {
      out.push(base("IMG-CONTRAST", "Possible low contrast", "Access & channel fit", "contrast", `${a.lowContrast.ratio.toFixed(1)}:1`,
        `The two main colours have a contrast ratio of ${a.lowContrast.ratio.toFixed(1)}:1. Aim for at least 3:1 for large text and 4.5:1 for body text.`,
        "Low contrast makes text harder to read. This is an estimate from dominant colours.",
        { doc: "Accessibility Standards", ref: "Contrast" }, 0.55, { rule: "palette" }));
    }
  }
  return out;
}

export function reviewAll({ content, meta, image, profile }) {
  const text = runTextChecks(content || "", meta, profile);
  const imgTextFindings = image && (image.textInImage || "").trim()
    ? runTextChecks(image.textInImage, { type: "social" }, { ...profile, rules: profile.rules.filter((r) => r.kind !== "structure") })
        .map((f) => ({ ...f, scope: "image", kind: f.kind === "replace" ? "advice" : f.kind, start: undefined, end: undefined, id: `img-${f.id}`, key: `img-${f.key}`, label: `${f.label} (in image)`, suggestion: `In the image text, change “${f.quote}” to “${f.suggestion}”.`, needsHuman: true }))
    : [];
  const imgs = imageFindings(image, profile);
  const order = { mandatory: 0, flexible: 1 };
  return [...text, ...imgs, ...imgTextFindings].sort((a, b) => order[a.strictness] - order[b.strictness] || (a.start ?? 1e9) - (b.start ?? 1e9));
}

// ---------- On-brand rewrite ----------
export function rewriteContent(content, meta, profile, dismissed = new Set()) {
  const findings = runTextChecks(content, meta, profile).filter((f) => !dismissed.has(f.key));
  const applicable = findings.filter((f) => f.scope === "text" && f.kind === "replace");
  const skipped = findings.filter((f) => f.kind === "conflict");
  let text = content;
  const applied = [];
  for (const f of [...applicable].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, f.start) + f.suggestion + text.slice(f.end);
    applied.push(f);
  }
  // Contractions: only in the rewrite, to keep the voice warm.
  const contr = (profile.rules || []).find((r) => r.id === "V-CONTR");
  if (contr) {
    for (const [a, b] of contr.pairs) {
      text = text.replace(wordRe(a, "gi"), (m) => {
        applied.push({ id: `${contr.id}:${a}`, label: contr.label, quote: m, suggestion: matchCase(m, b), ruleId: contr.id, strictness: "flexible" });
        return matchCase(m, b);
      });
    }
  }
  for (const f of runTextChecks(text, meta, profile)) {
    if (f.scope === "document" && f.fix) {
      text = f.fix.type === "append" ? text.replace(/\s+$/, "") + f.fix.text : f.fix.text + text;
      applied.push({ id: f.id, label: f.label, quote: "(whole draft)", suggestion: f.fix.text.trim(), ruleId: f.ruleId, strictness: f.strictness });
    }
  }
  return { text, applied: applied.reverse(), skipped };
}

// ---------- Profile health ----------
export function findConflicts(profile) {
  const rules = (profile.rules || []).filter((r) => r.kind === "term");
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const pairsA = [];
      const pairsB = [];
      let term = null;
      for (const pa of rules[i].pairs) {
        for (const pb of rules[j].pairs) {
          if (lc(pa[1]) === lc(pb[0]) || lc(pb[1]) === lc(pa[0])) {
            if (!pairsA.includes(pa)) pairsA.push(pa);
            if (!pairsB.includes(pb)) pairsB.push(pb);
            term = term || (lc(pa[1]) === lc(pb[0]) ? pa[1] : pb[1]);
          }
        }
      }
      if (pairsA.length) out.push({ a: rules[i], b: rules[j], term, pairA: pairsA[0], pairB: pairsB[0], pairsA, pairsB });
    }
  }
  return out;
}

// ---------- Colour helpers (used by image analysis) ----------
export const hexToRgb = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrastRatio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
export const colourDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function analysePixels(data, palette) {
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
    total++;
  }
  const top = [...buckets.values()].sort((x, y) => y.n - x.n).slice(0, 4).map((b) => ({
    rgb: [b.r / b.n, b.g / b.n, b.b / b.n], share: b.n / Math.max(total, 1),
  }));
  const pal = palette.map((p) => ({ ...p, rgb: hexToRgb(p.hex) }));
  const offPalette = [];
  for (const c of top) {
    if (c.share < 0.12) continue;
    const spread = Math.max(...c.rgb) - Math.min(...c.rgb);
    if (spread < 28) continue; // neutral greys, white and black are allowed
    const nearest = pal.reduce((best, p) => (colourDistance(c.rgb, p.rgb) < colourDistance(c.rgb, best.rgb) ? p : best), pal[0]);
    if (colourDistance(c.rgb, nearest.rgb) > 90) {
      offPalette.push({ hex: rgbToHex(c.rgb), share: c.share, nearest: { name: nearest.name, hex: nearest.hex } });
    }
  }
  let lowContrast = null;
  const main = top.filter((c) => c.share >= 0.15);
  if (main.length >= 2) {
    const ratio = contrastRatio(main[0].rgb, main[1].rgb);
    if (ratio < 3) lowContrast = { ratio };
  }
  return { offPalette, lowContrast };
}
