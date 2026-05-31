// HouseCall Pro MCP Server — token-in-URL Streamable HTTP MCP for HCP API.
//
// Usage:
// POST/GET https://<host>/<HCP_API_KEY>/mcp
//
// Read-only first version. Exposes core HCP read endpoints as MCP tools:
// - hcp_list_jobs, hcp_get_job
// - hcp_list_customers, hcp_get_customer
// - hcp_list_employees
// - hcp_list_estimates
// - hcp_list_invoices
// - hcp_list_appointments
// - hcp_get_schedule (employees + appointments for a date)
//
// Bypasses Anthropic's broken OAuth flow by embedding the HCP API key
// directly in the URL path, the same pattern Firecrawl uses.

const express = require('express');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', true);

const PORT = process.env.PORT || 8000;
const HCP_BASE = 'https://api.housecallpro.com';
const HCP_TIMEOUT_MS = 60000;

// -------------------------------------------------------------- Tool catalog

const WORK_STATUSES = ['unscheduled', 'scheduled', 'in_progress', 'complete', 'completed', 'canceled', 'needs_scheduling'];

const tools = [
{
name: 'hcp_list_jobs',
description:
'List HouseCall Pro jobs with optional filters. Returns job ID, scheduled time, work status, customer, address, assigned employees, and revenue. Use for sales-funnel analysis, scheduling visibility, or finding jobs by status/date/customer.',
inputSchema: {
type: 'object',
properties: {
scheduled_start_min: { type: 'string', description: 'ISO date (YYYY-MM-DD) — earliest scheduled start' },
scheduled_start_max: { type: 'string', description: 'ISO date (YYYY-MM-DD) — latest scheduled start' },
work_status: {
type: 'array',
items: { type: 'string', enum: WORK_STATUSES },
description: 'Job work status (HCP requires array of strings; pass single status as one-element array)',
},
customer_id: { type: 'string', description: 'Filter by customer ID' },
employee_id: { type: 'string', description: 'Filter by assigned employee ID' },
page: { type: 'integer', default: 1 },
page_size: { type: 'integer', default: 25, maximum: 200 },
},
},
},
{
name: 'hcp_get_job',
description: 'Get full details of a single HCP job by ID, including line items, notes, and assigned employees.',
inputSchema: {
type: 'object',
properties: { id: { type: 'string', description: 'HCP job ID' } },
required: ['id'],
},
},
{
name: 'hcp_list_customers',
description: 'List HCP customers with optional search. Returns name, email, phone, address, tags, and lifetime value.',
inputSchema: {
type: 'object',
properties: {
q: { type: 'string', description: 'Free-text search (name, email, phone, address)' },
page: { type: 'integer', default: 1 },
page_size: { type: 'integer', default: 25, maximum: 200 },
},
},
},
{
name: 'hcp_get_customer',
description: 'Get full details of one HCP customer by ID, including job history and addresses.',
inputSchema: {
type: 'object',
properties: { id: { type: 'string', description: 'HCP customer ID' } },
required: ['id'],
},
},
{
name: 'hcp_list_employees',
description: 'List HCP employees (techs, CSRs, admins). Useful to map names → IDs for filtering jobs.',
inputSchema: {
type: 'object',
properties: {
page: { type: 'integer', default: 1 },
page_size: { type: 'integer', default: 100, maximum: 200 },
},
},
},
{
name: 'hcp_list_estimates',
description: 'List HCP estimates with optional filters. Useful for tracking quote → won conversion.',
inputSchema: {
type: 'object',
properties: {
scheduled_start_min: { type: 'string' },
scheduled_start_max: { type: 'string' },
work_status: {
type: 'array',
items: { type: 'string' },
description: 'Estimate work status (HCP requires array of strings)',
},
customer_id: { type: 'string' },
page: { type: 'integer', default: 1 },
page_size: { type: 'integer', default: 25, maximum: 200 },
},
},
},
{
name: 'hcp_list_invoices',
description: 'List HCP invoices. Use for revenue analysis, AR aging, or job → invoice attribution.',
inputSchema: {
type: 'object',
properties: {
invoice_date_min: { type: 'string', description: 'ISO date — earliest invoice date' },
invoice_date_max: { type: 'string', description: 'ISO date — latest invoice date' },
customer_id: { type: 'string' },
page: { type: 'integer', default: 1 },
page_size: { type: 'integer', default: 25, maximum: 200 },
},
},
},
{
name: 'hcp_list_appointments',
description:
'List scheduled HCP appointments (job-instances on a calendar). Returns scheduled_start, scheduled_end, assigned employees. Use to view the techs' calendar.',
inputSchema: {
type: 'object',
properties: {
scheduled_start_min: { type: 'string' },
scheduled_start_max: { type: 'string' },
employee_id: { type: 'string' },
page: { type: 'integer', default: 1 },
page_size: { type: 'integer', default: 100, maximum: 200 },
},
},
},
{
name: 'hcp_get_schedule',
description:
'Convenience tool: returns all employees + all appointments on a given date. Use for daily/weekly schedule overview.',
inputSchema: {
type: 'object',
properties: {
date_min: { type: 'string', description: 'ISO date (YYYY-MM-DD) — start of range' },
date_max: { type: 'string', description: 'ISO date (YYYY-MM-DD) — end of range (inclusive)' },
},
required: ['date_min'],
},
},
];

// ------------------------------------------------------------- HCP API calls

async function hcpGet(apikey, path, query = {}) {
const url = new URL(HCP_BASE + path);
for (const [k, v] of Object.entries(query)) {
if (v === undefined || v === null || v === '') continue;
if (Array.isArray(v)) {
for (const item of v) {
if (item !== undefined && item !== null && item !== '') {
url.searchParams.append(k + '[]', String(item));
}
}
} else {
url.searchParams.set(k, String(v));
}
}
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), HCP_TIMEOUT_MS);
try {
const r = await fetch(url, {
method: 'GET',
signal: ctrl.signal,
headers: {
Authorization: 'Token ' + apikey,
Accept: 'application/json',
'User-Agent': 'hcp-mcp-proxy/1.0',
},
});
const text = await r.text();
if (!r.ok) {
throw new Error('HCP ' + r.status + ': ' + text.substring(0, 500));
}
try {
return JSON.parse(text);
} catch {
return { raw: text };
}
} catch (e) {
if (e && e.name === 'AbortError') {
throw new Error('HCP request timed out after ' + Math.round(HCP_TIMEOUT_MS / 1000) + 's: ' + path);
}
throw e;
} finally {
clearTimeout(timer);
}
}

async function runTool(apikey, name, args = {}) {
switch (name) {
case 'hcp_list_jobs':
return hcpGet(apikey, '/jobs', args);
case 'hcp_get_job':
return hcpGet(apikey, '/jobs/' + encodeURIComponent(args.id));
case 'hcp_list_customers':
return hcpGet(apikey, '/customers', args);
case 'hcp_get_customer':
return hcpGet(apikey, '/customers/' + encodeURIComponent(args.id));
case 'hcp_list_employees':
return hcpGet(apikey, '/employees', args);
case 'hcp_list_estimates':
return hcpGet(apikey, '/estimates', args);
case 'hcp_list_invoices':
return hcpGet(apikey, '/invoices', args);
case 'hcp_list_appointments':
return hcpGet(apikey, '/appointments', args);
case 'hcp_get_schedule': {
const dateMin = args.date_min;
const dateMax = args.date_max || dateMin;
const [employees, appointments] = await Promise.all([
hcpGet(apikey, '/employees', { page_size: 200 }),
hcpGet(apikey, '/appointments', {
scheduled_start_min: dateMin,
scheduled_start_max: dateMax,
page_size: 200,
}),
]);
return { employees, appointments };
}
default:
throw new Error('Unknown tool: ' + name);
}
}

// ------------------------------------------------------------- MCP transport

const SERVER_INFO = { name: 'hcp-mcp-proxy', version: '1.1.0' };

function sendSse(res, payload) {
res.set({
'Content-Type': 'text/event-stream',
'Cache-Control': 'no-cache, no-transform',
Connection: 'keep-alive',
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': '*',
'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
'Access-Control-Expose-Headers': '*',
});
res.write('event: message\ndata: ' + JSON.stringify(payload) + '\n\n');
res.end();
}

async function handleMcp(req, res) {
const apikey = req.params.apikey;
if (!apikey || apikey.length < 16) {
res.status(400).json({ error: 'Invalid or missing apikey in URL path' });
return;
}

const body = req.body || {};
const id = Object.prototype.hasOwnProperty.call(body, 'id') ? body.id : null;
const method = body.method;

try {
let result;
switch (method) {
case 'initialize':
result = {
protocolVersion: '2024-11-05',
capabilities: { tools: {} },
serverInfo: SERVER_INFO,
};
break;

case 'notifications/initialized':
res.status(202).end();
return;

case 'tools/list':
result = { tools };
break;

case 'tools/call': {
const params = body.params || {};
const toolName = params.name;
const args = params.arguments || {};
const data = await runTool(apikey, toolName, args);
const json = JSON.stringify(data, null, 2);
const text = json.length > 60000 ? json.substring(0, 60000) + '\n…[truncated]' : json;
result = {
content: [{ type: 'text', text }],
isError: false,
};
break;
}

case 'ping':
result = {};
break;

default:
return sendSse(res, {
jsonrpc: '2.0',
id,
error: { code: -32601, message: 'Method not found: ' + method },
});
}

sendSse(res, { jsonrpc: '2.0', id, result });
} catch (err) {
console.error('[handleMcp]', err && err.message);
sendSse(res, {
jsonrpc: '2.0',
id,
error: { code: -32603, message: err && err.message ? err.message : 'Internal error' },
});
}
}

function handleSse(req, res) {
const apikey = req.params.apikey;
if (!apikey || apikey.length < 16) {
res.status(400).json({ error: 'Invalid or missing apikey in URL path' });
return;
}
res.set({
'Content-Type': 'text/event-stream',
'Cache-Control': 'no-cache, no-transform',
Connection: 'keep-alive',
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': '*',
'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
});
res.write(': hcp-mcp keep-alive\n\n');
const ping = setInterval(() => {
res.write(': ping\n\n');
}, 25000);
req.on('close', () => clearInterval(ping));
}

app.get('/health', (req, res) => {
res.json({
status: 'ok',
service: 'hcp-mcp-proxy',
upstream: HCP_BASE,
tools: tools.length,
timestamp: new Date().toISOString(),
});
});

app.get('/', (req, res) => {
res
.type('text/plain')
.send(
'HCP MCP Proxy\n' +
'=============\n\n' +
'Usage: POST/GET ' +
req.protocol +
'://' +
req.get('host') +
'/<HCP_API_KEY>/mcp\n\n' +
' <HCP_API_KEY> = HouseCall Pro API token (Settings → API)\n\n' +
'Available tools: ' +
tools.length +
'\n' +
'Health: /health\n'
);
});

app.options('/:apikey/mcp', (req, res) => {
res.set({
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': '*',
'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
'Access-Control-Max-Age': '86400',
});
res.status(204).end();
});

app.post('/:apikey/mcp', handleMcp);
app.get('/:apikey/mcp', handleSse);
app.delete('/:apikey/mcp', (req, res) => res.status(204).end());

app.listen(PORT, () => {
console.log('[hcp-mcp-proxy] listening on port ' + PORT);
console.log('[hcp-mcp-proxy] upstream ' + HCP_BASE);
console.log('[hcp-mcp-proxy] tools: ' + tools.length);
});
