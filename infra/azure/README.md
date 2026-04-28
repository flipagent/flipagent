# infra/azure

Terraform module that provisions the entire api stack on Azure:

| Resource | Why |
|---|---|
| Resource Group | One blast radius |
| Container Registry (Basic) | Hosts the api image |
| Postgres Flexible Server (B1ms) + db | App database |
| Postgres firewall rule "allow-azure-services" | Lets the Container App reach Postgres without VNet integration |
| Log Analytics Workspace | Required by Container Apps for logs |
| Container Apps Environment | Container Apps prerequisite |
| Container App `flipagent-{env}-api` | The Hono backend, 1–5 replicas, system-assigned identity. Pulls from ACR repo `api:<sha>`. |
| Role assignment `AcrPull` on the app's identity | Lets the app pull images from ACR without admin creds |
| Optional custom domain | Wires `api.flipagent.dev` once DNS is set up |

## Prerequisites

- `terraform` ≥ 1.6
- Azure subscription + `az login`
- Oxylabs Web Scraper API credentials for `scraper_api_username` / `scraper_api_password` (or leave empty and accept low-volume scrape limits)

## First-time deploy

```bash
cd infra/azure
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars              # fill in scraper_api_username/password, etc.

terraform init
terraform apply

# This first apply uses Microsoft's hello-world image. Now build + push
# the real one:
ACR=$(terraform output -raw acr_login_server)
az acr login --name "${ACR%%.*}"

docker build -f packages/api/Dockerfile -t $ACR/api:$(git rev-parse --short HEAD) ../..
docker push $ACR/api:$(git rev-parse --short HEAD)

# Roll the Container App onto the real image:
az containerapp update \
  --name flipagent-prod-api \
  --resource-group flipagent-prod \
  --image $ACR/api:$(git rev-parse --short HEAD)
```

After the first deploy, GitHub Actions handles build + push + roll on
every commit to `main`. See `.github/workflows/deploy-api.yml`.

## Custom domain

```bash
# 1. Get the verification ID
DOMAIN_TXT=$(terraform output -raw custom_domain_verification_id)

# 2. Set DNS records on flipagent.dev:
#      CNAME api  → <api_fqdn>
#      TXT   asuid.api  → $DOMAIN_TXT

# 3. Set custom_domain in terraform.tfvars and apply:
terraform apply
```

Container Apps provisions a free Let's Encrypt cert automatically once
DNS resolves.

## Connecting to Postgres ad-hoc

```bash
DATABASE_URL=$(terraform output -raw database_url)
psql "$DATABASE_URL"
```

The `database_url` output is marked sensitive; `terraform output` only
prints it with `-raw` and only after `apply`.

## Cost (without credits)

| Resource | ~$/mo (eastus2) |
|---|---|
| Container Apps (1 replica, 0.5 vCPU / 1 GiB, always on) | $20–35 |
| Postgres Flexible B1ms + 32 GiB storage + backup | $15–20 |
| ACR Basic | $5 |
| Log Analytics (low ingest) | $0–5 |
| **Total** | **$40–65** |

With Azure credits this is $0 until the credits run out.

## Tearing down

```bash
terraform destroy
```

Wipes the resource group, including Postgres data. Take a `pg_dump`
first if you care.
