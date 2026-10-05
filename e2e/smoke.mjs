// End-to-end check against the real Claude Code CLI (uses your Claude session limit).
// Run: npm run build && xvfb-run -a node e2e/smoke.mjs
//
// 1. 사용자가 도윤을 멘션 → 도윤이 파일을 쓰려고 승인 요청 → 승인
// 2. 파일이 작업 폴더에 생기고 파일 카드가 표시됨
// 3. 도윤이 서윤을 멘션 → 서윤이 이어서 응답 (에이전트끼리 대화)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensemble-e2e-'));
const dataDir = path.join(root, 'data');
const work = path.join(root, 'work');
fs.mkdirSync(dataDir);
fs.mkdirSync(work);

const now = new Date().toISOString();
const agent = (id, name, title, persona) => ({
  id, name, title, provider: 'claude', model: 'claude-haiku-4-5', tint: '#dfe6f1', persona, history: [], approvalMode: 'inherit',
});
fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify({
  agents: [
    agent('seoyun', '서윤', '기획 리드', '결과물을 검토하고 한 문장으로 평가합니다. 다른 에이전트를 멘션하지 않습니다.'),
    agent('doyun', '도윤', '카피라이터', '요청받은 파일을 만듭니다.'),
  ],
  chats: [{
    id: 'c1', title: 'E2E', folderPath: work,
    members: [{ agentId: 'seoyun', readFrom: 0, seenUpTo: 0 }, { agentId: 'doyun', readFrom: 0, seenUpTo: 0 }],
    leaderAgentId: 'seoyun', approvalMode: 'ask-all', alwaysApproveAgentIds: [], messages: [],
    createdAt: now, updatedAt: now, unread: false,
  }],
  settings: { globalInstructions: '항상 한국어로 짧게 답합니다.', defaultApprovalMode: 'ask-all', theme: 'light' },
}));

const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, ENSEMBLE_DATA_DIR: dataDir } });
const page = await app.firstWindow();
const shot = (name) => page.screenshot({ path: path.join('.dev/shots', `e2e-${name}.png`) });
const step = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

try {
  await page.evaluate(() => (location.hash = '#/chat/c1'));
  await page.getByLabel('메시지 입력').fill('@도윤 hello.txt 파일에 "안녕하세요" 한 줄만 써 주세요. 다 쓰면 @서윤 님에게 확인을 요청하는 메시지를 남겨 주세요.');
  await page.getByLabel('메시지 입력').press('Enter');
  step('message sent');

  await page.getByRole('button', { name: '승인', exact: true }).waitFor({ timeout: 120_000 });
  step('approval card shown');
  await shot('approval');
  if (fs.existsSync(path.join(work, 'hello.txt'))) throw new Error('file was written before approval');
  await page.getByRole('button', { name: '승인', exact: true }).click();

  await page.locator('.file-card', { hasText: 'hello.txt' }).waitFor({ timeout: 120_000 });
  step(`file card shown; file content: ${JSON.stringify(fs.readFileSync(path.join(work, 'hello.txt'), 'utf8'))}`);

  await page.locator('.sender', { hasText: '서윤 · 기획 리드' }).waitFor({ timeout: 180_000 });
  step('서윤 replied after being mentioned by 도윤');
  await page.locator('.typing').waitFor({ state: 'detached', timeout: 180_000 });
  await shot('done');

  const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8'));
  const kinds = data.chats[0].messages.map((m) => m.kind + ('agentId' in m ? `:${m.agentId}` : ''));
  step(`messages: ${kinds.join(', ')}`);
  step(`도윤 history: ${JSON.stringify(data.agents[1].history.map((h) => h.content))}`);

  // 4. 정지 버튼이 실행 중인 CLI를 멈춤
  await page.getByLabel('메시지 입력').fill('1부터 200까지의 숫자를 한 줄에 하나씩 모두 적어 주세요.');
  await page.getByLabel('메시지 입력').press('Enter');
  await page.locator('.typing').waitFor({ timeout: 30_000 });
  await page.getByLabel('모든 에이전트 작업 멈추기').click();
  await page.getByText('서윤의 작업을 멈췄습니다').waitFor({ timeout: 15_000 });
  await page.locator('.typing').waitFor({ state: 'detached', timeout: 15_000 });
  step('stop button ended the running turn');
  console.log('E2E PASSED');
} catch (e) {
  await shot('failure');
  console.error('E2E FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await app.close();
}
