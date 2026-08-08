## graphify

When `graphify-out/graph.json` exists, run `graphify query "<question>"` before broad source searches. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. `/graphify` explicitly invokes the installed skill.

Dirty graph output is expected. Prefer `graphify-out/wiki/index.md` for broad navigation when present; read `GRAPH_REPORT.md` only for architecture reviews or incomplete query results. After code changes, run `graphify update .`.
