// Local-only synthetic MCP Apps host for checking repeated tool notifications.
// Loads the actual built UI and calls the real local MCP endpoint; never uses
// LinkedIn or the production endpoint. No credentials enter the browser.
import { createServer } from 'node:http';
import { SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startFixtureBridge } from './fixtures.mjs';
const base = 'http://localhost:3000';
const secrets = process.env;
if (!secrets.INFLOW_SIGNING_KEY || !secrets.INFLOW_BRIDGE_KEY)
  throw new Error('Load verification credentials with --env-file=.env');
const token = await new SignJWT({ kind: 'access', sub: 'owner', client: 'preview-host' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuer(base)
  .setAudience(`${base}/mcp`)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(secrets.INFLOW_SIGNING_KEY));
const client = new Client({ name: 'inflow-preview-host', version: '1' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const resource = await client.readResource({ uri: 'ui://views/inbox.html' });
const stop = startFixtureBridge(base, {
  authorization: `Bearer ${secrets.INFLOW_BRIDGE_KEY}`,
  'content-type': 'application/json',
});
const server = createServer(async (req, res) => {
  if (req.headers.host !== 'localhost:3100' && req.headers.host !== '127.0.0.1:3100') {
    res.writeHead(403).end();
    return;
  }
  if (req.url === '/view') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(resource.contents[0].text);
    return;
  }
  if (req.url === '/tool' && req.method === 'POST') {
    if (req.headers.origin !== 'http://localhost:3100') {
      res.writeHead(403).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16000) throw Error('Too large');
      }
      const call = JSON.parse(body);
      if (!['open_inbox', 'read_thread', 'list_conversations'].includes(call.name))
        throw Error('Preview is read-only');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(await client.callTool(call)));
      return;
    } catch (e) {
      res.writeHead(400).end(JSON.stringify({ error: e.message }));
      return;
    }
  }
  if (req.url !== '/') {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Inflow widget regression preview</title><style>body{margin:0;font:14px system-ui;background:#eee}header{display:flex;flex-wrap:wrap;gap:8px;padding:12px;align-items:center}button{padding:7px}iframe{width:100%;height:calc(100vh - 64px);border:0;background:white}#status{margin-left:auto}</style></head><body><header><strong>Synthetic fixture • read-only</strong><button id="connection">Connection view</button><button id="visualize">Visualize inbox</button><button id="alex">Open Alex</button><button id="maya">Open Maya</button><button id="theme">Toggle dark</button><span id="status">Starting…</span></header><iframe id="app" src="/view"></iframe><script type="module">
const frame=document.querySelector('#app'),status=document.querySelector('#status');let session,theme='light',started=false;
const notify=(method,params)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},location.origin);
const call=async(name,args)=>{const r=await fetch('/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,arguments:args})});return r.json();};
async function show(args){args={state:'inbox',...args,...session?{widgetSessionId:session}:{}};notify('ui/notifications/tool-input',{arguments:args});const result=await call('open_inbox',args);session=result.structuredContent.widgetSessionId;notify('ui/notifications/tool-result',result);status.textContent='Same session: '+session.slice(0,8);}
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
 const m=event.data;
 if(m.method==='ui/notifications/initialized'&&!started){started=true;await show({state:'thread',conversationId:'maya'});return;}
 if(m.id==null)return;
 let result={};
 if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'inflow-regression-host',version:'1'},hostCapabilities:{serverTools:{},updateModelContext:{},openLinks:{}},hostContext:{theme,displayMode:'fullscreen',availableDisplayModes:['inline','fullscreen'],containerDimensions:{width:innerWidth,height:innerHeight-64}}};
 else if(m.method==='tools/call')result=await call(m.params.name,m.params.arguments);
 else if(m.method==='ui/request-display-mode')result={mode:'fullscreen'};
 frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},location.origin);
});
for(const id of ['connection','visualize'])document.querySelector('#'+id).onclick=()=>show({state:id});
for(const id of ['alex','maya'])document.querySelector('#'+id).onclick=()=>show({state:'thread',conversationId:id});
document.querySelector('#theme').onclick=()=>{theme=theme==='light'?'dark':'light';notify('ui/notifications/host-context-changed',{theme});};
</script></body></html>`);
});
server.listen(3100, '127.0.0.1', () => console.log('Synthetic preview at http://localhost:3100'));
process.on('SIGINT', async () => {
  server.close();
  await stop();
  await client.close();
  process.exit(0);
});
