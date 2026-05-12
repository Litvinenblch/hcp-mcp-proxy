# HCP MCP Proxy

MCP server for [HouseCall Pro](https://www.housecallpro.com/) that embeds the HCP API key in the URL path (Firecrawl pattern).

## URL format

```
https://<your-railway-host>/<HCP_API_KEY>/mcp
```

Treat the URL like a password.

## Tools (read-only first version)

- hcp_list_jobs, hcp_get_job
- hcp_list_customers, hcp_get_customer
- hcp_list_employees
- hcp_list_estimates
- hcp_list_invoices
- hcp_list_appointments
- hcp_get_schedule

## Deploy

1. Connect this repo to Railway.
2. Railway auto-detects the Dockerfile.
3. Generate a public domain.
4. Use the URL above in Claude → Settings → Connectors → Add Custom Connector.

## Health

`GET /health` returns service status.
