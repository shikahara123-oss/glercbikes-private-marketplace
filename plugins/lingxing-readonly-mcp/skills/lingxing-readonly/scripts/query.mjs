import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const command = args.shift() || 'status';
if (command === 'status') {
  const keys = ['LINGXING_MCP_URL','LINGXING_MCP_KEY','LINGXING_OPENAPI_APP_ID','LINGXING_OPENAPI_APP_SECRET','LINGXING_OPENAPI_BASE_URL','LINGXING_OPENAPI_RELAY_TOKEN'];
  console.log(JSON.stringify({ node: process.version, credentials: Object.fromEntries(keys.map(k => [k, Boolean(process.env[k]?.trim())])), note: 'Presence check only; use tools/warehouses for live checks.' }, null, 2));
  process.exit(0);
}
const toolByCommand = { warehouses:'lingxing_overseas_warehouses', inventory:'lingxing_inventory_details', uk:'lingxing_uk_overseas_inventory', help:'help', schema:'search', report:'action' };
if (command !== 'tools' && !toolByCommand[command]) {
  console.error('Commands: status, tools, warehouses, inventory, uk, help, schema TOOL_ID, report TOOL_ID. JSON arguments or --args-file PATH supported.');
  process.exit(2);
}
const toolId = ['schema','report'].includes(command) ? args.shift() : undefined;
if (['schema','report'].includes(command) && !toolId) throw new Error('TOOL_ID required');
let input = {};
if (args[0] === '--args-file') {
  if (!args[1] || args.length !== 2) throw new Error('--args-file requires exactly one file path');
  input = JSON.parse(await fs.readFile(args[1], 'utf8'));
} else if (args.length) {
  if (args.length !== 1) throw new Error('Pass one JSON object or --args-file PATH');
  input = JSON.parse(args[0]);
}
if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Arguments must be a JSON object');
const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { env:process.env, stdio:['pipe','pipe','pipe'], windowsHide:true });
const lines = readline.createInterface({ input:child.stdout });
let counter = 0;
const pending = new Map();
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('error', error => { for (const p of pending.values()) p.reject(error); });
child.on('exit', code => { for (const p of pending.values()) p.reject(new Error(`Connector exited (${code})`)); pending.clear(); });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const p = pending.get(message.id);
  if (!p) return;
  pending.delete(message.id); clearTimeout(p.timer);
  if (message.error) p.reject(new Error(message.error.message));
  else if (message.result?.isError) p.reject(new Error('Lingxing tool returned an error; check permissions and parameters.'));
  else p.resolve(message.result);
});
function rpc(method, params) {
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Lingxing request timed out after 45 seconds')); }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n');
  });
}
try {
  await rpc('initialize', {protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'lingxing-skill-cli',version:'0.2.0'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const toolArgs = command==='schema' ? {...input,toolId} : command==='report' ? {toolId,params:input} : input;
  const result = command==='tools' ? await rpc('tools/list',{}) : await rpc('tools/call',{name:toolByCommand[command],arguments:toolArgs});
  console.log(JSON.stringify(result,null,2));
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  for(const p of pending.values())clearTimeout(p.timer);
  pending.clear(); lines.close(); child.stdin.end(); child.kill();
}
