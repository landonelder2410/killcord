# Killcord — Commercial Licensing

## Current release (0.1.x): MIT

Killcord 0.1.x is released under the MIT License and will remain MIT permanently.
You can use, modify, and distribute it for any purpose including commercial use
without restriction. See [LICENSE](LICENSE).

## Upcoming releases (0.2.0+): Business Source License 1.1

Starting from version 0.2.0, new Killcord releases will ship under the
[Business Source License 1.1](https://mariadb.com/bsl11/) with the following parameters:

| Parameter | Value |
|---|---|
| Licensor | Driftflow LLC, an Ohio limited liability company |
| Additional Use Grant | Personal, educational, evaluation, and non-production use (testing, staging, local development) |
| Change Date | Four years from each version's release date |
| Change License | Apache License 2.0 |

**Production use inside a company or organisation requires a commercial license.**

Each 0.2.x release automatically converts to Apache 2.0 four years after its
individual release date. The BSL is not a "source-available but closed" licence —
it is time-limited and converts to a true open-source licence on a fixed schedule.

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

<!-- TODO: replace this GitHub issue link with a real licensing@ email address once set up -->
Open an issue at:
https://github.com/landonelder2410/killcord/issues/new

Include your company name, intended use, and approximate scale.
