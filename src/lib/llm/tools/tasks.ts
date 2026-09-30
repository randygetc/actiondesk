import "server-only";

import { END_OF_DAY, toLocalParts } from "@/lib/time/zones";
import {
  createTaskInput,
  listOverdueInput,
  projectSummaryInput,
  searchTasksInput,
} from "@/lib/validation/ask";

import { defineTool, type ToolContext } from "./types";

// Ask ActionDesk tools (docs/plan.md §3.3). Fixed query shapes on the user's
// client; the model only fills in validated parameters. Results carry trimmed
// fields, and task titles in them are other people's text (R-13).

const TASK_FIELDS =
  "id, title, status, priority, due_at, project:projects(id, name)";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  project: { id: string; name: string } | null;
};

/** Local "YYYY-MM-DD HH:mm", or just the date for end-of-day deadlines. */
function localDue(dueAt: string | null, tz: string): string | null {
  if (!dueAt) return null;
  const { date, time } = toLocalParts(new Date(dueAt), tz);
  return time === END_OF_DAY ? date : `${date} ${time}`;
}

function shape(rows: TaskRow[], ctx: ToolContext) {
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: localDue(t.due_at, ctx.timezone),
    project: t.project?.name ?? null,
  }));
}

/** ilike treats % and _ as wildcards; match them literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const searchTasks = defineTool({
  definition: {
    name: "search_tasks",
    description:
      "Search the user's tasks by words in the title. Optionally filter by status or project. Returns at most 20.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "status", "project_id"],
      properties: {
        query: {
          type: "string",
          description:
            "Words to find in task titles; empty string for all tasks.",
        },
        status: {
          // Strict mode rejects an enum on a ["string", "null"] type.
          anyOf: [
            { type: "string", enum: ["todo", "doing", "done"] },
            { type: "null" },
          ],
        },
        project_id: {
          type: ["string", "null"],
          description:
            "A project id from get_project_summary or a task result, or null.",
        },
      },
    },
  },
  input: searchTasksInput,
  describe: (i) =>
    i.query ? `Searched tasks for "${i.query}"` : "Listed tasks",
  async run(ctx, i) {
    let q = ctx.supabase
      .from("tasks")
      .select(TASK_FIELDS)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(20);
    if (i.query) q = q.ilike("title", `%${escapeLike(i.query)}%`);
    if (i.status) q = q.eq("status", i.status);
    if (i.project_id) q = q.eq("project_id", i.project_id);
    const { data, error } = await q;
    if (error) throw new Error(`search_tasks: ${error.code}`);
    return { result: { tasks: shape((data ?? []) as TaskRow[], ctx) } };
  },
});

export const listOverdue = defineTool({
  definition: {
    name: "list_overdue",
    description:
      "List the user's tasks that are past due and not done. Returns at most 50.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  input: listOverdueInput,
  describe: () => "Checked overdue tasks",
  async run(ctx) {
    const { data, error } = await ctx.supabase
      .from("tasks")
      .select(TASK_FIELDS)
      .lt("due_at", ctx.now.toISOString())
      .neq("status", "done")
      .order("due_at")
      .limit(50);
    if (error) throw new Error(`list_overdue: ${error.code}`);
    return { result: { tasks: shape((data ?? []) as TaskRow[], ctx) } };
  },
});

export const getProjectSummary = defineTool({
  definition: {
    name: "get_project_summary",
    description:
      "Summarize one project: task counts by status, overdue count, and the next tasks due. Use search_tasks or the project list to find the id.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["project_id"],
      properties: { project_id: { type: "string" } },
    },
  },
  input: projectSummaryInput,
  describe: () => "Summarized a project",
  async run(ctx, i) {
    const { data: project, error } = await ctx.supabase
      .from("projects")
      .select("id, name, archived_at")
      .eq("id", i.project_id)
      .maybeSingle();
    if (error) throw new Error(`get_project_summary: ${error.code}`);
    // Another user's project is invisible under RLS: same answer as missing.
    if (!project) return { result: { found: false } };

    const { data: tasks, error: tasksError } = await ctx.supabase
      .from("tasks")
      .select(TASK_FIELDS)
      .eq("project_id", project.id)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (tasksError) throw new Error(`get_project_summary: ${tasksError.code}`);
    const rows = (tasks ?? []) as TaskRow[];
    const open = rows.filter((t) => t.status !== "done");
    const now = ctx.now.getTime();
    return {
      result: {
        found: true,
        project: {
          id: project.id,
          name: project.name,
          archived: !!project.archived_at,
        },
        counts: {
          todo: rows.filter((t) => t.status === "todo").length,
          doing: rows.filter((t) => t.status === "doing").length,
          done: rows.filter((t) => t.status === "done").length,
          overdue: open.filter((t) => t.due_at && Date.parse(t.due_at) < now)
            .length,
        },
        next_due: shape(
          open
            .filter((t) => t.due_at && Date.parse(t.due_at) >= now)
            .slice(0, 5),
          ctx,
        ),
      },
    };
  },
});

export const createTask = defineTool({
  definition: {
    name: "create_task",
    description:
      "Propose a new task. This does NOT create it: the user sees the proposal and decides. Tell the user to confirm it.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "due_date", "due_time", "project_id", "priority"],
      properties: {
        title: { type: "string" },
        due_date: {
          type: ["string", "null"],
          description: "YYYY-MM-DD in the user's time zone, or null.",
        },
        due_time: {
          type: ["string", "null"],
          description:
            "HH:mm (24-hour) only if the user gave a time, else null.",
        },
        project_id: { type: ["string", "null"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      },
    },
  },
  input: createTaskInput,
  describe: (i) => `Proposed a task: "${i.title}"`,
  async run(ctx, i) {
    // Read-only check that the project is one the user can see; nothing is written.
    let projectName: string | null = null;
    if (i.project_id) {
      const { data } = await ctx.supabase
        .from("projects")
        .select("name")
        .eq("id", i.project_id)
        .maybeSingle();
      if (!data)
        return { result: { proposed: false, error: "Unknown project." } };
      projectName = data.name;
    }
    return {
      result: {
        proposed: true,
        note: "Shown to the user as a proposal. Nothing is saved unless they confirm.",
      },
      proposal: {
        title: i.title,
        dueDate: i.due_date,
        dueTime: i.due_time,
        projectId: i.project_id,
        projectName,
        priority: i.priority,
      },
    };
  },
});

export const ASK_TOOLS = [
  searchTasks,
  listOverdue,
  getProjectSummary,
  createTask,
];
