import type { Db } from "./db.js";
import { newId } from "../types/ids.js";
import {
  ProjectSchema, SessionSchema,
  type Project, type Session,
} from "../types/domain.js";

interface ProjectRow {
  id: string; name: string; domain: string; regulatory_context: string;
  system_name: string | null; glossary: string | null; created_at: string;
}

interface SessionRow {
  id: string; project_id: string; title: string;
  occurred_at: string; status: string; created_at: string;
}

function toProject(row: ProjectRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    domain: row.domain,
    regulatoryContext: row.regulatory_context,
    systemName: row.system_name,
    glossary: row.glossary,
    createdAt: row.created_at,
  });
}

function toSession(row: SessionRow): Session {
  return SessionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    occurredAt: row.occurred_at,
    status: row.status,
    createdAt: row.created_at,
  });
}

export function createProject(
  db: Db,
  input: {
    name: string;
    domain: string;
    regulatoryContext?: Project["regulatoryContext"];
    systemName?: string | null;
    glossary?: string | null;
  },
): Project {
  const project = ProjectSchema.parse({
    id: newId("prj"),
    name: input.name,
    domain: input.domain,
    regulatoryContext: input.regulatoryContext ?? "none",
    systemName: input.systemName ?? null,
    glossary: input.glossary ?? null,
    createdAt: new Date().toISOString(),
  });
  db.prepare(
    `INSERT INTO projects (id, name, domain, regulatory_context, system_name, glossary, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    project.id, project.name, project.domain, project.regulatoryContext,
    project.systemName, project.glossary, project.createdAt,
  );
  return project;
}

export function getProject(db: Db, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function createSession(
  db: Db,
  input: { projectId: string; title: string; occurredAt?: string },
): Session {
  const now = new Date().toISOString();
  const session = SessionSchema.parse({
    id: newId("ses"),
    projectId: input.projectId,
    title: input.title,
    occurredAt: input.occurredAt ?? now,
    status: "draft",
    createdAt: now,
  });
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, occurred_at, status, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    session.id, session.projectId, session.title,
    session.occurredAt, session.status, session.createdAt,
  );
  return session;
}

export function setSessionStatus(db: Db, sessionId: string, status: Session["status"]): void {
  db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, sessionId);
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  return row ? toSession(row) : null;
}

export function listSessions(db: Db, projectId: string): Session[] {
  const rows = db
    .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY occurred_at ASC")
    .all(projectId) as SessionRow[];
  return rows.map(toSession);
}
