type AssignedTimedWork = {
  assignee_id: string | null;
  status: string;
  due_at: string | null;
};

type AssignedConversation = {
  assignee_id: string | null;
  status: string;
  response_due_at: string | null;
};

type OwnedTrip = {
  owner_id: string | null;
  status: string;
};

function isBefore(value: string | null, now: number) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp < now;
}

export function summarizeDailyWorkAttention(input: {
  userId: string;
  now: number;
  tasks: readonly AssignedTimedWork[];
  conversations: readonly AssignedConversation[];
  trips: readonly OwnedTrip[];
}) {
  const activeTasks = input.tasks.filter(
    (task) => task.status === "open" || task.status === "in_progress",
  );
  const overdueTasks = activeTasks.filter((task) =>
    isBefore(task.due_at, input.now),
  );
  const overdueConversations = input.conversations.filter(
    (conversation) =>
      conversation.status !== "closed" &&
      isBefore(conversation.response_due_at, input.now),
  );
  const activeTrips = input.trips.filter(
    (trip) => trip.status !== "completed" && trip.status !== "cancelled",
  );

  return {
    tasks: {
      mineOverdue: overdueTasks.filter(
        (task) => task.assignee_id === input.userId,
      ).length,
      workspaceOverdue: overdueTasks.length,
      workspaceActive: activeTasks.length,
    },
    inbox: {
      mineOverdue: overdueConversations.filter(
        (conversation) => conversation.assignee_id === input.userId,
      ).length,
      workspaceOverdue: overdueConversations.length,
    },
    trips: {
      mineActive: activeTrips.filter((trip) => trip.owner_id === input.userId)
        .length,
      workspaceActive: activeTrips.length,
    },
  };
}
