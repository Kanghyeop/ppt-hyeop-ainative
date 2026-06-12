const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const puppeteer = require('puppeteer-core');

const PORT = 7744;
const ROOT = __dirname;

// 시스템 Chrome/Edge 자동 탐색 (Windows)
function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

// Puppeteer lazy singleton
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    const executablePath = findBrowserExecutable();
    if (!executablePath) {
      throw new Error('시스템 Chrome/Edge를 찾을 수 없습니다. 환경변수 CHROME_PATH 를 설정하거나 Edge/Chrome을 설치하세요.');
    }
    browserPromise = puppeteer.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).catch(err => { browserPromise = null; throw err; });
  }
  return browserPromise;
}

// SSE 큐잉 (PDF 생성 중 해당 deck 의 이벤트 버퍼링)
const sseQueue = {}; // deckPath -> payload[]
function pauseSse(deckPath) { sseQueue[deckPath] = []; }
function resumeSse(deckPath) {
  const buf = sseQueue[deckPath];
  delete sseQueue[deckPath];
  if (!buf || !buf.length) return;
  const last = buf[buf.length - 1]; // 최신 1개만 적용
  (clients[deckPath] || []).forEach(r => { try { r.write(last); } catch {} });
}
function broadcastSse(deckPath, payload) {
  if (sseQueue[deckPath]) { sseQueue[deckPath].push(payload); return; }
  (clients[deckPath] || []).forEach(r => { try { r.write(payload); } catch {} });
}

// PID 파일
const PID_FILE = path.join(ROOT, '.server.pid');
fs.writeFileSync(PID_FILE, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });

// HTML 템플릿
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
let TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

// style.md 파싱 → CSS 변수
const STYLE_PATH = path.join(ROOT, 'style.md');
let STYLE_CSS = '';

function parseStyleMd() {
  try {
    const text = fs.readFileSync(STYLE_PATH, 'utf-8');
    const rootVars = [];
    const typeBlocks = {};
    let currentType = null;

    for (const line of text.split('\n')) {
      // ## @typea 형태의 커스텀 타입 섹션 감지
      const typeMatch = line.match(/^##\s+@(\w+)/);
      if (typeMatch) {
        currentType = typeMatch[1];
        typeBlocks[currentType] = [];
        continue;
      }
      // 다른 ## 섹션이면 커스텀 타입 종료
      if (/^##\s+[^@]/.test(line)) {
        currentType = null;
      }
      const m = line.match(/^-\s+([\w-]+):\s*(.+)$/);
      if (m) {
        if (currentType) {
          typeBlocks[currentType].push(`  --${m[1]}: ${m[2].trim()};`);
        } else {
          rootVars.push(`  --${m[1]}: ${m[2].trim()};`);
        }
      }
    }

    let css = `:root {\n${rootVars.join('\n')}\n}`;
    for (const [type, vars] of Object.entries(typeBlocks)) {
      css += `\n.slide-${type} {\n${vars.join('\n')}\n}`;
    }
    STYLE_CSS = css;
    console.log(`style.md 파싱 완료 (${rootVars.length}개 변수, ${Object.keys(typeBlocks).length}개 커스텀 타입)`);
  } catch {}
}
parseStyleMd();

// style.md 변경 감시
fs.watch(STYLE_PATH, () => {
  parseStyleMd();
  // SSE로 모든 클라이언트에 스타일 변경 알림 (PDF 생성 중 deck 은 pauseSse 로 버퍼링됨)
  const payload = `data: "style-reload"\n\n`;
  for (const folder of Object.keys(clients)) {
    broadcastSse(folder, payload);
  }
  console.log('style.md 변경 → 스타일 반영');
});

// template.html 변경 감시 → 모든 deck 에 재배포
fs.watch(TEMPLATE_PATH, () => {
  try {
    TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    for (const deckPath of getContentFolders()) {
      const basename = path.basename(deckPath);
      fs.writeFileSync(path.join(ROOT, deckPath, `${basename}.html`), TEMPLATE);
    }
    console.log('template.html 변경 → 모든 폴더에 반영');
  } catch {}
});

// 폴더별 SSE 클라이언트
const clients = {};

// 중첩 deck 지원: 어느 depth 에 있든 비-예외 디렉터리는 deck 후보
// 디렉터리 자체가 deck = {dir}/{basename}.md 소유 (initFolder 가 없으면 생성)
const EXCLUDED_ANY = new Set(['assets', 'node_modules', 'lib', 'memory']);
const EXCLUDED_ROOT = new Set(['note', 'scripts']);

function getContentFolders() {
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

// style.md에서 커스텀 타입 목록 추출 (이름:설명)
function getCustomTypes() {
  try {
    const text = fs.readFileSync(STYLE_PATH, 'utf-8');
    const types = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^##\s+@(\w+)\s*(?:\((.+?)\))?/);
      if (m) types.push({ name: m[1], desc: m[2] || '' });
    }
    return types;
  } catch { return []; }
}

// 폴더 초기화: html 생성, md 없으면 생성. deckPath 는 ROOT 기준 POSIX 상대경로
function initFolder(deckPath) {
  const dir = path.join(ROOT, deckPath);
  const basename = path.basename(deckPath);
  fs.writeFileSync(path.join(dir, `${basename}.html`), TEMPLATE);
  const mdPath = path.join(dir, `${basename}.md`);
  if (!fs.existsSync(mdPath)) {
    const types = getCustomTypes();
    const typeComment = types.length
      ? `<!--\n${types.map(t => `@${t.name}\n\n내용\n\n---\n`).join('\n')}\n-->\n\n`
      : '';
    fs.writeFileSync(mdPath, `${typeComment}# ${basename}\n\n---\n\n내용을 입력하세요.\n`);
  }
}

// deckPath 디렉터리 내 파일명 정리: stray html → {basename}.html 로 재명명
function syncFilenames(deckPath) {
  const dir = path.join(ROOT, deckPath);
  const basename = path.basename(deckPath);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const strayHtml = entries.filter(e => e.isFile() && e.name.endsWith('.html') && e.name !== `${basename}.html`);
  for (const old of strayHtml) {
    fs.renameSync(path.join(dir, old.name), path.join(dir, `${basename}.html`));
  }
  // md 파일은 memo 등 부가 파일이 있을 수 있으므로 리네임하지 않음
}

// 초기 설정
let folders = getContentFolders();
for (const folder of folders) {
  clients[folder] = [];
  syncFilenames(folder);
  initFolder(folder);
}

// deckPath 의 메인 md 변경 감시. 자식 deck 은 각자 watchFolder 가짐 → recursive: false
function watchFolder(deckPath) {
  const dir = path.join(ROOT, deckPath);
  const basename = path.basename(deckPath);
  const mainMd = `${basename}.md`;
  fs.watch(dir, { recursive: false }, (event, filename) => {
    if (filename !== mainMd) return;
    try {
      const full = path.join(dir, mainMd);
      if (!fs.existsSync(full)) return;
      const result = [{ file: mainMd, content: fs.readFileSync(full, 'utf-8') }];
      broadcastSse(deckPath, `data: ${JSON.stringify(result)}\n\n`);
    } catch {}
  });
}

for (const folder of folders) {
  watchFolder(folder);
}

// 루트 감시: 중첩 deck 추가/리네임 감지 (recursive)
fs.watch(ROOT, { recursive: true }, (event, filename) => {
  if (!filename) return;
  const norm = filename.split(path.sep).join('/');
  if (norm.startsWith('.')) return;
  // 개별 deck 의 md/html 변경은 watchFolder / template watcher 가 처리
  if (norm.endsWith('.md') || norm.endsWith('.html')) return;
  const newFolders = getContentFolders();
  const added = newFolders.filter(f => !folders.includes(f));
  for (const deckPath of added) {
    clients[deckPath] = [];
    syncFilenames(deckPath);
    initFolder(deckPath);
    watchFolder(deckPath);
  }
  folders = newFolders;
});

// MIME 타입
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  // longest-prefix deck 매칭 — 중첩 폴더 지원
  let deckMatch = null;
  for (let len = parts.length; len > 0; len--) {
    const candidate = parts.slice(0, len).join('/');
    if (folders.includes(candidate)) {
      deckMatch = { deckPath: candidate, rest: parts.slice(len) };
      break;
    }
  }

  // /deckPath → /deckPath/{basename}.html
  if (deckMatch && deckMatch.rest.length === 0) {
    const { deckPath } = deckMatch;
    const basename = path.basename(deckPath);
    const encodedDeck = deckPath.split('/').map(encodeURIComponent).join('/');
    res.writeHead(302, { Location: `/${encodedDeck}/${encodeURIComponent(basename)}.html` });
    res.end();
    return;
  }

  // SSE: /deckPath/events
  if (deckMatch && deckMatch.rest.length === 1 && deckMatch.rest[0] === 'events') {
    const { deckPath } = deckMatch;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    clients[deckPath] = clients[deckPath] || [];
    clients[deckPath].push(res);
    req.on('close', () => { clients[deckPath] = (clients[deckPath] || []).filter(c => c !== res); });
    return;
  }

  // files API: /deckPath/files
  if (deckMatch && deckMatch.rest.length === 1 && deckMatch.rest[0] === 'files') {
    const { deckPath } = deckMatch;
    const dir = path.join(ROOT, deckPath);
    const basename = path.basename(deckPath);
    const mainMd = `${basename}.md`;
    const result = [{
      file: mainMd,
      content: fs.readFileSync(path.join(dir, mainMd), 'utf-8'),
    }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // PDF 생성: /deckPath/pdf (Puppeteer 서버사이드)
  if (deckMatch && deckMatch.rest.length === 1 && deckMatch.rest[0] === 'pdf') {
    const { deckPath } = deckMatch;
    const basename = path.basename(deckPath);
    if (!findBrowserExecutable()) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('시스템 Chrome/Edge 를 찾을 수 없습니다. 환경변수 CHROME_PATH 를 설정하거나 Edge/Chrome 을 설치하세요.');
      return;
    }
    pauseSse(deckPath);
    const tmpPath = path.join(os.tmpdir(), `deck-${crypto.randomBytes(8).toString('hex')}.pdf`);
    const t0 = Date.now();
    const stage = (label) => console.log(`[PDF] ${deckPath} [${((Date.now()-t0)/1000).toFixed(1)}s] ${label}`);
    (async () => {
      let page;
      try {
        stage('브라우저 준비');
        const browser = await getBrowser();
        page = await browser.newPage();
        const encodedDeck = deckPath.split('/').map(encodeURIComponent).join('/');
        const url = `http://localhost:${PORT}/${encodedDeck}/${encodeURIComponent(basename)}.html?pdf=1`;
        // 콘솔 로그 포워딩 (template.html 의 renderSlides 진행이 서버 콘솔에 표시됨)
        page.on('console', msg => {
          const text = msg.text();
          if (text.startsWith('[__deckReady') || text.startsWith('[PDF')) {
            console.log(`  [page] ${text}`);
          }
        });
        stage('페이지 로드 시작');
        // SSE(EventSource) 지속 연결 때문에 networkidle 은 never-trigger.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        stage('DOM 로드 완료 → 렌더 대기');
        await page.waitForFunction(() => window.__deckReady === true, { timeout: 180000, polling: 500 });
        const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
        stage(`렌더 완료 (${slideCount}장) → page.pdf() 호출`);
        await page.pdf({
          path: tmpPath,
          width: '1365px', height: '1024px',
          printBackground: true, preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        stage('page.pdf() 완료 → 스트리밍');
        const stat = fs.statSync(tmpPath);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename)}.pdf`,
          'Content-Length': stat.size,
        });
        const stream = fs.createReadStream(tmpPath);
        stream.pipe(res);
        stream.on('close', () => { try { fs.unlinkSync(tmpPath); } catch {} });
        stage(`ok size=${(stat.size/1024/1024).toFixed(1)}MB slides=${slideCount}`);
      } catch (err) {
        console.error(`[PDF] ${deckPath} [${((Date.now()-t0)/1000).toFixed(1)}s] fail:`, err.message);
        try { fs.unlinkSync(tmpPath); } catch {}
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`PDF 생성 실패: ${err.message}`);
        }
      } finally {
        if (page) { try { await page.close(); } catch {} }
        resumeSse(deckPath);
      }
    })();
    return;
  }

  // style.css (style.md에서 생성)
  if (url.pathname === '/style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(STYLE_CSS);
    return;
  }

  // 루트: deck 트리 뷰
  if (url.pathname === '/') {
    const currentFolders = getContentFolders().slice().sort();
    const links = currentFolders.map(f => {
      const encoded = f.split('/').map(encodeURIComponent).join('/');
      const depth = f.split('/').length - 1;
      const label = f.split('/').slice(-1)[0];
      const fontSize = depth === 0 ? 18 : 15;
      const padding = depth === 0 ? '12px 24px' : '8px 20px';
      const opacity = depth === 0 ? 1 : 0.85;
      return `<a href="/${encoded}" style="color:#333;font-size:${fontSize}px;text-decoration:none;padding:${padding};background:#f0f0f0;border-radius:8px;border:1px solid #ddd;margin-left:${depth * 28}px;opacity:${opacity};">${label}</a>`;
    }).join('');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>슬라이드</title></head><body style="background:#fff;display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:40px 60px;font-family:Pretendard,sans-serif;">${links}</body></html>`);
    return;
  }

  // 정적 파일 (없으면 볼트 전체에서 검색 - 옵시디언 ![[file]] 호환)
  const filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, data) => {
    if (!err) {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
      return;
    }
    // 파일 못 찾으면 이미지 폴더에서 검색
    // 요청 URL의 첫 폴더(예: /1주차/...)에 폴더별 assets/가 있으면 우선 탐색
    const filename = path.basename(decodeURIComponent(url.pathname));
    const imageDirs = [];
    // 현재 deck 및 상위 deck 의 assets/ 를 우선 탐색
    if (deckMatch) {
      imageDirs.push(path.join(deckMatch.deckPath, 'assets'));
      const segs = deckMatch.deckPath.split('/');
      for (let i = segs.length - 1; i > 0; i--) {
        const ancestor = segs.slice(0, i).join('/');
        imageDirs.push(path.join(ancestor, 'assets'));
      }
    }
    // 공용 이미지 저장소 (루트 assets/)
    imageDirs.push('assets');
    const findFileRecursive = (dir, target) => {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === target) return full;
        if (entry.isDirectory()) {
          const found = findFileRecursive(full, target);
          if (found) return found;
        }
      }
      return null;
    };
    for (const dir of imageDirs) {
      const found = findFileRecursive(path.join(ROOT, dir), filename);
      if (found) {
        const cData = fs.readFileSync(found);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(cData);
        return;
      }
    }
    res.writeHead(404);
    res.end('Not found');
  });
});

server.listen(PORT, () => {
  console.log(`슬라이드 서버: http://localhost:${PORT}`);
  console.log(`폴더: ${folders.join(', ')}`);
  const execPath = findBrowserExecutable();
  if (execPath) {
    console.log(`PDF 엔진: ${execPath}`);
  } else {
    console.log('PDF 엔진: 시스템 Chrome/Edge 미발견 (환경변수 CHROME_PATH 설정 시 활성화)');
  }
});

// async 종료 핸들러: SIGINT/SIGTERM 으로 Puppeteer 브라우저를 정상 종료
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] 서버 종료 중...`);
  try {
    if (browserPromise) {
      const b = await browserPromise;
      await b.close();
    }
  } catch (err) {
    console.error('브라우저 종료 실패:', err.message);
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
