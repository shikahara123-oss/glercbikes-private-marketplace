import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = (await fs.readFile(new URL('../skills/lingxing-readonly/scripts/server.mjs',import.meta.url),'utf8')).replace('import crypto from "node:crypto";','');
const calls=[];
function harness(env={}, reply) {
  const requests=[];
  const context=vm.createContext({crypto,Buffer,URL,URLSearchParams,FormData,Date,Set,Map,console,
    process:{env,stdout:{write(){}},stderr:{write(){}},stdin:{setEncoding(){},on(){}},exit(){throw new Error('EXIT_WITHOUT_CREDENTIALS');}},
    fetch:async(url,options)=>{requests.push({url:String(url),options});return reply(url,options);}
  });
  vm.runInContext(source,context);
  const invoke=(name,args={})=>vm.runInContext(`handle(${JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})`,context);
  return {context,requests,invoke};
}
const jsonResponse=data=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify(data)});
const remoteEnv={LINGXING_MCP_URL:'https://mcp.example.invalid/endpoint',LINGXING_MCP_KEY:'test-mcp-key-not-real'};
const openEnv={LINGXING_OPENAPI_APP_ID:'1234567890123456',LINGXING_OPENAPI_APP_SECRET:'test-app-secret-not-real'};

test('requires configuration without exposing values',()=>assert.throws(()=>harness({},()=>{}),/EXIT_WITHOUT_CREDENTIALS/));
test('OpenAPI-only initializes and lists tools without remote MCP',async()=>{
  const h=harness(openEnv,()=>{throw new Error('unexpected network');});
  const init=await vm.runInContext('handle({id:1,method:"initialize",params:{protocolVersion:"2024-11-05"}})',h.context);
  assert.equal(init.result.serverInfo.name,'lingxing-readonly');
  const tools=await vm.runInContext('handle({id:2,method:"tools/list"})',h.context);
  assert.equal(tools.result.tools.length,3);assert.equal(h.requests.length,0);
});
test('unknown tools and disallowed business IDs never reach the network',async()=>{
  const h=harness(remoteEnv,()=>{throw new Error('unexpected network');});
  for(const [name,args] of [['set_inventory',{}],['action',{toolId:'delete_product'}],['search',{toolId:'create_order'}],['action',{}]]) {
    assert.equal((await h.invoke(name,args)).error.code,-32601);
  }
  const result=await vm.runInContext('handle({id:1,method:"resources/write"})',h.context);
  assert.equal(result.error.code,-32601);assert.equal(h.requests.length,0);
});
test('tools/list hides upstream mutation tools',async()=>{
  const h=harness(remoteEnv,()=>jsonResponse({jsonrpc:'2.0',id:1,result:{tools:[{name:'help'},{name:'search'},{name:'action'},{name:'create_order'}]}}));
  const result=await vm.runInContext('handle({id:1,method:"tools/list"})',h.context);
  assert.equal(result.result.tools.length,6);assert.ok(!result.result.tools.some(t=>t.name==='create_order'));
});
test('help only exposes allowlisted read business tools',async()=>{
  const h=harness(remoteEnv,()=>jsonResponse({id:1,result:{content:[{type:'text',text:JSON.stringify({data:{total:3,tools:[{toolId:'get_fba_stock_list',toolType:'read'},{toolId:'delete_product',toolType:'write'},{toolId:'unknown_read',toolType:'read'}]}})}]}}));
  const result=await h.invoke('help');
  const payload=JSON.parse(result.result.content[0].text);assert.equal(payload.data.total,1);
});
test('allowlisted report preserves read parameters',async()=>{
  const h=harness(remoteEnv,(_,opts)=>jsonResponse({id:1,result:{content:[{type:'text',text:opts.body}]}}));
  await h.invoke('action',{toolId:'get_profit_report_msku',params:{start_date:'2026-01-01',end_date:'2026-01-31'}});
  assert.equal(JSON.parse(h.requests[0].options.body).params.arguments.params.end_date,'2026-01-31');
});
test('inventory preserves paging and source cost fields',async()=>{
  const h=harness(openEnv,(url,opts)=>String(url).includes('/oauth/')?jsonResponse({code:200,data:{access_token:'test-access-token-not-real',expires_in:3600}}):jsonResponse({code:0,total:901,data:[{sku:'TEST-SKU',wid:'7',product_valid_num:12,cost_field:3.25}]}));
  const result=await h.invoke('lingxing_inventory_details',{wid:'7',sku:'TEST-SKU',offset:800,length:100});
  const payload=JSON.parse(result.result.content[0].text);
  assert.equal(payload.total,901);assert.equal(payload.data[0].cost_field,3.25);
  assert.deepEqual(JSON.parse(h.requests[1].options.body),{offset:800,length:100,wid:'7',sku:'TEST-SKU'});
});
test('UK resolves GB warehouses by name and excludes other countries',async()=>{
  const h=harness(openEnv,(url,opts)=>{
    if(String(url).includes('/oauth/'))return jsonResponse({code:200,data:{access_token:'test-access-token-not-real'}});
    if(String(url).includes('/warehouse?'))return jsonResponse({code:0,data:[{wid:'7',name:'英国金仓',country_code:'GB'},{wid:'8',name:'英国谷仓',country_code:'UK'},{wid:'9',name:'美国谷仓',country_code:'US'}]});
    return jsonResponse({code:0,total:1,data:[{sku:'TEST-SKU',wid:'7',product_valid_num:12}]});
  });
  const result=await h.invoke('lingxing_uk_overseas_inventory',{sku:'TEST-SKU'});
  const payload=JSON.parse(result.result.content[0].text);assert.equal(payload.warehouses.length,2);
  assert.equal(JSON.parse(h.requests[2].options.body).wid,'7,8');
});
test('configured secrets are masked from error messages',()=>{
  const h=harness({...remoteEnv,...openEnv},()=>{});
  const value=vm.runInContext(`safeError(new Error(${JSON.stringify('test-mcp-key-not-real test-app-secret-not-real')}))`,h.context);
  assert.equal(value,'[REDACTED] [REDACTED]');
});
test('standalone CLI status reports booleans without secret values',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../skills/lingxing-readonly/scripts/query.mjs',import.meta.url)),'status'],{encoding:'utf8',env:{...process.env,...remoteEnv,...openEnv},windowsHide:true});
  assert.equal(result.status,0);const payload=JSON.parse(result.stdout);
  assert.equal(payload.credentials.LINGXING_OPENAPI_APP_SECRET,true);
  assert.ok(!result.stdout.includes(openEnv.LINGXING_OPENAPI_APP_SECRET));
});
