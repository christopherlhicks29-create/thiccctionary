#!/usr/bin/env node
/**
 * Editorial sanity audit. Catches fabricated subjects, photo-subject mismatch,
 * suspicious model numbers, and obvious hallucination tells in recent entries.
 *
 * Wave 226 (post 5/31 Industrial F350 incident). Site-health checks structure;
 * THIS checks editorial. Designed to run on the last N entries; flags items
 * for human review without auto-fixing them (editorial calls stay with the PM
 * or Christopher).
 *
 * Usage:
 *   node scripts/editorial-sanity.js              # check last 5 entries
 *   node scripts/editorial-sanity.js --count 10   # check last 10
 *   node scripts/editorial-sanity.js --all        # check entire catalog
 *
 * Exits 0 if clean, 1 if any RED flags found, 0 with warnings if only YELLOW.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Vehicle / aircraft / military model numbers commonly borrowed by LLMs
const SUSPICIOUS_MODEL_TOKENS = [
  /\bF[- ]?\d{2,4}\b/i,         // F-150, F350, F-22, F4
  /\bBoeing\s+\d{3}\b/i,         // Boeing 747
  /\bAirbus\s+A\d{3}\b/i,        // Airbus A380
  /\bM\d{1,2}[A-Z]?\d?\b/i,      // M1, M1A2, M16
  /\b747\b/, /\b737\b/, /\b777\b/, /\b787\b/,  // Aircraft
  /\bKX[- ]?\d+/i,               // Fake LLM-generated model strings
  /\b[A-Z]{2,4}[- ]?\d{3,5}\b/,  // generic AAA-1234 pattern (broad)
];

// Categories where the above tokens are LEGITIMATE
const VEHICLE_LIKE_CATEGORIES = new Set([
  // Wave 249: canonical catalog category names. The bug: the catalog uses
  // "Vehicles & Transport" but this allowlist only had "Vehicles"/"Vehicle",
  // so every legit model-number vehicle entry (F-250, etc.) false-flagged RED
  // and blocked all manual entries.json pre-ship edits.
  'Vehicles & Transport', 'Engineering Marvels',
  'Vehicles', 'Vehicle', 'Aircraft', 'Aviation', 'Ships', 'Maritime',
  'Trains', 'Heavy Machinery', 'Industrial Machinery', 'Military',
  'Construction Equipment', 'Mining',
]);

// Categories where the tokens are RED FLAGS
function isSubjectIdentitySuspicious(entry) {
  const word = entry.word || '';
  const cat = entry.category || '';
  for (const re of SUSPICIOUS_MODEL_TOKENS) {
    if (re.test(word)) {
      if (!VEHICLE_LIKE_CATEGORIES.has(cat)) {
        return `Model-number "${word.match(re)[0]}" in category "${cat}" looks borrowed from vehicle/aircraft (expected in: ${[...VEHICLE_LIKE_CATEGORIES].slice(0,5).join(', ')}, etc.)`;
      }
    }
  }
  return null;
}

function checkPhotoSubjectCoherence(entry) {
  // Heuristic: if the entry word contains a unique model token, that token
  // should plausibly appear in the photographer/Unsplash URL or the photo description.
  // Since we don't store photo description, we approximate via URL slug.
  const word = entry.word || '';
  const url = entry.unsplashUrl || '';
  const modelMatch = word.match(/\b([A-Z][A-Z0-9-]{2,})\b/);
  if (modelMatch) {
    const token = modelMatch[1].toLowerCase();
    // F350, F-150 etc — common vehicle tokens always pass if category is vehicle-like.
    if (VEHICLE_LIKE_CATEGORIES.has(entry.category)) return null;
    // If the photo URL slug doesn't reference the token in any way, flag it
    if (url && !url.toLowerCase().includes(token)) {
      // Allow common product-grade qualifiers (Industrial, Commercial, Professional)
      if (/^(INDUSTRIAL|COMMERCIAL|PROFESSIONAL|HEAVY)/i.test(token)) return null;
      return `Subject token "${modelMatch[1]}" does not appear in the photo's Unsplash URL slug — possible hallucinated model on a generic photo.`;
    }
  }
  return null;
}

function checkSubjectSpecificity(entry) {
  // Catches the "Tractor Tire" failure mode: subject names a SPECIFIC sub-component
  // (Tire, Wheel, Engine, Cab) of a larger object, but the photo URL only references
  // the larger object generically. Example: subject "Tractor Tire" + photo URL
  // "a-red-tractor-is-parked-on-a-gravel-road" - the "tire" specifier is missing,
  // photo shows whole tractor.
  const word = entry.word || '';
  const url = (entry.unsplashUrl || '').toLowerCase();
  if (!url) return null;
  // Pattern: "X Y" or "X, Y" where Y is a known sub-component term
  const SUB_COMPONENTS = ['tire', 'wheel', 'engine', 'cab', 'hood', 'mirror',
    'fender', 'bumper', 'headlight', 'tailgate', 'door', 'handle',
    'lid', 'spout', 'handle', 'blade', 'bit', 'tooth', 'tread'];
  const wordLower = word.toLowerCase();
  for (const comp of SUB_COMPONENTS) {
    // Match "<noun> <comp>" or "<noun>, <comp>"
    const re = new RegExp('\\b([a-z]+),?\\s+' + comp + '\\b', 'i');
    const m = wordLower.match(re);
    if (m) {
      const parent = m[1];
      // If photo URL contains parent but NOT the sub-component, flag
      if (url.includes(parent) && !url.includes(comp)) {
        return `Subject "${word}" names sub-component "${comp}" of "${parent}", but photo URL only references "${parent}" generically (missing "${comp}"). Photo likely shows whole ${parent}, not the ${comp}.`;
      }
    }
  }
  return null;
}

function checkAnimalSubject(entry) {
  // The brand rule (from generate-daily.js auto-picker prompt) is INANIMATE objects only.
  // Animals have slipped through 3 times (Whale, Hippopotamus, Sheep). Flag any new ones.
  // Wave 228: ALLOWLIST iconic megafauna (Natural Specimens category).
  // The 3 grandfathered animal entries fit here (Hippopotamus, Blue Whale, Hissar sheep was retired from this list as not iconic enough).
  const ALLOWLIST = ['hippopotamus','blue whale','rhinoceros','walrus','manatee','elephant','orca','sequoia'];
  const ANIMALS = ['dog','cat','horse','cow','pig','sheep','tortoise','bear','panda','gorilla',
    'tiger','lion','seal','dolphin','beluga','crocodile','alligator','bison',
    'kangaroo','koala','rhino','giraffe','octopus','squid','python','anaconda','chicken','duck','goat','goose',
    'swan','turkey','rabbit','squirrel','raccoon','deer','moose','elk',
    'llama','alpaca','donkey','mule','ox','buffalo','wolf','fox','coyote','goldfish','hamster'];
  const word = (entry.word || '').toLowerCase();
  for (const a of ANIMALS) {
    // Word-boundary match: avoid false positive "cat" inside "cathedral", "bull" inside "bullhorn", etc.
    const re = new RegExp('\\b' + a + '\\b', 'i');
    if (re.test(word)) {
      return `Subject "${entry.word}" is an ANIMAL. Brand rule: inanimate objects only. Pull or flag for CEO call.`;
    }
  }
  return null;
}

function checkHumanBodySubject(entry) {
  // Brand rule: never people, bodies, body parts. Catches subjects like
  // "Bodybuilder, Heavyweight" or "Sumo Wrestler" that occasionally slip past
  // the auto-picker.
  const BANNED = ['bodybuilder','sumo','wrestler','butt','breast','thigh','belly','tummy','torso','buttocks','rear end','arm','leg','muscle','bicep','tricep','pectoral'];
  const word = (entry.word || '').toLowerCase();
  for (const b of BANNED) {
    const re = new RegExp('\\b' + b + '\\b', 'i');
    if (re.test(word)) {
      return `Subject "${entry.word}" references a human or body part. Brand rule: never people, never bodies. RED.`;
    }
  }
  return null;
}

function checkBrandVoice(entry) {
  // Em-dashes anywhere in catalog content = leak
  const fields = ['word', 'example', 'caption', 'etymology', ...(entry.definitions || [])];
  for (const f of fields) {
    if (typeof f === 'string' && (/—|–/.test(f))) {
      return `Em-dash or en-dash found in entry content (brand rule: no dashes).`;
    }
  }
  return null;
}

// Wave 249: flag non-canonical category labels (caught "Tractor, Compact Utility"
// filed as bare "Vehicles" instead of "Vehicles & Transport", which split the facet).
const CANONICAL_CATEGORIES = new Set([
  'Architecture & Infrastructure', 'Domestic Goods', 'Engineering Marvels',
  'Foods of Substance', 'Industrial Machinery', 'Musical Instruments',
  'Natural Specimens', 'Produce & Botanical', 'Vehicles & Transport',
]);
function checkCanonicalCategory(entry) {
  const cat = entry.category || '';
  if (!cat) return `Entry "${entry.word}" has no category.`;
  if (!CANONICAL_CATEGORIES.has(cat)) {
    return `Category "${cat}" is not in the canonical set - likely a near-duplicate label (e.g. "Vehicles" vs "Vehicles & Transport"). Splits the category facet.`;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  let count = 5;
  let all = false;
  const ci = args.indexOf('--count');
  if (ci >= 0) count = Number(args[ci+1]) || 5;
  if (args.includes('--all')) all = true;

  const entries = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'entries.json'), 'utf8'));
  entries.sort((a,b) => new Date(b.date) - new Date(a.date));
  const subset = all ? entries : entries.slice(0, count);

  console.log(`# Editorial sanity audit, ${subset.length} ${all?'(all)':'recent'} entries`);
  console.log('');

  let red = 0, yellow = 0;
  for (const e of subset) {
    const findings = [];
    const a = isSubjectIdentitySuspicious(e); if (a) findings.push({sev:'RED', msg:a});
    const b = checkPhotoSubjectCoherence(e);   if (b) findings.push({sev:'YELLOW', msg:b});
    const d = checkSubjectSpecificity(e);    if (d) findings.push({sev:'YELLOW', msg:d});
    const e2 = checkAnimalSubject(e);       if (e2) findings.push({sev:'YELLOW', msg:e2});
    const f = checkHumanBodySubject(e);      if (f) findings.push({sev:'RED', msg:f});
    const c = checkBrandVoice(e);              if (c) findings.push({sev:'RED', msg:c});
    const g = checkCanonicalCategory(e);     if (g) findings.push({sev:'YELLOW', msg:g});
    if (findings.length === 0) continue;
    console.log(`## ${e.date} ${e.word} (${e.category})`);
    for (const f of findings) {
      console.log(`  ${f.sev}: ${f.msg}`);
      if (f.sev === 'RED') red++; else yellow++;
    }
  }
  console.log('');
  console.log(`Summary: ${red} RED, ${yellow} YELLOW across ${subset.length} entries.`);
  process.exit(red > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
