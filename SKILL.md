---
name: ppt-hyeop-ainative
description: >-
  "PPT 협 AI Native" - 마크다운을 흰 배경 + Pretendard 강의 슬라이드로 실시간 렌더링하는
  로컬 소프트웨어(server.js + template.html + style.md)와, 그 위에서 Claude가 보조하는
  옵트인 스킬. 사용자가 md를 직접 쓰는 것이 기본 의도이고, Claude는 (1) 원고/주제를 받아
  @type 문법의 md 초안을 생성해 주는 보조, (2) 덱이 참조하는/참조하지 않는 이미지 정리
  (scripts/organize.js, 미참조 이미지는 반드시 사용자에게 물어보고 처리),
  (3) style.md 디자인 조정을 담당한다. PDF는 서버사이드 Puppeteer 단일 경로
  (legacy·단일 페이지 추출은 제거됨). 트리거 - "슬라이드 md 만들어줘", "이 원고 슬라이드로",
  "이미지 정리해줘", "스타일 바꿔줘", "PPT 협". 통일 디자인 HTML 덱 생성은 ppt-simple-skill,
  pptx 파일이 필요하면 ppt-paperlogy-inspired-skill이 따로 있다.
---

# ppt-hyeop-ainative (PPT 협 AI Native)

결정론적 마크다운 → 슬라이드 소프트웨어 + Claude 보조 스킬. 핵심 철학: **사용자가 직접 쓴다. 소프트웨어는 결정론적으로 표시한다. Claude는 살짝 거든다.**

## 계보
- AI 네이티브 강의(5주)에서 실제 사용한 `lecture-new` 소프트웨어의 배포판.
- DNA 유지: server.js(로컬 서버·SSE 실시간 반영·폴더 자동화) + template.html(파서·렌더러) + style.md(디자인 변수).
- 배포판에서 제거된 것: **PDF (legacy)** 버튼(html2canvas+jsPDF 클라이언트 경로), **현재 PDF**·**PNG 저장**(단일 페이지 추출), lib/ 의존성. 서버사이드 Puppeteer `page.pdf()`가 충분히 빠르고 정확해서(270장 ~12초, 벡터 텍스트) 단일 경로로 통일했다.

## 아키텍처 (소프트웨어가 결정론, Claude는 내용만)
- `server.js` — 포트 7744. 폴더 생성 감지 → md/html 자동 생성, md 저장 → SSE로 브라우저 실시간 반영, style.md → CSS 변수 주입, `/덱경로/pdf` → Puppeteer 벡터 PDF.
- `template.html` — md 파서 + 슬라이드 렌더러. @type 7종(Title/Head/List/Image/Table/Mermaid/Code) + 본문.
- `style.md` — 디자인 단일 원천. `- key: value`가 CSS 변수로 주입되고 저장 즉시 반영.
- **Claude는 template.html/server.js의 렌더 결과를 손대지 않는다.** 디자인 요청은 style.md 값 수정으로, 내용 작업은 md 작성으로 처리한다.

## Claude의 역할 3가지

### 1. md 초안 생성 (생성 보조 - 옵트인)
- 사용자가 원고·주제·메모를 주며 "슬라이드로 만들어줘"라고 하면, **@type 문법의 md 초안**을 만들어 덱 폴더에 넣는다.
- 충실도 철칙: 원고가 있으면 **사실·수치·고유명사·인용·순서를 날조/변형 0**. 압축·분할·제목화만.
- 슬라이드 호흡: 타이틀 1 → 섹션(@typeHead)으로 챕터를 끊고 → 한 슬라이드 한 메시지. 표는 @typeTable, 다이어그램이 어울리면 @typeMermaid.
- 초안 생성 후 반드시 안내: "초안입니다. md를 직접 고치면 브라우저에 바로 반영됩니다." (직접 작성이 기본 의도임을 존중)

### 2. 이미지 정리 (물어보고 처리)
- 이미지가 덱 폴더 밖에 흩어져 있으면 `node scripts/organize.js`(드라이런)를 먼저 돌린다.
- **참조 이미지**(어떤 덱의 md가 호출): 이동 계획을 보여주고 `--apply`로 각 덱의 `assets/`에 자동 분산.
- **미참조 이미지**(어떤 md도 호출하지 않음): 절대 자동으로 옮기지 않는다. 목록을 보여주고 **사용자에게 물어본다** - "이 이미지들을 쓸 덱이 있나요? 넣을 덱을 알려주시면 그 폴더 assets/로 옮기고, 아니면 그대로 두거나 루트 assets/로 모아둘게요." (AskUserQuestion)
- 여러 덱이 공유하는 이미지는 루트 `assets/`에 둔다 (서버가 폴백 탐색).

### 3. 스타일 조정
- "글씨 키워줘", "자간 좁혀줘" 같은 요청은 `style.md` 값 수정으로 처리 (저장 즉시 반영되므로 빌드 불필요).
- 새 슬라이드 타입이 필요하면 style.md에 `## @type이름` 섹션 추가 + template.html 확장은 신중히.

## 환경 준비 (자동 · 사용자에게 노출하지 말 것)
- `node_modules` 없으면 조용히 `npm install` (puppeteer-core 하나뿐).
- 서버 살아있는지 확인: `.server.pid` 존재 + `http://localhost:7744` 응답. 죽어 있으면 `node server.js`를 백그라운드로 띄운다.
- 서버 종료는 반드시 PID 기반 (`stop.bat` 또는 `.server.pid`의 PID만 kill). **`taskkill /IM node.exe` 전체 킬 금지.**

## 검증
- md 초안을 만들었으면 해당 덱 URL(`http://localhost:7744/덱폴더`)이 200인지 확인.
- PDF 검증이 필요하면 `/덱경로/pdf`를 받아 페이지 수 = 슬라이드 수 확인.
- 회귀 체크리스트(원본 README에서 계승): 슬라이드 수 = PDF 페이지 수, 텍스트 선택 가능(벡터), 형광펜 줄바꿈, mermaid 정상 렌더, 표 자동 축소, 한글 폰트.

## 절대 규칙 요약
1. 사용자 직접 작성이 기본. 생성은 요청받을 때만, 초안임을 명시.
2. 원고 기반 생성 시 사실/수치 날조 금지.
3. 미참조 이미지는 묻지 않고 옮기지 않는다.
4. 렌더러(template.html) 출력 HTML을 직접 수정하지 않는다. md와 style.md로만.
5. node 프로세스 전체 킬 금지, PID 기반 종료.
6. 파이프라인 관련 사용자 입력은 `prompt_log.txt`에 원문 그대로 append (극사실주의).

## 파일
- `server.js` — 로컬 서버 (7744). 폴더 자동화·SSE·서버사이드 PDF.
- `template.html` — md 파서·렌더러 (모든 덱에 자동 배포됨).
- `style.md` — 디자인 변수 (저장 즉시 반영).
- `scripts/organize.js` — 이미지 정리 (드라이런 기본, `--apply`로 이동).
- `sample/` — 전 타입 예제 덱.
- `start.bat` / `stop.bat` — 서버 시작/종료.
- `README.md` — 사용자용 가이드 / `prompt_log.txt` — 제작 과정 원문 기록.
