# ForgeFlow Memory

This directory follows a Claude Code-inspired local memory layout:

- `MEMORY.md` stores readable durable project summaries.
- `runs.jsonl` stores append-only structured run records.

The backend creates both files on first run. `runs.jsonl` is ignored by git because it is runtime data.
