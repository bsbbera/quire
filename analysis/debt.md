# Debt — things built but parked, and why

Each entry says what exists, what is not wired, and what has to be true before
it comes back. An entry leaves this file only when its condition is met, not
when someone feels like reinstating it.

Dropped 2026-09-17: the print card (`components/PrintCard.tsx`, parked off the
audit screen) — not wanted, and not waiting for a build surface. The print
profile, spine, barcode, preflight and upload folder behind it stay: they are
the work of 07 §Print and 11 #1, and nothing about them depends on that card.

---

## 1. Connecting Canva (2026-09-12)

**What exists.** `cli-shim/canva.mjs` draws a picture through Canva's MCP
endpoint and exports it through the Connect REST API; `cli-shim/engines.mjs`
routes a job to Canva first and falls back to ComfyUI on quota, failure, or a
capability Canva lacks. The Picture engine panel on the Providers screen takes a
pasted token and the "Canva first" preference.

**Why it is parked.** Canva has no API key or personal token. A token comes
only from an OAuth sign-in and lasts four hours, so a pasted one stops working
the same afternoon. The MCP endpoint (`mcp.canva.com`) also has its own OAuth
client registration, and whether one token serves both endpoints is unverified.
Nothing is connected today; every picture renders on ComfyUI.

**What has to be true before it returns.** A "Connect Canva" button that runs
the OAuth (PKCE) sign-in in the browser once and refreshes the token itself,
checked end to end against both endpoints with a real account.

**Where it goes when it returns.** The Picture engine panel on the Providers
screen, replacing the token field.
