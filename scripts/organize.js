// 이미지 정리 도구
// 각 덱(md)이 참조하는 이미지를 해당 덱의 assets/로 모으고, 어디서도 참조되지 않는 이미지를 보고한다.
//
// 사용법:
//   node scripts/organize.js          # 드라이런: 이동 계획 + 미참조 이미지 보고만
//   node scripts/organize.js --apply  # 참조 이미지를 실제로 각 덱 assets/로 이동
//
// 미참조 이미지는 --apply 에서도 건드리지 않는다 (사용자에게 물어보고 처리할 것).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const EXCLUDED_ANY = new Set(['assets', 'node_modules', 'lib', 'memory']);
const EXCLUDED_ROOT = new Set(['note', 'scripts']);

// 덱 폴더 수집 (server.js 와 동일 규칙)
function getDecks() {
  const result = [];
  const walk = (relPath) => {
    const absPath = relPath ? path.join(ROOT, relPath) : ROOT;
    let entries;
    try { entries = fs.readdirSync(absPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (EXCLUDED_ANY.has(entry.name)) continue;
      if (relPath === '' && EXCLUDED_ROOT.has(entry.name)) continue;
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      result.push(childRel);
      walk(childRel);
    }
  };
  walk('');
  return result;
}

// md에서 이미지 참조 추출: ![[file]] / ![alt](src)
function extractRefs(mdText) {
  // 렌더러(template.html)와 동일하게 HTML 주석은 슬라이드가 아니므로 제외
  mdText = mdText.replace(/<!--[\s\S]*?-->/g, '');
  const refs = [];
  for (const m of mdText.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    refs.push(decodeURIComponent(m[1].trim()));
  }
  for (const m of mdText.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const src = m[1].trim();
    if (/^https?:\/\//.test(src)) continue;
    refs.push(decodeURIComponent(src.split('/').pop()));
  }
  return refs;
}

// 프로젝트 전체 이미지 인덱싱 (basename -> 절대경로[])
function indexImages() {
  const map = new Map();
  const walk = (abs) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'lib') continue;
        walk(full);
      } else if (IMG_EXT.has(path.extname(e.name).toLowerCase())) {
        if (!map.has(e.name)) map.set(e.name, []);
        map.get(e.name).push(full);
      }
    }
  };
  walk(ROOT);
  return map;
}

// deck별 참조 수집
const decks = getDecks();
const refsByDeck = {}; // deckRel -> Set(basename)
const refCount = new Map(); // basename -> Set(deckRel)
for (const deck of decks) {
  const basename = path.basename(deck);
  const mdPath = path.join(ROOT, deck, `${basename}.md`);
  if (!fs.existsSync(mdPath)) continue;
  const refs = extractRefs(fs.readFileSync(mdPath, 'utf-8'));
  refsByDeck[deck] = new Set(refs);
  for (const r of refs) {
    if (!refCount.has(r)) refCount.set(r, new Set());
    refCount.get(r).add(deck);
  }
}

const images = indexImages();
const moves = [];      // { from, to, deck }
const missing = [];    // { deck, ref }
const unreferenced = []; // 절대경로

// 1) 참조 이미지: 해당 덱 폴더 밖에 있으면 deck/assets/ 로 이동 계획
for (const [name, deckSet] of refCount) {
  const locations = images.get(name) || [];
  if (!locations.length) {
    for (const d of deckSet) missing.push({ deck: d, ref: name });
    continue;
  }
  if (deckSet.size !== 1) continue; // 여러 덱이 공유 → 현 위치 유지 (보통 루트 assets/)
  const deck = [...deckSet][0];
  const deckDir = path.join(ROOT, deck);
  const already = locations.some(loc => loc.startsWith(deckDir + path.sep));
  if (already) continue;
  moves.push({ from: locations[0], to: path.join(deckDir, 'assets', name), deck });
}

// 2) 미참조 이미지: 어떤 md도 참조하지 않는 이미지 (덱 폴더/루트 assets 안 포함)
for (const [name, locations] of images) {
  if (refCount.has(name)) continue;
  for (const loc of locations) {
    unreferenced.push(path.relative(ROOT, loc));
  }
}

// 보고
console.log(`덱 ${decks.length}개 · 이미지 파일 ${[...images.values()].flat().length}개 스캔`);
console.log('');
if (moves.length) {
  console.log(`[이동 ${APPLY ? '실행' : '계획'}] 참조 이미지 ${moves.length}건 → 각 덱 assets/`);
  for (const mv of moves) {
    console.log(`  ${path.relative(ROOT, mv.from)} → ${path.relative(ROOT, mv.to)}`);
    if (APPLY) {
      fs.mkdirSync(path.dirname(mv.to), { recursive: true });
      fs.renameSync(mv.from, mv.to);
    }
  }
} else {
  console.log('[이동] 필요 없음 - 모든 참조 이미지가 제자리에 있음');
}
console.log('');
if (missing.length) {
  console.log(`[경고] md가 참조하지만 파일이 없는 이미지 ${missing.length}건`);
  for (const m of missing) console.log(`  ${m.deck}: ${m.ref}`);
  console.log('');
}
if (unreferenced.length) {
  console.log(`[미참조] 어떤 덱도 호출하지 않는 이미지 ${unreferenced.length}건 (자동으로 옮기지 않음 - 어떻게 할지 정해주세요)`);
  for (const u of unreferenced) console.log(`  ${u}`);
} else {
  console.log('[미참조] 없음');
}
if (!APPLY && moves.length) {
  console.log('\n실제 이동하려면: node scripts/organize.js --apply');
}
