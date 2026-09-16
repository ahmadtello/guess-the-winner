import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const source = process.argv[2];
const logoDir = process.argv[3];
const datasetId = process.argv[4] || 'awards-shortlist-v1';
if (!source || !logoDir) throw new Error('Usage: node scripts/import-awards-shortlist.mjs <csv> <logo-folder> [dataset-id]');
function csv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(value); value = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ''; }
    else value += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(value); if (row.some(Boolean)) rows.push(row);
  return rows;
}
// Company ids and logo files are derived from the company name: "Blue Harbor Services" -> id "blue-harbor-services",
// logo file "blue-harbor-services.png" (png, jpg, jpeg, webp or svg) in the logo folder.
const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const logoPattern = /\.(png|jpe?g|webp|svg)$/i;
const bytes = fs.readFileSync(source);
const rows = csv(bytes.toString('utf8').replace(/^﻿/, ''));
if (rows[0][0] !== 'Question' || rows[0][7] !== 'Correct Answer(s)') throw new Error('Unexpected CSV columns');
const files = fs.readdirSync(logoDir);
const copied = new Set();
const answerKey = {};
const categories = rows.slice(1).map((row, i) => {
  const title = row[0].replace(/^Who won in this category:\s*/, '').replace(/\?$/, '');
  const split = title.indexOf(' - ');
  if (split < 0) throw new Error(`Unrecognized category ${title}`);
  const names = row.slice(7).flatMap(cell => cell.split('@@@')).map(s => s.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) throw new Error(`Duplicate nominee in ${title}`);
  const nominees = names.map(name => {
    const code = slug(name);
    if (!code) throw new Error(`Company name has no letters or digits: ${name}`);
    const matches = files.filter(f => logoPattern.test(f) && f.replace(logoPattern, '').toLowerCase() === code);
    if (matches.length !== 1) throw new Error(`Logo missing or ambiguous for ${name}: expected ${code}.png (or .jpg, .jpeg, .webp, .svg)`);
    const filename = matches[0]; copied.add(filename);
    return { id: code, name, logo: `/awards/nominees/${filename}` };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const id = `award-${String(i + 1).padStart(2, '0')}`;
  answerKey[id] = row[7].split('@@@').map(name => slug(name));
  return { id, group: title.slice(0, split), name: title.slice(split + 3), nominees };
});
fs.mkdirSync('public/awards/nominees', { recursive: true });
for (const filename of copied) fs.copyFileSync(path.join(logoDir, filename), path.join('public/awards/nominees', filename));
fs.mkdirSync('.private', { recursive: true });
fs.writeFileSync('src/awards-shortlist.json', JSON.stringify({ dataset: datasetId, categories }, null, 2) + '\n');
fs.writeFileSync('.private/awards-answer-key.json', JSON.stringify({ dataset: datasetId, winners: answerKey }, null, 2) + '\n');
fs.writeFileSync('.private/awards-source.csv', bytes);
const summary = { categories: categories.length, companies: copied.size, nominations: categories.reduce((n, c) => n + c.nominees.length, 0), counts: categories.map(c => c.nominees.length), jointWinnerCategories: Object.values(answerKey).filter(ids => ids.length > 1).length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), unusedLogos: files.filter(f => !copied.has(f)) };
fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/awards-import-report.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
