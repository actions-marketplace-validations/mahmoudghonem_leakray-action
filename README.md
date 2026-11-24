# LeakRay Security Scan (GitHub Action)

Run **22 strictly passive URL security checks** on your preview or production deployments right inside GitHub Actions — zero signup, zero false positives on intentionally public client keys (Supabase `anon`, Stripe `pk_live_`, Firebase web `apiKey`).

Powered by **[LeakRay](https://leakray.dev)** (`npx leakray`).

## Quick Start

### Scan a Preview Deployment on Every Pull Request

```yaml
name: LeakRay Security Check
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  leakray:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: mahmoudghonem/leakray-action@v1
        with:
          url: "https://preview.myapp.com"
          fail-on: "high"
```

### Scan Your App Locally Before Deploying (`--allow-local`)

```yaml
      - name: Start app & scan localhost
        run: |
          npm run start &
          npx wait-on http://localhost:3000
      - uses: mahmoudghonem/leakray-action@v1
        with:
          url: "http://localhost:3000"
          allow-local: "true"
          fail-on: "high"
```

## What It Checks (22 Passive Rules)

- **Leaked Secrets & Keys:** Stripe `sk_live_`, Supabase `service_role`, OpenAI, Anthropic, AWS, GitHub, PEM private keys, `__NEXT_DATA__` and hydrated SPA state leaks (never false-flags public `anon` or `pk_live_` keys).
- **Exposed Files, BaaS & Storage:** `/.env`, `/.git/HEAD`, `/.DS_Store`, `/backup.sql`, public `.js.map` source maps, publicly readable Firebase Realtime Databases, public S3/GCS/R2 bucket listings, GraphQL introspection, OpenAPI/Swagger, and Next.js debug endpoints.
- **Transport, Headers & Cookies:** HTTPS/HSTS, mixed content, CSP, SRI, COOP, `Referrer-Policy`, `Permissions-Policy`, CORS credential reflection, `Set-Cookie` flags, and server banners.

## Inputs

| Input | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `url` | Yes | — | Target URL to scan passively |
| `fail-on` | No | `high` | Fail build on severity `>=` threshold (`critical`, `high`, `medium`, `low`, `info`, or `none`) |
| `allow-local` | No | `false` | Permit scanning `localhost` / private network URLs |
| `timeout` | No | `20000` | Overall scan timeout in milliseconds |
| `comment-on-pr` | No | `true` | Post or update a single summary comment on PRs |
| `github-token` | No | `${{ github.token }}` | Token for posting PR comments (`pull-requests: write`) |
| `cli-version` | No | `latest` | `leakray` npm package version |

## Outputs

| Output | Description |
| :--- | :--- |
| `score` | Numeric security score (`0`–`100`) |
| `grade` | Letter grade (`A+`–`F`) |
| `findings-count` | Total findings detected |
| `actionable-count` | Non-informational findings |

## Links

- Web Scanner & Interactive Matrix: **https://leakray.dev**
- CLI Documentation: **https://leakray.dev/cli**
- npm Package: **https://www.npmjs.com/package/leakray**
