"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  createSavedView,
  createTask,
  deleteSavedView,
  updateTaskAssignee,
  updateTaskStatus,
} from "../actions/crm";
import { EmptyState, LoadingState } from "../../components/ui/empty-state";
import { FeatureHeader } from "../../components/ui/feature-header";
import { SavedViewControls } from "../../components/ui/saved-view-controls";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { loadWorkspaceContext } from "../../lib/supabase/workspace-context";
import type { Json } from "../../types/database";
import "./tasks.css";

type TaskStatus = "open" | "in_progress" | "completed" | "cancelled";
type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
  assignee_id: string | null;
};
type Member = { id: string; name: string; role: string };
type SavedView = {
  id: string;
  name: string;
  filters: Json;
  created_at: string;
};
type TaskTiming = "all" | "overdue" | "due_soon" | "no_due";

function taskFiltersFromSavedView(savedView: SavedView | undefined) {
  const filters = savedView?.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters))
    return null;
  const query = typeof filters.query === "string" ? filters.query : "";
  const assigneeId =
    typeof filters.assigneeId === "string" ? filters.assigneeId : "all";
  const timing =
    filters.timing === "overdue" ||
    filters.timing === "due_soon" ||
    filters.timing === "no_due"
      ? filters.timing
      : "all";
  return { query, assigneeId, timing } satisfies {
    query: string;
    assigneeId: string;
    timing: TaskTiming;
  };
}

const columns: { status: TaskStatus; label: string; description: string }[] = [
  {
    status: "open",
    label: "Ready",
    description: "New follow-ups and planned work",
  },
  {
    status: "in_progress",
    label: "In progress",
    description: "Currently being worked",
  },
  {
    status: "completed",
    label: "Completed",
    description: "Delivered with an audit trail",
  },
];

function formatDate(value: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function isOverdue(task: Task, comparisonTime = Date.now()) {
  return Boolean(
    task.due_at &&
    task.status !== "completed" &&
    task.status !== "cancelled" &&
    new Date(task.due_at).getTime() < comparisonTime,
  );
}

export default function TasksPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState("");
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [timingFilter, setTimingFilter] = useState<TaskTiming>("all");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterTimestamp, setFilterTimestamp] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const load = async () => {
      const supabase = createSupabaseBrowserClient();
      const { active: membership } = await loadWorkspaceContext(supabase);
      if (!membership) {
        setNotice("No active workspace is available for this account.");
        setLoading(false);
        return;
      }
      setOrganizationId(membership.organization_id);
      const [
        { data, error },
        { data: memberRows },
        { data: savedViewRows },
      ] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            "id, title, status, due_at, created_at, completed_at, assignee_id",
          )
          .eq("organization_id", membership.organization_id)
          .order("due_at", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        supabase
          .from("saved_views")
          .select("id, name, filters, created_at")
          .eq("organization_id", membership.organization_id)
          .eq("feature", "tasks")
          .order("updated_at", { ascending: false }),
      ]);
      const memberIds = (memberRows || []).map((member) => member.user_id);
      const { data: profileRows } = memberIds.length
        ? await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", memberIds)
        : { data: [] };
      const names = new Map(
        (profileRows || []).map((profile) => [profile.id, profile.full_name]),
      );
      setMembers(
        (memberRows || []).map((member) => ({
          id: member.user_id,
          name: names.get(member.user_id) || "Team member",
          role: member.role,
        })),
      );
      setSavedViews(savedViewRows || []);
      if (error) setNotice("AIOS could not load the task queue.");
      setTasks((data || []) as Task[]);
      setFilterTimestamp(Date.now());
      setLoading(false);
    };
    void load().catch(() => {
      setNotice("AIOS could not load the task queue.");
      setLoading(false);
    });
  }, []);

  const activeCount = useMemo(
    () =>
      tasks.filter(
        (task) => task.status === "open" || task.status === "in_progress",
      ).length,
    [tasks],
  );
  const overdueCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);
  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const dueSoonBoundary = filterTimestamp + 7 * 24 * 60 * 60 * 1000;
    return tasks.filter((task) => {
      if (
        normalizedQuery &&
        !task.title.toLowerCase().includes(normalizedQuery)
      )
        return false;
      if (
        assigneeFilter === "unassigned"
          ? task.assignee_id !== null
          : assigneeFilter !== "all" &&
            task.assignee_id !== assigneeFilter
      )
        return false;
      if (
        timingFilter === "overdue" &&
        !isOverdue(task, filterTimestamp)
      )
        return false;
      if (timingFilter === "no_due" && task.due_at !== null) return false;
      if (timingFilter === "due_soon") {
        if (
          !task.due_at ||
          task.status === "completed" ||
          task.status === "cancelled"
        )
          return false;
        const dueAt = new Date(task.due_at).getTime();
        if (dueAt < filterTimestamp || dueAt > dueSoonBoundary) return false;
      }
      return true;
    });
  }, [assigneeFilter, filterTimestamp, query, tasks, timingFilter]);

  function selectSavedView(savedViewId: string) {
    setSelectedSavedViewId(savedViewId);
    if (!savedViewId) return;
    const filters = taskFiltersFromSavedView(
      savedViews.find((view) => view.id === savedViewId),
    );
    if (!filters) {
      setNotice("That saved task view could not be read.");
      return;
    }
    setQuery(filters.query);
    setAssigneeFilter(filters.assigneeId);
    setTimingFilter(filters.timing);
  }

  function saveCurrentView(name: string) {
    if (!organizationId || pending) return;
    startTransition(async () => {
      try {
        const savedView = await createSavedView({
          organizationId,
          feature: "tasks",
          name,
          filters: {
            query,
            assigneeId: assigneeFilter,
            timing: timingFilter,
          },
        });
        setSavedViews((current) => [savedView, ...current]);
        setSelectedSavedViewId(savedView.id);
        setNotice(`Saved “${savedView.name}” as a private Tasks view.`);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not save that task view.",
        );
      }
    });
  }

  function removeSavedView() {
    if (!organizationId || !selectedSavedViewId || pending) return;
    startTransition(async () => {
      try {
        await deleteSavedView({
          organizationId,
          savedViewId: selectedSavedViewId,
          feature: "tasks",
        });
        setSavedViews((current) =>
          current.filter((view) => view.id !== selectedSavedViewId),
        );
        setSelectedSavedViewId("");
        setNotice("The private Tasks view was removed.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not remove that task view.",
        );
      }
    });
  }

  function createNewTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || pending) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const dueDate = String(form.get("dueAt") || "");
    const assigneeId = String(form.get("assigneeId") || "") || null;
    if (!title) return;
    startTransition(async () => {
      try {
        const task = await createTask({
          organizationId,
          contactId: null,
          dealId: null,
          title,
          assigneeId,
          dueAt: dueDate ? new Date(`${dueDate}T09:00:00`).toISOString() : null,
        });
        setTasks((current) => [
          {
            id: task.id,
            title: task.title,
            status: task.status,
            due_at: task.due_at,
            created_at: task.created_at,
            completed_at: task.completed_at,
            assignee_id: task.assignee_id,
          },
          ...current,
        ]);
        event.currentTarget.reset();
        setNotice("Follow-up added to the shared task queue.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not create that task.",
        );
      }
    });
  }

  function changeAssignee(task: Task, assigneeId: string | null) {
    if (!organizationId || pending || assigneeId === task.assignee_id) return;
    startTransition(async () => {
      try {
        const updated = await updateTaskAssignee({
          organizationId,
          taskId: task.id,
          assigneeId,
        });
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id
              ? { ...item, assignee_id: updated.assignee_id }
              : item,
          ),
        );
        setNotice(
          updated.assignee_id
            ? "Task ownership updated."
            : "Task returned to the unassigned queue.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not change task ownership.",
        );
      }
    });
  }

  function changeStatus(task: Task, status: TaskStatus) {
    if (!organizationId || pending || status === task.status) return;
    startTransition(async () => {
      try {
        const updated = await updateTaskStatus({
          organizationId,
          taskId: task.id,
          status,
        });
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: updated.status,
                  completed_at: updated.completed_at,
                }
              : item,
          ),
        );
        setNotice(
          status === "completed"
            ? "Task completed and recorded."
            : `Task moved to ${status.replace("_", " ")}.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "AIOS could not update that task.",
        );
      }
    });
  }

  return (
    <main className="tasks-page" id="main-content" tabIndex={-1}>
      <FeatureHeader
        links={[
          { href: "/", label: "Command center" },
          { href: "/aios", label: "AIOS Control" },
        ]}
      />
      <section className="tasks-hero">
        <div>
          <p>OPERATIONS QUEUE</p>
          <h1>Every follow-up has an owner: AIOS or your team.</h1>
          <span>
            Low-risk internal follow-ups may arrive here from approved AIOS
            workflows. Completing or progressing work remains visible and
            auditable.
          </span>
        </div>
        <aside>
          <b>{activeCount}</b>
          <small>active tasks</small>
          <b>{tasks.filter((task) => task.status === "completed").length}</b>
          <small>completed</small>
          <b>{overdueCount}</b>
          <small>overdue</small>
        </aside>
      </section>
      {notice && (
        <p className="tasks-notice" role="status">
          {notice}
        </p>
      )}
      <section className="tasks-create">
        <form onSubmit={createNewTask}>
          <label>
            New follow-up
            <input
              name="title"
              placeholder="Call traveller, review visa requirements, request quote…"
              required
            />
          </label>
          <label>
            Due date
            <input name="dueAt" type="date" />
          </label>
          <label>
            Owner
            <select name="assigneeId" defaultValue="">
              <option value="">Unassigned queue</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.role}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending || !organizationId}>
            {pending ? "Saving…" : "Add task"}
          </button>
        </form>
        <p>
          <span>✦</span> AIOS can create internal tasks under policy. It cannot
          perform external actions here.
        </p>
      </section>
      <section className="tasks-filter-workspace" aria-label="Task filters">
        <div className="tasks-filters">
          <label>
            Search tasks
            <input
              value={query}
              placeholder="Visa, quote, traveller…"
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedSavedViewId("");
              }}
            />
          </label>
          <label>
            Owner
            <select
              value={assigneeFilter}
              onChange={(event) => {
                setAssigneeFilter(event.target.value);
                setSelectedSavedViewId("");
              }}
            >
              <option value="all">Every owner</option>
              <option value="unassigned">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due state
            <select
              value={timingFilter}
              onChange={(event) => {
                setTimingFilter(event.target.value as TaskTiming);
                setSelectedSavedViewId("");
              }}
            >
              <option value="all">Any due state</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due in 7 days</option>
              <option value="no_due">No due date</option>
            </select>
          </label>
          <span>{visibleTasks.length} matching tasks</span>
        </div>
        <SavedViewControls
          areaLabel="Tasks"
          disabled={pending || !organizationId}
          selectedId={selectedSavedViewId}
          views={savedViews}
          onSelect={selectSavedView}
          onSave={saveCurrentView}
          onRemove={removeSavedView}
        />
      </section>
      <section className="task-board" aria-label="Task workflow board">
        {columns.map((column) => {
          const items = visibleTasks.filter(
            (task) => task.status === column.status,
          );
          return (
            <section className="task-column" key={column.status}>
              <header>
                <div>
                  <p>{column.label.toUpperCase()}</p>
                  <h2>{column.label}</h2>
                  <span>{column.description}</span>
                </div>
                <b>{items.length}</b>
              </header>
              {loading ? (
                <LoadingState label={`Loading ${column.label} tasks`} rows={2} />
              ) : items.length === 0 ? (
                <EmptyState
                  compact
                  title="Nothing here yet"
                  description={column.description}
                />
              ) : (
                items.map((task) => (
                  <article
                    className={`task-card ${isOverdue(task) ? "overdue" : ""}`}
                    key={task.id}
                  >
                    <div className="task-card-head">
                      <i className={task.status}>
                        {task.status === "completed"
                          ? "✓"
                          : task.status === "in_progress"
                            ? "→"
                            : "•"}
                      </i>
                      <small>
                        {isOverdue(task)
                          ? `Overdue since ${formatDate(task.due_at)}`
                          : task.due_at
                            ? `Due ${formatDate(task.due_at)}`
                            : "No due date"}
                      </small>
                    </div>
                    <h3>{task.title}</h3>
                    <label className="task-assignee">
                      Owner
                      <select
                        value={task.assignee_id || ""}
                        disabled={pending}
                        onChange={(event) =>
                          changeAssignee(task, event.target.value || null)
                        }
                      >
                        <option value="">Unassigned queue</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <footer>
                      {task.status === "open" && (
                        <button
                          type="button"
                          onClick={() => changeStatus(task, "in_progress")}
                          disabled={pending}
                        >
                          Start work
                        </button>
                      )}
                      {task.status === "in_progress" && (
                        <>
                          <button
                            type="button"
                            className="quiet"
                            onClick={() => changeStatus(task, "open")}
                            disabled={pending}
                          >
                            Pause
                          </button>
                          <button
                            type="button"
                            onClick={() => changeStatus(task, "completed")}
                            disabled={pending}
                          >
                            Complete
                          </button>
                        </>
                      )}
                      {task.status === "completed" && (
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => changeStatus(task, "open")}
                          disabled={pending}
                        >
                          Reopen
                        </button>
                      )}
                    </footer>
                  </article>
                ))
              )}
            </section>
          );
        })}
      </section>
    </main>
  );
}
