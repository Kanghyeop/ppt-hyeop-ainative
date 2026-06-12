<!--
이 파일이 곧 슬라이드입니다. 저장하면 브라우저에 실시간 반영됩니다.
슬라이드는 --- 로 구분하고, 각 슬라이드 첫 줄에 @type을 지정합니다.

이미지 슬라이드 예시 (이미지 파일을 이 폴더나 assets/에 넣고):
@typeImage

캡션 텍스트

![[이미지.png]]
-->

@typeTitle

PPT 협 AI Native

---

@typeHead

마크다운이 곧 슬라이드다

---

@typeList

이 도구가 하는 일

- 폴더를 만들면 md와 뷰어가 자동 생성
- md를 저장하면 브라우저에 **실시간 반영**
- ==형광펜==, **볼드**, 표, mermaid, 코드 셀 지원
- PDF 저장 버튼 하나로 벡터 PDF 출력

---

@typeTable

지원 슬라이드 타입

| @type | 용도 |
|-------|------|
| @typeTitle | 타이틀 (104px, 900) |
| @typeHead | 섹션 제목 (72px) |
| @typeList | 리스트 |
| @typeImage | 이미지 중심 |
| @typeTable | 표 중심 |
| @typeMermaid | 다이어그램 |
| @typeCode | 코드 셀 |

---

@typeMermaid

동작 구조

```mermaid
graph LR
    A[마크다운 작성] --> B[로컬 서버]
    B --> C[브라우저 실시간 렌더]
    C --> D[PDF 저장]
```

---

@typeCode

코드 셀

```bash
# 서버 시작
start.bat
# http://localhost:7744
```

---

본문 슬라이드

@type 없이 쓰면 본문 슬라이드가 됩니다.

# 헤딩 한 줄

일반 문단 텍스트. **볼드**와 ==형광펜==을 섞어 쓸 수 있고,

빈 줄로 문단 간격을 줍니다.
