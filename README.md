# Ensemble

나만의 에이전트 회사 그룹챗. 기획과 디자인은 `plans/plan1/`에 있습니다(`ensemble-handoff/PRODUCT_SPEC.md`, `DECISIONS.md`).

## 실행

필요한 것: Node.js 22 이상, 로그인된 [Claude Code](https://claude.com/claude-code) CLI(`claude`).

```sh
npm install
npm run dev        # 개발 모드
npm run build && npm start
```

### 브라우저에서 실행 (GitHub Codespaces 등 창을 띄울 수 없는 환경)

```sh
npm run web        # http://localhost:4100 (포트는 PORT로 변경)
```

같은 백엔드가 Node로 실행되고 화면은 브라우저에서 엽니다. Codespaces에서는 "포트" 탭에서 4100을 엽니다. 포트는 비공개(Private)로 두세요. 이 페이지에서 보낸 메시지는 이 컴퓨터에서 `claude`를 실행합니다.

브라우저 모드에서는 "폴더 변경"이 경로를 직접 입력받고, "열기"는 파일 내용을 새 탭에 보여 줍니다(채팅의 작업 폴더 안의 파일만).

데이터는 OS의 앱 데이터 폴더의 `data.json`에 저장됩니다. `ENSEMBLE_DATA_DIR`로 위치를 바꿀 수 있습니다.

## 검사

```sh
npm run typecheck
npm test           # 단위 테스트 (응답자 결정, 승인 규칙, 멘션)
npm run e2e        # 실제 claude CLI로 대화, 승인, 정지를 확인 (세션 한도를 조금 사용)
```

디스플레이가 없는 Linux에서는 `xvfb-run -a npm run e2e`로 실행합니다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/main/ensemble.ts` | 채팅 진행: 응답 순서, 에이전트에게 보낼 프롬프트, 승인 대기 |
| `src/main/rules.ts` | 누가 응답하는지, 어떤 작업을 승인 없이 실행하는지 |
| `src/main/claude.ts` | `claude -p --output-format stream-json`을 실행하고 출력을 채팅 이벤트로 변환 |
| `src/main/approval-mcp.ts` | CLI의 권한 확인 요청을 앱으로 넘기는 MCP 서버(`--permission-prompt-tool`) |
| `src/main/store.ts` | JSON 파일 저장 |
| `src/main/core.ts` | 데스크톱과 브라우저 모드가 함께 쓰는 백엔드 |
| `src/main/web.ts` | 브라우저 모드 서버 (`npm run web`) |
| `src/renderer/src/` | React 화면 |
