// HouseCall Pro MCP Server v1.2
// JSON response transport (was SSE which broke Cowork on some endpoints).
// Read-only HCP MCP. Token in URL path.

const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', true);

const PORT = process.env.PORT || 8000;
const HCP_BASE = 'https://api.housecallpro.com';
const HCP_TIMEOUT_MS = 60000;

const WORK_STATUSES = ['unscheduled','scheduled','in_progress','complete','completed','canceled','needs_scheduling'];

const tools = [
  { name:'hcp_list_jobs', description:'List HouseCall Pro jobs with optional filters.', inputSchema:{type:'object',properties:{scheduled_start_min:{type:'string'},scheduled_start_max:{type:'string'},work_status:{type:'array',items:{type:'string',enum:WORK_STATUSES},description:'Array of work statuses (HCP requires array)'},customer_id:{type:'string'},employee_id:{type:'string'},page:{type:'integer',default:1},page_size:{type:'integer',default:25,maximum:200}}}},
  { name:'hcp_get_job', description:'Get full details of a single HCP job by ID.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
  { name:'hcp_list_customers', description:'List HCP customers with optional search.', inputSchema:{type:'object',properties:{q:{type:'string'},page:{type:'integer',default:1},page_size:{type:'integer',default:25,maximum:200}}}},
  { name:'hcp_get_customer', description:'Get full details of one HCP customer by ID.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},
  { name:'hcp_list_employees', description:'List HCP employees.', inputSchema:{type:'object',properties:{page:{type:'integer',default:1},page_size:{type:'integer',default:100,maximum:200}}}},
  { name:'hcp_list_estimates', description:'List HCP estimates.', inputSchema:{type:'object',properties:{scheduled_start_min:{type:'string'},scheduled_start_max:{type:'string'},work_status:{type:'array',items:{type:'string'}},customer_id:{type:'string'},page:{type:'integer',default:1},page_size:{type:'integer',default:25,maximum:200}}}},
  { name:'hcp_list_invoices', description:'List HCP invoices.', inputSchema:{type:'object',properties:{invoice_date_min:{type:'string'},invoice_date_max:{type:'string'},customer_id:{type:'string'},page:{type:'integer',default:1},page_size:{type:'integer',default:25,maximum:200}}}},
  { name:'hcp_list_appointments', description:'List scheduled HCP appointments.', inputSchema:{type:'object',properties:{scheduled_start_min:{type:'string'},scheduled_start_max:{type:'string'},employee_id:{type:'string'},page:{type:'integer',default:1},page_size:{type:'integer',default:100,maximum:200}}}},
  { name:'hcp_get_schedule', description:'All employees + appointments on a given date.', inputSchema:{type:'object',properties:{date_min:{type:'string'},date_max:{type:'string'}},required:['date_min']}},
];

async function hcpGet(apikey, path, query = {}) {
  const url = new URL(HCP_BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) if (item !== undefined && item !== null && item !== '') url.searchParams.append(k + '[]', String(item));
    } else url.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HCP_TIMEOUT_MS);
  try {
    const r = await fetch(url, { method:'GET', signal:ctrl.signal, headers:{Authorization:'Token '+apikey, Accept:'application/json', 'User-Agent':'hcp-mcp-proxy/1.2'}});
    const text = await r.text();
    if (!r.ok) throw new Error('HCP ' + r.status + ': ' + text.substring(0, 500));
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch(e) {
    if (e && e.name === 'AbortError') throw new Error('HCP request timed out after ' + Math.round(HCP_TIMEOUT_MS/1000) + 's: ' + path);
    throw e;
  } finally { clearTimeout(timer); }
}

async function runTool(apikey, name, args = {}) {
  switch (name) {
    case 'hcp_list_jobs': return hcpGet(apikey, '/jobs', args);
    case 'hcp_get_job': return hcpGet(apikey, '/jobs/' + encodeURIComponent(args.id));
    case 'hcp_list_customers': return hcpGet(apikey, '/customers', args);
    case 'hcp_get_customer': return hcpGet(apikey, '/customers/' + encodeURIComponent(args.id));
    case 'hcp_list_employees': return hcpGet(apikey, '/employees', args);
    case 'hcp_list_estimates': return hcpGet(apikey, '/estimates', args);
    case 'hcp_list_invoices': return hcpGet(apikey, '/invoices', args);
    case 'hcp_list_appointments': return hcpGet(apikey, '/appointments', args);
    case 'hcp_get_schedule': {
      const dateMin = args.date_min;
      const dateMax = args.date_max || dateMin;
      const [employees, appointments] = await Promise.all([hcpGet(apikey, '/employees', { page_size: 200 }), hcpGet(apikey, '/appointments', { scheduled_start_min: dateMin, scheduled_start_max: dateMax, page_size: 200 })]);
      return { employees, appointments };
    }
    default: throw new Error('Unknown tool: ' + name);
  }
}

const SERVER_INFO = { name: 'hcp-mcp-proxy', version: '1.2.0' };

function setCors(res) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
    'Access-Control-Expose-Headers': '*',
  });
}

async function handleMcp(req, res) {
  const apikey = req.params.apikey;
  setCors(res);
  if (!apikey || apikey.length < 16) return res.status(400).json({ error: 'Invalid apikey' });

  const body = req.body || {};
  const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : null;
  const method = body.method;

  console.log('[mcp]', method, body.params && body.params.name ? body.params.name : '');

  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER_INFO };
        break;
      case 'notifications/initialized':
        return res.status(202).end();
      case 'tools/list':
        result = { tools };
        break;
      case 'tools/call': {
        const params = body.params || {};
        const data = await runTool(apikey, params.name, params.arguments || {});
        const json = JSON.stringify(data, null, 2);
        const text = json.length > 60000 ? json.substring(0, 60000) + '\n...[truncated]' : json;
        result = { content: [{ type: 'text', text }], isError: false };
        break;
      }
      case 'ping':
        result = {};
        break;
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (err) {
    console.error('[handleMcp ERROR]', err && err.message);
    res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: (err && err.message) || 'Internal error' } });
  }
}

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'hcp-mcp-proxy', upstream: HCP_BASE, tools: tools.length, timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.type('text/plain').send('HCP MCP Proxy v1.2 - JSON response transport'));
app.options('/:apikey/mcp', (req, res) => { setCors(res); res.status(204).end(); });
app.post('/:apikey/mcp', handleMcp);
app.get('/:apikey/mcp', (req, res) => { setCors(res); res.set('Content-Type','text/event-stream').write(': hcp-mcp keep-alive\n\n'); const ping=setInterval(()=>res.write(': ping\n\n'),25000); req.on('close',()=>clearInterval(ping)); });
app.delete('/:apikey/mcp', (req, res) => res.status(204).end());

app.listen(PORT, () => { console.log('[hcp-mcp-proxy v1.2] listening on port ' + PORT); console.log('[hcp-mcp-proxy] upstream ' + HCP_BASE); console.log('[hcp-mcp-proxy] tools: ' + tools.length); });
