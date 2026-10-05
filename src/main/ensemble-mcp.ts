// MCP stdio server that the agent CLIs launch to reach the Ensemble main process over local HTTP.
// - approve: Claude's --permission-prompt-tool. The CLI waits until the user answers the approval card.
// - memory_save / memory_update / memory_delete: the agent's own memory in a project chat.
// ENSEMBLE_TOOLS (comma-separated: approve, memory) picks which of them this session sees.
import readline from 'node:readline';

const { ENSEMBLE_URL, ENSEMBLE_TOKEN, ENSEMBLE_CHAT_ID, ENSEMBLE_AGENT_ID, ENSEMBLE_TOOLS = '' } = process.env;
const groups = ENSEMBLE_TOOLS.split(',');

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');

async function post(route: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${ENSEMBLE_URL}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ENSEMBLE_TOKEN}` },
    body: JSON.stringify({ chatId: ENSEMBLE_CHAT_ID, agentId: ENSEMBLE_AGENT_ID, ...args }),
  });
  return await res.text();
}

const TOOLS = [
  ...(groups.includes('approve')
    ? [{
        name: 'approve',
        description: 'Asks the Ensemble user to approve a tool call.',
        inputSchema: {
          type: 'object',
          properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
          required: ['tool_name', 'input'],
        },
      }]
    : []),
  ...(groups.includes('memory')
    ? [
        {
          name: 'memory_save',
          description: '이 프로젝트에서 당신만의 메모리에 새 항목을 기록합니다. 한 항목에는 한 가지 사실만 한두 문장으로 씁니다.',
          inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
        },
        {
          name: 'memory_update',
          description: '시스템 프롬프트의 "현재 메모리"에 있는 항목 하나의 내용을 고칩니다.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] },
        },
        {
          name: 'memory_delete',
          description: '더 이상 맞지 않는 메모리 항목 하나를 지웁니다.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      ]
    : []),
];

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // notification
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'ensemble', version: '0.1.0' },
      },
    });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params;
    let text: string;
    try {
      text = name === 'approve' ? await post('approve', args) : await post('memory', { tool: name, ...args });
    } catch (e) {
      text = name === 'approve'
        ? JSON.stringify({ behavior: 'deny', message: `Ensemble에 연결하지 못했습니다: ${e}` })
        : `Ensemble에 연결하지 못했습니다: ${e}`;
    }
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
  } else {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
