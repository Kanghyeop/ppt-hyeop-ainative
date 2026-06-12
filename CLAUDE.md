# ppt-hyeop-ainative (PPT 협 AI Native) - Claude용 내부 명세

이것은 스킬이 아니라 **일반 소프트웨어**다(마크다운 → 강의 슬라이드 실시간 렌더링 + 서버사이드 PDF). 사용자가 md를 직접 쓰는 것이 기본 의도이고, 이 폴더에서 Claude Code가 열렸을 때 Claude는 아래 3가지를 보조한다.

## 구조 (루트는 사용자 공간, app/은 엔진)
- 루트에 보이는 것: `start.bat`, `README.md`, 발표 폴더들(`sample/` 등). **루트를 어지럽히지 마라** - 새 파일이 필요하면 app/ 안에.
- `app/server.js` — 로컬 서버(7744). 폴더 생성 감지 → md/html 자동 생성, md 저장 → SSE 실시간 반영, `/덱경로/pdf` → Puppeteer 벡터 PDF.
- `app/template.html` — md 파서·렌더러. @type 7종(Title/Head/List/Image/Table/Mermaid/Code) + 본문. 모든 덱 폴더에 자동 배포됨.
- `app/style.md` — 디자인 단일 원천. `- key: value`가 CSS 변수로 주입, 저장 즉시 반영.
- `app/organize.js` — 이미지 정리 (드라이런 기본, `--apply`로 이동).
- `app/prompt_log.txt` — 제작 과정 원문 기록 (극사실주의 append).
- PDF는 서버사이드 Puppeteer 단일 경로. legacy(html2canvas+jsPDF)·단일 페이지 추출은 의도적으로 제거된 기능이니 되살리지 마라.

## 온보딩 시나리오 (사용자가 GitHub URL을 주며 "이 소프트웨어 쓰고 싶어"라고 할 때)
일반 사용자는 npm install이 뭔지 모른다는 전제로 움직인다:
1. 사용자가 원하는 위치에 `git clone` (위치를 모르겠으면 물어본다).
2. 조용히 `cd app && npm install` (성공하면 언급하지 않는다).
3. 서버를 띄워 `http://localhost:7744`가 열리는지 확인하고, sample 덱을 보여준다.
4. 안내는 한 줄로: "앞으로는 폴더의 start.bat을 더블클릭하면 됩니다."
5. PDF가 안 나오면(Edge/Chrome 미발견) 환경변수 `CHROME_PATH`에 브라우저 경로를 지정해 해결한다 - 사용자에게 용어 설명하지 말고 직접 처리.

## Claude의 역할 3가지

### 1. md 초안 생성 (생성 보조 - 요청받을 때만)
- 사용자가 원고·주제·메모를 주며 "슬라이드로 만들어줘"라고 하면, **@type 문법의 md 초안**을 덱 폴더에 만든다.
- 충실도 철칙: 원고가 있으면 **사실·수치·고유명사·인용·순서 날조/변형 0**. 압축·분할·제목화만.
- 호흡: 타이틀 1 → @typeHead로 챕터 구분 → 한 슬라이드 한 메시지. 표는 @typeTable, 구조 설명은 @typeMermaid.
- 생성 후 안내: "초안입니다. md를 직접 고치면 브라우저에 바로 반영됩니다."

### 2. 이미지 정리 (물어보고 처리)
- `node app/organize.js`(드라이런) 먼저.
- 참조 이미지: 이동 계획 보여주고 `--apply`로 각 덱 `assets/`에 분산.
- **미참조 이미지는 절대 자동으로 옮기지 않는다.** 목록을 보여주고 어느 덱에 넣을지/그대로 둘지 사용자에게 묻는다 (AskUserQuestion).
- 여러 덱이 공유하는 이미지는 루트 `assets/`에 (서버가 폴백 탐색).

### 3. 스타일 조정
- "글씨 키워줘" 류는 `app/style.md` 값 수정으로 끝 (저장 즉시 반영, 빌드 없음).
- 새 슬라이드 타입: style.md에 `## @type이름` 섹션 추가. template.html 확장은 신중히.

## 환경·서버 (자동 · 사용자에게 노출하지 말 것)
- `app/node_modules` 없으면 조용히 `cd app && npm install` (puppeteer-core 하나).
- 서버 확인: `app/.server.pid` 존재 + `http://localhost:7744` 응답. 죽어 있으면 app에서 `node server.js` 백그라운드 기동.
- 종료는 반드시 PID 기반 (`app/stop.bat` 또는 PID만 kill). **`taskkill /IM node.exe` 전체 킬 금지.**

## 검증
- md를 만들었으면 `http://localhost:7744/덱폴더` 200 확인.
- PDF 검증: `/덱경로/pdf` 받아 페이지 수 = 슬라이드 수.
- 회귀 체크: 벡터 텍스트(선택 가능), 형광펜 줄바꿈, mermaid 렌더, 표 자동 축소, 한글 폰트.

## 절대 규칙
1. 사용자 직접 작성이 기본. 생성은 요청받을 때만, 초안임을 명시.
2. 원고 기반 생성 시 사실/수치 날조 금지.
3. 미참조 이미지는 묻지 않고 옮기지 않는다.
4. 렌더러 출력 HTML 직접 수정 금지. md와 app/style.md로만.
5. 루트에 새 파일을 만들지 않는다 (덱 폴더 제외).
6. 파이프라인 관련 사용자 입력은 `app/prompt_log.txt`에 원문 그대로 append.
