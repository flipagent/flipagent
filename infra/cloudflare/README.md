# infra/cloudflare

Cloudflare DNS records for `flipagent.dev`. Currently:

| Record | Type | Points at | Why |
|---|---|---|---|
| `api.flipagent.dev` | CNAME | Azure Container App ingress | Custom domain for the api |
| `asuid.api.flipagent.dev` | TXT | Azure verification id | Proves we own the domain |

Apex `flipagent.dev` (for the Cloudflare Pages docs site) is configured by
Cloudflare Pages itself when you connect the GitHub repo — leave it out
of Terraform.

## Prereqs

1. Cloudflare account, with `flipagent.dev` added as a Free-plan zone
2. NS records at GoDaddy already pointed at the Cloudflare nameservers
3. Zone ID — copy from the zone Overview page → API section (right sidebar)
4. API Token — create at https://dash.cloudflare.com/profile/api-tokens
   - Template: **Edit zone DNS**
   - Zone Resources: Include → Specific zone → flipagent.dev
   - Save token (shown once)

## Apply

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars   # paste zone_id and api_token

terraform init
terraform apply
```

Verify:

```bash
dig api.flipagent.dev CNAME +short
dig asuid.api.flipagent.dev TXT +short
```

(May take 1–5 min for Cloudflare's edge to publish.)

## After DNS resolves

Set `custom_domain = "api.flipagent.dev"` in `infra/azure/terraform.tfvars`
and re-apply. Azure provisions a free managed cert and binds the domain
in 1–3 minutes. Then `curl https://api.flipagent.dev/healthz` should
return `{"status":"ok",...}`.
