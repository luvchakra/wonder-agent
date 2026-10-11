# docs/iga: the IGA and Agent ID plan

A fresh, self-contained set, created 2026-10-11 and kept separate from the
historical documents in `docs/design/`, `docs/plan/` and the programme files
`docs/RUN_ORDER.md` and `docs/PROGRESS.md`.

| Folder | File | What it is |
|---|---|---|
| `design/` | `DESIGN.md` | The current design, consolidated from the foundation design, the Saviynt study and the integrator review. Read this first. |
| `run-order/` | `RUN-ORDER.md` | Phases F1–F10, every story with its ID, module, GitHub issue and exit test, and the decisions that gate each phase. The plan of record. |
| `progress/` | `PROGRESS.md` | Live status per story and per decision. Updated in the same pull request as the work. |

**Where the rest lives.**
- `CLAUDE.md`: the binding engineering contract; nothing here overrides it.
- `docs/design/WONDERID-FOUNDATION-DESIGN.md`: the first design with its revision history, the standards list, the NIST mapping and the vendor coverage matrix.
- `docs/design/saviynt-reference-study.md`: the reading of a live Saviynt tenant that fed the design.
- `docs/integrations/CONNECTOR-FRAMEWORK.md`: the connector definition reference.
- `docs/integrations/INTEGRATOR-GUIDE.md`: what an integrator can configure today.
- `docs/plan/*-BACKLOG.md` and `docs/design/*-backlog-audit.md`: the module backlogs and audit logs that stories enter once decision D1 is approved.
