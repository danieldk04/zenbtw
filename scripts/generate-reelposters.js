#!/usr/bin/env node
/**
 * ZenBTW Reelposters Generator
 * Reads pending topics from reelposter-topics.json, generates informative
 * single-poster HTML via Claude, screenshots with Puppeteer (1080×1350 PNG),
 * updates reelposters/manifest.json.
 *
 * Usage: node scripts/generate-reelposters.js
 * Env:   ANTHROPIC_API_KEY (required)
 */

import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.join(__dirname, '..');
const TOPICS_FILE = path.join(ROOT, 'reelposter-topics.json');
const MANIFEST   = path.join(ROOT, 'reelposters', 'manifest.json');
const OUT_DIR    = path.join(ROOT, 'reelposters');
const TODAY      = new Date().toISOString().split('T')[0];

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadTopics()    { return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8')); }
function saveTopics(d)   { fs.writeFileSync(TOPICS_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function loadManifest()  {
  if (fs.existsSync(MANIFEST)) return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return { sets: [] };
}
function saveManifest(d) { fs.writeFileSync(MANIFEST, JSON.stringify(d, null, 2), 'utf8'); }
function pending(data)   { return data.queue.filter(t => t.status === 'pending').sort((a, b) => a.priority - b.priority); }

// ── Template: COMPARE ─────────────────────────────────────────────────────────
// Comparison table on cream background — ideal for platform/rule comparisons
function COMPARE(d) {
  const RISK = { hoog: ['#ef4444', 3], middel: ['#f97316', 2], laag: ['#fbbf24', 1], nvt: ['#9ca3af', 0] };
  const rows = (d.rows || []).map(r => {
    const [rc, rn] = RISK[(r.risico || 'nvt').toLowerCase()] || ['#9ca3af', 0];
    const dots = [1,2,3].map(i => `<div class="dot${i <= rn ? ' on' : ''}" style="${i <= rn ? `background:${rc}` : ''}"></div>`).join('');
    const kor = r.kor === true ? `<span class="pill green">✓ Ja</span>` : r.kor === false ? `<span class="pill gray">Nvt</span>` : `<span class="pill yellow">${r.kor}</span>`;
    const bd  = (r.bd_melding || '').toLowerCase() === 'automatisch' ? `<span class="pill red">Automatisch</span>` : `<span class="pill yellow">${r.bd_melding}</span>`;
    return `<tr>
      <td><div class="plat"><div class="pi" style="background:${r.color||'#1a4731'}">${r.letter||r.name[0]}</div><div><div class="pn">${r.name}</div><div class="pt">${r.type||''}</div></div></div></td>
      <td><div class="val">${r.drempel||'—'}</div>${r.drempel_sub?`<div class="vs">${r.drempel_sub}</div>`:''}</td>
      <td>${kor}</td><td>${bd}</td>
      <td><div class="rb"><div class="rd">${dots}</div><div class="rl" style="color:${rc}">${r.risico||'Nvt'}</div></div></td>
    </tr>`;
  }).join('');

  const cols = (d.columns || ['DAC7-drempel','KOR mogelijk','BD ziet omzet','Risico']).map(c => `<th>${c}</th>`).join('');

  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}
body{background:#f7f6f3;font-family:'Plus Jakarta Sans',sans-serif}
.pg{display:flex;flex-direction:column;height:100%}
.hdr{background:#1a4731;padding:46px 64px 42px;flex-shrink:0}
.hl{font-size:18px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
.ht{display:flex;justify-content:space-between;align-items:flex-start}
.htitle{font-family:'Fraunces',serif;font-size:${d.title_size||58}px;font-weight:700;color:#fff;line-height:1.05;letter-spacing:-1.5px;max-width:660px}
.htitle em{color:#86efac;font-style:normal}
.hsub{font-size:23px;color:rgba(255,255,255,.6);margin-top:13px}
.badge{background:rgba(255,255,255,.12);border:1.5px solid rgba(255,255,255,.2);border-radius:10px;padding:11px 18px;text-align:center;flex-shrink:0;margin-left:28px;margin-top:6px}
.bv{font-family:'Fraunces',serif;font-size:46px;font-weight:700;color:#86efac;line-height:1}
.bl{font-size:16px;color:rgba(255,255,255,.5);margin-top:4px}
.tw{flex:1;padding:34px 64px 0;overflow:hidden}
table{width:100%;border-collapse:collapse}
thead th{padding:0 0 16px;text-align:left;font-size:17px;font-weight:700;color:#8a847a;letter-spacing:.06em;text-transform:uppercase;border-bottom:2px solid #e0ddd6}
thead th:not(:first-child){text-align:center}
tbody tr{border-bottom:1.5px solid #e8e5de}
tbody tr:last-child{border-bottom:none}
tbody td{padding:18px 0;vertical-align:middle}
tbody td:not(:first-child){text-align:center}
.plat{display:flex;align-items:center;gap:13px}
.pi{width:46px;height:46px;border-radius:10px;color:#fff;font-size:19px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pn{font-size:24px;font-weight:700;color:#111}
.pt{font-size:17px;color:#8a847a;margin-top:2px}
.val{font-size:22px;font-weight:700;color:#111}
.vs{font-size:16px;color:#8a847a;margin-top:2px}
.pill{display:inline-block;padding:6px 14px;border-radius:7px;font-size:18px;font-weight:700;line-height:1}
.pill.red{background:#fee2e2;color:#b91c1c}.pill.green{background:#dcfce7;color:#166534}
.pill.yellow{background:#fef3c7;color:#92400e}.pill.gray{background:#f1f0ec;color:#555}
.rb{display:flex;flex-direction:column;align-items:center;gap:5px}
.rd{display:flex;gap:5px}
.dot{width:11px;height:11px;border-radius:50%;background:#e0ddd6}
.rl{font-size:15px;font-weight:600}
.ft{padding:26px 64px 38px;display:flex;justify-content:space-between;align-items:center;border-top:1.5px solid #e0ddd6;flex-shrink:0;margin-top:auto}
.fn{font-size:17px;color:#bbb}.fb{font-size:21px;font-weight:700;color:#1a4731}
.cta{background:#1a4731;color:#fff;font-size:19px;font-weight:700;padding:12px 26px;border-radius:10px}
</style></head><body>
<div class="pg">
  <div class="hdr">
    <div class="hl">${d.label||'E-commerce BTW 2026'}</div>
    <div class="ht">
      <div><div class="htitle">${d.title}</div>${d.subtitle?`<div class="hsub">${d.subtitle}</div>`:''}</div>
      ${d.badge?`<div class="badge"><div class="bv">${d.badge.value}</div><div class="bl">${d.badge.label}</div></div>`:''}
    </div>
  </div>
  <div class="tw"><table>
    <thead><tr><th style="width:30%">Platform</th>${cols}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="ft">
    <div class="fn">${d.source||'Bron: DAC7-richtlijn EU 2021/514'}</div>
    <div class="fb">zenbtw.nl</div>
    <div class="cta">Check mijn status →</div>
  </div>
</div>
</body></html>`;
}

// ── Template: REKENSOMMETJE ───────────────────────────────────────────────────
// Step-by-step calculation on dark green background
function REKENSOMMETJE(d) {
  const typeColor = { neutral: 'rgba(255,255,255,.75)', pos: '#86efac', warn: '#fbbf24', neg: '#f87171' };
  const rows = (d.rows || []).map(r => {
    if (r.divider) {
      const border = r.accent ? 'rgba(248,113,113,.3)' : 'rgba(255,255,255,.08)';
      return `<div class="div" style="border-color:${border}"></div>`;
    }
    const color = typeColor[r.type] || typeColor.neutral;
    const valSize = r.big ? '54px' : '40px';
    return `<div class="row">
      <div class="op">${r.op||''}</div>
      <div class="rl"><strong>${r.label}</strong><span>${r.desc||''}</span></div>
      <div class="rv" style="color:${color};font-size:${valSize}">${r.value}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}
body{background:#0d1a14;font-family:'Plus Jakarta Sans',sans-serif;color:#fff}
.glow1{position:absolute;top:-180px;left:-80px;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(26,71,49,.5) 0%,transparent 70%)}
.glow2{position:absolute;bottom:-250px;right:-80px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(10,50,30,.35) 0%,transparent 70%)}
.pg{position:relative;z-index:2;display:flex;flex-direction:column;height:100%;padding:60px 68px}
.tag{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:8px;padding:9px 16px;font-size:18px;font-weight:700;color:rgba(255,255,255,.55);letter-spacing:.1em;text-transform:uppercase;margin-bottom:24px;width:fit-content}
.title{font-family:'Fraunces',serif;font-size:${d.title_size||68}px;font-weight:700;line-height:1.05;letter-spacing:-2px;margin-bottom:10px}
.title em{color:#f87171;font-style:normal}
.sub{font-size:24px;color:rgba(255,255,255,.5);margin-bottom:44px}
.sc{background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.09);border-radius:13px;padding:24px 28px;display:flex;align-items:center;gap:24px;margin-bottom:30px;flex-shrink:0}
.si{font-size:42px;flex-shrink:0}
.sl strong{display:block;font-size:23px;font-weight:700;margin-bottom:3px}
.sl span{font-size:19px;color:rgba(255,255,255,.45)}
.steps{display:flex;flex-direction:column;gap:0;flex:1}
.row{display:flex;align-items:center;padding:18px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:20px}
.row:last-child{border-bottom:none}
.op{font-size:28px;color:rgba(255,255,255,.2);width:28px;text-align:center;flex-shrink:0}
.rl{flex:1}
.rl strong{display:block;font-size:23px;font-weight:600;color:rgba(255,255,255,.85)}
.rl span{font-size:18px;color:rgba(255,255,255,.38);margin-top:2px;display:block}
.rv{font-family:'Fraunces',serif;font-weight:700;text-align:right;min-width:200px;flex-shrink:0}
.div{height:2px;background:rgba(255,255,255,.08);border-top:2px solid;margin:4px 0}
.alert{background:rgba(248,113,113,.09);border:1.5px solid rgba(248,113,113,.25);border-radius:12px;padding:22px 26px;display:flex;align-items:flex-start;gap:16px;margin-top:24px;flex-shrink:0}
.ai{font-size:30px;flex-shrink:0;margin-top:1px}
.at strong{display:block;font-size:21px;font-weight:700;color:#fca5a5;margin-bottom:6px}
.at span{font-size:18px;color:rgba(255,255,255,.5);line-height:1.5}
.ft{padding-top:28px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0;margin-top:auto}
.fb{font-size:20px;font-weight:700;color:rgba(255,255,255,.28);letter-spacing:.12em;text-transform:uppercase}
.cta{background:#fff;color:#0d1a14;font-size:20px;font-weight:800;padding:13px 28px;border-radius:10px}
</style></head><body>
<div class="glow1"></div><div class="glow2"></div>
<div class="pg">
  <div class="tag">${d.tag||'⚠️ Rekenvoorbeeld'}</div>
  <div class="title">${d.title}</div>
  ${d.subtitle?`<div class="sub">${d.subtitle}</div>`:``}
  ${d.scenario?`<div class="sc"><div class="si">${d.scenario.icon||'📊'}</div><div class="sl"><strong>${d.scenario.label}</strong><span>${d.scenario.sub||''}</span></div></div>`:''}
  <div class="steps">${rows}</div>
  ${d.alert?`<div class="alert"><div class="ai">${d.alert.icon||'💡'}</div><div class="at"><strong>${d.alert.title}</strong><span>${d.alert.body}</span></div></div>`:''}
  <div class="ft"><div class="fb">ZenBTW</div><div class="cta">Check mijn situatie →</div></div>
</div>
</body></html>`;
}

// ── Template: TIJDLIJN ────────────────────────────────────────────────────────
// Month-by-month timeline with progress bars on cream background
function TIJDLIJN(d) {
  const STATUS = { safe: ['#1a4731','#1a4731','colored'], warn: ['#f59e0b','#f59e0b','warn'], danger: ['#ef4444','#ef4444','red'] };
  const months = (d.months || []).map((m, i, arr) => {
    const [dotC, lineC, lineCls] = STATUS[m.status||'safe'] || STATUS.safe;
    const barColor = m.status === 'danger' ? '#ef4444' : m.status === 'warn' ? '#f59e0b' : '#1a4731';
    const isLast = i === arr.length - 1;
    return `<div class="mo">
      <div class="ml">${m.label}</div>
      <div class="mt"><div class="md" style="border-color:${dotC};background:${dotC}"></div>${!isLast?`<div class="mline" style="background:${lineC}"></div>`:''}</div>
      <div class="mc">
        <div class="mcr">
          <div><div class="mct" style="color:${m.status==='danger'?'#ef4444':'#111'}">${m.title}</div><div class="mcs">${m.sub}</div></div>
          <div class="mca" style="color:${barColor}">${m.amount}</div>
        </div>
        <div class="bar"><div class="bf" style="width:${Math.min(m.pct||0,100)}%;background:${barColor}"></div></div>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}
body{background:#f7f6f3;font-family:'Plus Jakarta Sans',sans-serif}
.pg{display:flex;flex-direction:column;height:100%}
.hdr{background:#1a4731;padding:44px 64px 40px;flex-shrink:0}
.hl{font-size:17px;font-weight:700;color:rgba(255,255,255,.45);letter-spacing:.13em;text-transform:uppercase;margin-bottom:12px}
.hr{display:flex;justify-content:space-between;align-items:flex-end}
.htitle{font-family:'Fraunces',serif;font-size:60px;font-weight:700;color:#fff;line-height:1.05;letter-spacing:-1.5px;max-width:700px}
.htitle em{color:#86efac;font-style:normal}
.hbadge{text-align:right;flex-shrink:0}
.hbv{font-family:'Fraunces',serif;font-size:32px;font-weight:700;color:#86efac}
.hbs{font-size:17px;color:rgba(255,255,255,.45);margin-top:2px}
.body{flex:1;padding:38px 64px;display:flex;flex-direction:column;gap:0;overflow:hidden}
.mo{display:flex;align-items:stretch;gap:0}
.ml{width:88px;flex-shrink:0;font-size:20px;font-weight:700;color:#8a847a;padding-top:14px;text-align:right;padding-right:18px}
.mt{display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:36px}
.md{width:20px;height:20px;border-radius:50%;border:3px solid;position:relative;z-index:2;margin-top:12px;flex-shrink:0}
.mline{width:3px;flex:1;margin-top:4px;min-height:20px}
.mc{flex:1;padding:10px 0 10px 20px;min-height:72px}
.mcr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.mct{font-size:23px;font-weight:700;color:#111;margin-bottom:3px}
.mcs{font-size:18px;color:#8a847a}
.mca{font-family:'Fraunces',serif;font-size:30px;font-weight:700;text-align:right;flex-shrink:0}
.bar{height:7px;background:#e8e5de;border-radius:4px;overflow:hidden;margin-top:6px;margin-right:0}
.bf{height:100%;border-radius:4px;transition:width .3s}
.alt{margin:0 0 0 124px;background:#fee2e2;border:1.5px solid #fca5a5;border-radius:11px;padding:16px 20px;display:flex;align-items:flex-start;gap:12px}
.alti{font-size:24px;flex-shrink:0}
.altb strong{display:block;font-size:19px;font-weight:700;color:#b91c1c}
.altb span{font-size:17px;color:#7f1d1d;line-height:1.5;margin-top:3px;display:block}
.fix{display:flex;align-items:center;gap:0;margin-top:12px}
.fixl{width:88px;flex-shrink:0;font-size:19px;font-weight:700;color:#1a4731;padding-right:18px;text-align:right}
.fixm{display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:36px}
.fixd{width:20px;height:20px;border-radius:50%;background:#1a4731;flex-shrink:0;margin-top:2px}
.fixc{flex:1;padding:0 0 0 20px;display:flex;justify-content:space-between;align-items:center}
.fixt{font-size:22px;font-weight:700;color:#1a4731}
.fixa{font-family:'Fraunces',serif;font-size:28px;font-weight:700;color:#1a4731}
.ft{padding:24px 64px 38px;display:flex;justify-content:space-between;align-items:center;border-top:1.5px solid #e0ddd6;flex-shrink:0;margin-top:auto}
.fn{font-size:17px;color:#bbb}.fb{font-size:21px;font-weight:700;color:#1a4731}
.cta{background:#1a4731;color:#fff;font-size:19px;font-weight:700;padding:12px 24px;border-radius:10px}
</style></head><body>
<div class="pg">
  <div class="hdr">
    <div class="hl">${d.label||'Tijdlijn 2026'}</div>
    <div class="hr">
      <div class="htitle">${d.title}</div>
      <div class="hbadge"><div class="hbv">KOR-grens</div><div class="hbs">€20.000 / jaar</div></div>
    </div>
  </div>
  <div class="body">
    ${months}
    ${d.alert?`<div class="alt"><div class="alti">⚠️</div><div class="altb"><strong>${d.alert.title}</strong><span>${d.alert.body}</span></div></div>`:''}
    ${d.fix?`<div class="fix"><div class="fixl">✓ Fix</div><div class="fixm"><div class="fixd"></div></div><div class="fixc"><div class="fixt">${d.fix.title}</div><div class="fixa">${d.fix.amount}</div></div></div>`:''}
  </div>
  <div class="ft">
    <div class="fn">${d.source||'Bron: Belastingdienst · belastingdienst.nl'}</div>
    <div class="fb">zenbtw.nl</div>
    <div class="cta">Check mijn status →</div>
  </div>
</div>
</body></html>`;
}

// ── Template: CHECKLIST ───────────────────────────────────────────────────────
// Decision checklist on dark green brand background
function CHECKLIST(d) {
  const items = (d.items || []).map(it => {
    const note = it.warn
      ? `<div class="note warn">${it.warn}</div>`
      : it.good
      ? `<div class="note good">${it.good}</div>`
      : '';
    return `<div class="item">
      <div class="iq">${it.q}</div>
      ${note}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}
body{background:#1a4731;font-family:'Plus Jakarta Sans',sans-serif;color:#fff;position:relative}
.dots{position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.05) 1px,transparent 1px);background-size:38px 38px;pointer-events:none}
.pg{position:relative;z-index:2;display:flex;flex-direction:column;height:100%;padding:64px 72px}
.tag{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:9px 18px;font-size:18px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.65);margin-bottom:26px;width:fit-content}
.title{font-family:'Fraunces',serif;font-size:${d.title_size||76}px;font-weight:700;line-height:1.06;letter-spacing:-2px;margin-bottom:10px}
.title em{color:#86efac;font-style:normal}
.sub{font-size:26px;color:rgba(255,255,255,.5);margin-bottom:44px}
.items{display:flex;flex-direction:column;gap:20px;flex:1}
.item{background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.1);border-radius:14px;padding:22px 26px}
.iq{font-size:26px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:10px}
.note{font-size:20px;font-weight:600;padding:8px 14px;border-radius:8px;line-height:1.4}
.note.warn{background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.25);color:#fbbf24}
.note.good{background:rgba(134,239,172,.12);border:1px solid rgba(134,239,172,.25);color:#86efac}
.result{background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.15);border-radius:14px;padding:22px 26px;display:flex;align-items:center;gap:18px;margin-top:4px;flex-shrink:0}
.ri{font-size:36px}
.rl strong{display:block;font-size:24px;font-weight:700;color:#fff}
.rl span{font-size:19px;color:rgba(255,255,255,.5);margin-top:3px;display:block}
.ft{padding-top:32px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,.1);flex-shrink:0;margin-top:auto}
.fb{font-size:22px;font-weight:700;color:rgba(255,255,255,.3);letter-spacing:.12em;text-transform:uppercase}
.cta{background:#fff;color:#1a4731;font-size:21px;font-weight:800;padding:14px 30px;border-radius:11px}
</style></head><body>
<div class="dots"></div>
<div class="pg">
  <div class="tag">${d.tag||'Checklist 2026'}</div>
  <div class="title">${d.title}</div>
  ${d.subtitle?`<div class="sub">${d.subtitle}</div>`:''}
  <div class="items">${items}</div>
  ${d.result_yes?`<div class="result"><div class="ri">✅</div><div class="rl"><strong>${d.result_yes.label}</strong><span>${d.result_yes.sub}</span></div></div>`:''}
  <div class="ft"><div class="fb">ZenBTW</div><div class="cta">${d.cta||'Check mijn status →'}</div></div>
</div>
</body></html>`;
}

// ── Template: MYTH ────────────────────────────────────────────────────────────
// Myth vs reality side-by-side on cream background
function MYTH(d) {
  const myths = (d.myths || []).map(m => `
    <div class="pair">
      <div class="mrow"><div class="micon">❌</div><div class="mtext"><div class="mlabel">Mythe</div><div class="mq">${m.myth}</div></div></div>
      <div class="rrow"><div class="ricon">✅</div><div class="rtext"><div class="rlabel">Werkelijkheid</div><div class="rq">${m.reality}</div></div></div>
    </div>`).join('');

  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}
body{background:#f7f6f3;font-family:'Plus Jakarta Sans',sans-serif}
.lbar{position:absolute;top:0;left:0;width:10px;height:100%;background:#1a4731}
.pg{display:flex;flex-direction:column;height:100%;padding:60px 72px 60px 86px}
.tag{display:inline-block;background:#1a4731;color:#fff;font-size:18px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:8px 18px;border-radius:6px;margin-bottom:22px;width:fit-content}
.title{font-family:'Fraunces',serif;font-size:${d.title_size||68}px;font-weight:700;color:#111;line-height:1.06;letter-spacing:-2px;margin-bottom:36px}
.title em{color:#1a4731;font-style:normal}
.pairs{display:flex;flex-direction:column;gap:22px;flex:1}
.pair{display:flex;flex-direction:column;gap:0;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.mrow{display:flex;align-items:flex-start;gap:16px;background:#fee2e2;padding:20px 24px}
.micon{font-size:26px;flex-shrink:0;margin-top:2px}
.mtext .mlabel{font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b91c1c;margin-bottom:5px}
.mq{font-size:22px;font-weight:600;color:#7f1d1d;line-height:1.35}
.rrow{display:flex;align-items:flex-start;gap:16px;background:#dcfce7;padding:20px 24px}
.ricon{font-size:26px;flex-shrink:0;margin-top:2px}
.rtext .rlabel{font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#166534;margin-bottom:5px}
.rq{font-size:22px;font-weight:600;color:#14532d;line-height:1.35}
.ft{padding-top:28px;display:flex;justify-content:space-between;align-items:center;border-top:1.5px solid #e0ddd6;flex-shrink:0;margin-top:auto}
.fb{font-size:21px;font-weight:700;color:#1a4731}
.cta{background:#1a4731;color:#fff;font-size:19px;font-weight:700;padding:12px 24px;border-radius:10px}
</style></head><body>
<div class="lbar"></div>
<div class="pg">
  <div class="tag">${d.label||'Veelgemaakte fout'}</div>
  <div class="title">${d.title}</div>
  <div class="pairs">${myths}</div>
  <div class="ft"><div class="fb">zenbtw.nl</div><div class="cta">Check mijn status →</div></div>
</div>
</body></html>`;
}

// ── Template router ───────────────────────────────────────────────────────────
function render(template, data) {
  switch (template) {
    case 'compare':       return COMPARE(data);
    case 'rekensommetje': return REKENSOMMETJE(data);
    case 'tijdlijn':      return TIJDLIJN(data);
    case 'checklist':     return CHECKLIST(data);
    case 'myth':          return MYTH(data);
    default:              return COMPARE(data);
  }
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(topic, templateHint) {
  const templ = templateHint && templateHint !== 'auto' ? templateHint : null;

  return `Je bent een Nederlandse BTW-expert die informatieve social media posters maakt voor ZenBTW (zenbtw.nl). Jouw doelgroep: marketplace-verkopers op Vinted, Etsy, Bol.com, Shopify die meer willen weten over BTW, KOR en DAC7.

Genereer een reelposter over: "${topic}"

${templ ? `Gebruik template: "${templ}"` : `Kies het best passende template:
- "compare": vergelijkingstabel platforms/regels
- "rekensommetje": stap-voor-stap berekening (dark achtergrond)
- "tijdlijn": maand-voor-maand tijdlijn met progressiebalk
- "checklist": beslischecklist (donkergroen achtergrond)
- "myth": mythe vs. werkelijkheid (3 paren)`}

FEITELIJKE NAUWKEURIGHEID — VERPLICHT:
- KOR-grens NL: €20.000 per jaar. Overschrijding heeft GEEN terugwerkende kracht. Eerdere omzet blijft vrijgesteld.
- Bij overschrijding: BTW-plicht per direct, vanaf die transactie — NIET met terugwerkende kracht.
- Wachttermijn na overschrijding/afmelding: rest lopend jaar + volledig volgend jaar. NIET 3 jaar.
- DAC7-drempel: 30 transacties EN €2.000 omzet (beide moeten gelden).
- OSS-drempel EU: €10.000 over alle EU-landen samen.
- BTW-tarief kleding/tweedehands: 21%.
- Verwijs nooit naar specifieke artikelURLs van belastingdienst.nl.

JSON SCHEMA per template:

compare:
{ "template": "compare", "label": "label bovenin header", "title": "titel met evt <em>groen</em>", "subtitle": "ondertitel", "badge": { "value": "€20K", "label": "KOR-grens" }, "columns": ["col1","col2","col3","col4"], "rows": [{ "name": "Platform", "letter": "V", "color": "#hex", "type": "type omschrijving", "drempel": "30 items", "drempel_sub": "of €2.000", "kor": true, "bd_melding": "automatisch", "risico": "Hoog" }], "source": "Bron: ..." }
- kor: true/false/string, bd_melding: "automatisch"/"Zelf aangifte"/"Nvt", risico: "Hoog"/"Middel"/"Laag"/"Nvt"

rekensommetje:
{ "template": "rekensommetje", "tag": "tag tekst", "title": "titel met evt <em>rood</em>", "subtitle": "ondertitel", "scenario": { "icon": "🛍️", "label": "Jouw situatie", "sub": "details" }, "rows": [ { "label": "naam", "desc": "toelichting", "value": "€ X.XXX", "type": "neutral|pos|warn|neg", "op": "−|×|=|" }, { "divider": true }, { "label": "naam", "desc": "...", "value": "...", "type": "neg", "big": true, "op": "" } ], "alert": { "icon": "💡", "title": "...", "body": "..." } }

tijdlijn:
{ "template": "tijdlijn", "label": "context label", "title": "titel met evt <em>groen</em>", "months": [ { "label": "Jan", "title": "beschrijving", "sub": "Cumulatief: €X", "amount": "€ X.XXX", "pct": 10, "status": "safe|warn|danger" } ], "alert": { "title": "...", "body": "..." }, "fix": { "title": "Wat had je moeten doen", "amount": "€ 0 BTW" }, "source": "Bron: ..." }
- Gebruik 4-5 maanden. Laatste maand is altijd "danger" (grens overschreden). Pct 0-100.

checklist:
{ "template": "checklist", "tag": "tag", "title": "vraag als titel", "subtitle": "context", "items": [ { "q": "vraag", "warn": "waarschuwing (oranje)" }, { "q": "vraag", "good": "goed nieuws (groen)" } ], "result_yes": { "label": "Als alles klopt:", "sub": "Dan ben je waarschijnlijk veilig — maar check je status." }, "cta": "Check mijn status →" }
- Gebruik 4-5 items. Mix van warn en good.

myth:
{ "template": "myth", "label": "tag bovenin", "title": "titel met evt <em>groen</em>", "myths": [ { "myth": "Wat mensen denken (cursief klopt niet)", "reality": "Wat echt geldt (concreet, kort)" } ] }
- Precies 3 mythes. Mythe: bondig en herkenbaar. Werkelijkheid: feitelijk en direct.

Geef ALLEEN de JSON terug — geen uitleg, geen markdown, geen codeblok.`;
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function screenshot(browser, htmlPath, pngPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  await page.close();
}

// ── Description generator ─────────────────────────────────────────────────────
async function generateDescription(topic, template, client) {
  const prompt = `Schrijf een Threads-beschrijving voor een informatieve reelposter van @zenbtw over: "${topic}" (template: ${template})

Vereisten:
- MAXIMAAL 480 tekens inclusief alles
- Persoonlijk en concreet — geen marketing-taal
- 1-2 zinnen die de kern raken
- 1 zachte CTA (bijv. "Check zenbtw.nl" of "Link in bio")
- 3-4 hashtags (#BTW #KOR #marketplace etc.)
- Nederlands

Tel zorgvuldig. Strikt onder 480 tekens.
Geef ALLEEN de beschrijving terug.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = msg.content[0].text.trim();
    if (text.length > 500) text = text.slice(0, 497) + '…';
    return text;
  } catch (e) {
    console.warn(`  ⚠️  Description failed: ${e.message}`);
    return '';
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY is not set'); process.exit(1); }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const data     = loadTopics();
  const manifest = loadManifest();
  const queue    = pending(data);
  const maxRun   = data.settings?.maxPerRun || 4;

  if (!queue.length) { console.log('✅ No pending topics — queue is empty'); process.exit(0); }

  const toProcess = queue.slice(0, maxRun);
  console.log(`\n🎬 Generating ${toProcess.length} reelposter(s)...\n`);

  const client  = new Anthropic();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  for (const item of toProcess) {
    console.log(`\n📌 "${item.topic}" [${item.template||'auto'}]`);
    console.log('  Calling Claude...');

    let posterData;
    try {
      const msg = await client.messages.create({
        model: data.settings?.model || 'claude-sonnet-4-6',
        max_tokens: 1800,
        messages: [{ role: 'user', content: buildPrompt(item.topic, item.template) }],
      });
      const raw = msg.content[0].text.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      posterData = JSON.parse(raw);
    } catch (err) {
      console.error(`  ❌ Claude/parse error: ${err.message}`);
      continue;
    }

    const usedTemplate = posterData.template || item.template || 'compare';
    const setId  = `${TODAY}-${item.slug}`;
    const setDir = path.join(OUT_DIR, setId);
    fs.mkdirSync(setDir, { recursive: true });

    const htmlPath = path.join(setDir, 'poster.html');
    const pngPath  = path.join(setDir, 'poster.png');

    fs.writeFileSync(htmlPath, render(usedTemplate, posterData), 'utf8');
    await screenshot(browser, htmlPath, pngPath);
    console.log(`  📸 poster.png`);

    console.log('  Generating description...');
    const description = await generateDescription(item.topic, usedTemplate, client);
    if (description) {
      fs.writeFileSync(path.join(setDir, 'description.txt'), description, 'utf8');
      console.log(`  📝 ${description.length} tekens`);
    }

    manifest.sets.unshift({
      id: setId,
      topic: item.topic,
      date: TODAY,
      template: usedTemplate,
      file: `reelposters/${setId}/poster.html`,
      png: `reelposters/${setId}/poster.png`,
      description,
      threadsDescription: description,
    });

    const idx = data.queue.findIndex(t => t.slug === item.slug);
    data.queue[idx].status = 'published';
    data.queue[idx].publishedDate = TODAY;
    data.queue[idx].outputDir = `reelposters/${setId}`;
    data.published.push(data.queue[idx]);
    data.queue.splice(idx, 1);

    console.log(`  ✅ Saved to reelposters/${setId}/`);
  }

  await browser.close();
  saveManifest(manifest);
  saveTopics(data);
  console.log(`\n🎉 Done! ${toProcess.length} poster(s) generated.`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
