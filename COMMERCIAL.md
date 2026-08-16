# Killcord — Commercial Licensing

## Current release (0.1.x): MIT

Killcord 0.1.x is released under the MIT License and will remain MIT permanently.
You can use, modify, and distribute it for any purpose including commercial use
without restriction.

## Upcoming releases (0.2.0+): Business Source License

Starting from version 0.2.0, new Killcord releases will ship under the
[Business Source License 1.1](https://mariadb.com/bsl11/).

**Permitted without a commercial license:**
- Personal use
- Educational use
- Evaluation and development
- Non-production deployments (testing, staging, local development)

**Requires a commercial license:**
- Production use inside a company or organisation

The BSL includes a conversion clause: each 0.2.x release will automatically
convert to MIT four years after its release date.

## Privacy

Killcord is self-hosted. It runs as a local proxy on your own infrastructure.

- Your prompts, API keys, tool schemas, and traces are never transmitted to
  any Killcord-controlled server — only to the upstream LLM API you configure.
- The MiniLM-L6-v2 model (~90 MB) downloads once from HuggingFace on first run,
  then runs entirely on your CPU with zero per-request network calls.
- Redis and Stripe are only contacted if you explicitly configure
  `REDIS_URL` or `STRIPE_SECRET_KEY`. Neither is required.
- There is no telemetry, analytics, or phoning-home of any kind.

You can verify this independently: `node scripts/verify-no-telemetry.mjs`

## Commercial licensing enquiries

Open a GitHub issue with the title "Commercial license enquiry":
https://github.com/landonelder2410/killcord/issues/new?title=Commercial+license+enquiry

Include your company name, intended use, and approximate scale.
