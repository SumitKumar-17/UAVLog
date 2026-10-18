@AGENTS.md

## Claude Code notes

- Read the three files in `research/` before design decisions; they flag which claims are unverified.
- Solo project with no deadline: favor depth and measured evidence over breadth. Ask before adding a new datastore or major dependency.
- Save durable decisions to `docs/decisions.md` and update this file or `AGENTS.md` when conventions change.
- Don't commit `.env` or API keys. Don't run large downloads (Flight Review bulk, RflyMAD at 114 GB) without confirming disk budget with the user first.
