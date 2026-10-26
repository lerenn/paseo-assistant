/** What the Assistant's agent-management tools need of the Paseo SDK; the real `PaseoApi` satisfies it. */
export interface ManagePaseo {
  projects: { list(): Promise<{ projects: unknown[] }> };
  workspaces: {
    list(options?: unknown): Promise<{ entries: unknown[] }>;
    create(options: Record<string, unknown>): Promise<{ id: string }>;
    ref(workspaceId: string): { agents: { create(options: Record<string, unknown>): Promise<{ id: string }> } };
  };
  agents: { list(options?: unknown): Promise<{ entries: unknown[] }> };
}

/** The label that marks what the Assistant created; the prompt's bypass rule and `assistant_agents_list` use it. */
export const CREATED_BY_LABEL = "paseo.created-by";
export const CREATED_BY_VALUE = "assistant";
export const DEFAULT_PROVIDER_FOR_AGENTS = "claude/claude-sonnet-5-5";

export class ManageError extends Error {}

interface Project {
  projectId: string;
  projectDisplayName: string;
  projectRootPath: string;
  projectKind?: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Projects with their live workspaces, so a workspace can be picked or the right project chosen for a new one. */
export async function listProjects(paseo: ManagePaseo) {
  const { projects } = await paseo.projects.list();
  const { entries } = await paseo.workspaces.list();
  const workspaces = entries.flatMap((e) => {
    const w = e as Record<string, unknown>;
    return str(w.id) && !w.archivingAt ? [{ id: w.id as string, projectId: str(w.projectId), name: str(w.name), title: str(w.title), directory: str(w.directory), status: str(w.status) }] : [];
  });
  return (projects as Project[]).map((p) => ({
    projectId: p.projectId,
    name: p.projectDisplayName,
    rootPath: p.projectRootPath,
    kind: p.projectKind ?? null,
    workspaces: workspaces.filter((w) => w.projectId === p.projectId),
  }));
}

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

/** A project by id, exact display name or root path. */
function findProject(projects: Project[], ref: string): Project {
  const hits = projects.filter((p) => p.projectId === ref || p.projectRootPath === ref || p.projectDisplayName === ref);
  if (hits.length === 0) throw new ManageError(`No project "${ref}". Use assistant_projects_list for the ids, names and paths.`);
  if (hits.length > 1) throw new ManageError(`"${ref}" matches ${hits.length} projects; use the project id.`);
  return hits[0];
}

/**
 * Creates a workspace in a project, by default in a Kubernetes Runtime pod. The workspace is made by the plugin,
 * so nothing links it to the Assistant agent.
 */
export async function createWorkspace(paseo: ManagePaseo, input: { project: string; title: string; runtime?: "kubernetes" | "local"; slug?: string }) {
  const { projects } = await paseo.projects.list();
  const project = findProject(projects as Project[], input.project);
  const runtime = input.runtime ?? "kubernetes";
  const title = input.title.trim();
  const workspace = await paseo.workspaces.create({
    source: { kind: "directory", path: project.projectRootPath },
    title,
    runtime:
      runtime === "kubernetes"
        ? { id: "kubernetes", options: { cwd: project.projectRootPath, slug: input.slug ?? slugOf(title), ref: null, title } }
        : { id: "local" },
  });
  return { workspaceId: workspace.id, projectId: project.projectId, runtime };
}

/**
 * Creates a TOP-LEVEL agent in a workspace: created through the workspace handle with no `parent`, so it is not a
 * subagent, keeps running when the Assistant's session ends, and is labelled so the Assistant can find it.
 */
export async function createAgent(
  paseo: ManagePaseo,
  input: { workspaceId: string; title: string; prompt: string; provider?: string; mode?: string; labels?: Record<string, string> },
) {
  for (const key of Object.keys(input.labels ?? {})) {
    if (key === CREATED_BY_LABEL || key === "paseo.parent-agent-id") throw new ManageError(`The label ${key} is set by the system.`);
  }
  const agent = await paseo.workspaces.ref(input.workspaceId).agents.create({
    title: input.title.trim(),
    prompt: input.prompt,
    config: { provider: input.provider ?? DEFAULT_PROVIDER_FOR_AGENTS, ...(input.mode ? { modeId: input.mode } : {}) },
    labels: { ...(input.labels ?? {}), [CREATED_BY_LABEL]: CREATED_BY_VALUE },
  });
  return { agentId: agent.id, workspaceId: input.workspaceId };
}

/** Live agents, by default only the ones the Assistant created. */
export async function listAgents(paseo: ManagePaseo, o: { createdByAssistant?: boolean } = {}) {
  const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
  const only = o.createdByAssistant ?? true;
  return entries.flatMap((e) => {
    const a = (e as { agent?: Record<string, unknown> }).agent;
    const labels = (a?.labels as Record<string, string> | undefined) ?? {};
    if (!a || !str(a.id) || (only && labels[CREATED_BY_LABEL] !== CREATED_BY_VALUE)) return [];
    return [{ id: a.id as string, title: str(a.title), status: str(a.status), workspaceId: str(a.workspaceId), provider: str(a.provider), createdByAssistant: labels[CREATED_BY_LABEL] === CREATED_BY_VALUE, subagent: !!a.parentAgentId }];
  });
}
