#!/usr/bin/env node
/**
 * Minimal MCP stdio server used by the manual acceptance run.
 *
 * It speaks newline-delimited JSON-RPC 2.0, echoes the client's protocol
 * version, exposes one `echo` tool, and exits on stdin close.
 */

import readline from 'node:readline';

const input = readline.createInterface({ input: process.stdin });
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

input.on('line', line => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  switch (message.method) {
    case 'initialize':
      reply(message.id, {
        protocolVersion:
          message.params && typeof message.params.protocolVersion === 'string'
            ? message.params.protocolVersion
            : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-manager-echo', version: '1.0.0' },
      });
      return;
    case 'ping':
      reply(message.id, {});
      return;
    case 'tools/list':
      reply(message.id, {
        tools: [
          {
            name: 'echo',
            description: 'Echo the supplied text.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: [],
            },
          },
        ],
      });
      return;
    case 'tools/call': {
      const args = message.params && message.params.arguments ? message.params.arguments : {};
      reply(message.id, {
        content: [{ type: 'text', text: `echo: ${typeof args.text === 'string' ? args.text : 'ok'}` }],
      });
      return;
    }
    default:
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } });
  }
});

process.stdin.on('end', () => process.exit(0));
