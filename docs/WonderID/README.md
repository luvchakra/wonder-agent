# docs/WonderID: the IGA and Agent ID plan

A self-contained set, created 2026-10-11 and kept apart from the historical
documents in `docs/design/`, `docs/plan/` and the programme files
`docs/RUN_ORDER.md` and `docs/PROGRESS.md`.

| Folder | File | What it is |
|---|---|---|
| `design/` | `DESIGN.md` | The current design, consolidated from the foundation design, the Saviynt study and the integrator review. Read this first. |
| `run-order/` | `RUN-ORDER.md` | Phases F1–F10, every story with its ID, module, GitHub issue and exit test, and the decisions that gate each phase. The plan of record. |
| (root) | `KNOWLEDGE-BASE.md` | A plain-language, knowledge-base guide to the whole product, with a dated revision history at the end, newest first. No story or phase labels. Updated in the same pull request as each piece of work (owner request, 2026-10-12). |
| `progress/` | `PROGRESS.md` | Live status per story and per decision. Updated in the same pull request as the work. |
| `reference/` | `WONDERID-FOUNDATION-DESIGN.md` | The first design with its revision history, the standards list, the NIST mapping and the vendor coverage matrix. |
| `reference/` | `saviynt-reference-study.md` | The read-only reading of a live Saviynt tenant that fed the design. |
| `reference/` | `INTEGRATOR-GUIDE.md` | What a system integrator can configure today, with console paths and permission keys. |

**Where the rest lives.**
- `CLAUDE.md`: the binding engineering contract; nothing here overrides it.
- `docs/integrations/CONNECTOR-FRAMEWORK.md`: the connector definition reference.
- `docs/plan/*-BACKLOG.md` and `docs/design/*-backlog-audit.md`: the module backlogs and audit logs that stories enter once decision D1 is approved.
