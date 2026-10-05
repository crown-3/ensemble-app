// MCP stdio server that the Claude CLI launches as its --permission-prompt-tool.
// Each permission request is forwarded to the Ensemble main process over local HTTP,
// and the CLI waits until the main process answers (after the user clicks a button).
import readline from 'node:readline';

const { ENSEMBLE_APPROVAL_URL, ENSEMBLE_TOKEN, ENSEMBLE_CHAT_ID, ENSEMBLE_AGENT_ID } = process.env;

const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n');

async function decide(args: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch(ENSEMBLE_APPROVAL_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ENSEMBLE_TOKEN}` },
      body: JSON.stringify({ chatId: ENSEMBLE_CHAT_ID, agentId: ENSEMBLE_AGENT_ID, ...args }),
    });
    return await res.text();
  } catch (e) {
    return JSON.stringify({ behavior: 'deny', message: `Ensemble에 연결하지 못했습니다: ${e}` });
  }
}

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
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'approve',
            description: 'Asks the Ensemble user to approve a tool call.',
            inputSchema: {
              type: 'object',
              properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
              required: ['tool_name', 'input'],
            },
          },
        ],
      },
    });
  } else if (msg.method === 'tools/call') {
    const text = await decide(msg.params.arguments ?? {});
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
  } else {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
