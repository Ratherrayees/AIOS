export type ItineraryConflict = {
  code: "duplicate_item" | "outside_trip_dates" | "invalid_time_range" | "overlapping_times";
  message: string;
  itemIds: string[];
};

type ConflictItem = {
  id: string;
  dayNumber: number;
  itemType: string;
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
};

function normalizedKey(item: ConflictItem) {
  return `${item.dayNumber}:${item.itemType}:${item.title.trim().toLowerCase()}`;
}

/**
 * Finds deterministic planning conflicts without claiming availability or
 * making any booking decision. Timed entries are checked only when both ends
 * are supplied; unscheduled items remain valid internal planning notes.
 */
export function assessItineraryConflicts(input: {
  startDate: string | null;
  endDate: string | null;
  items: ConflictItem[];
}) {
  const conflicts: ItineraryConflict[] = [];
  const duplicates = new Map<string, ConflictItem[]>();
  for (const item of input.items) {
    const key = normalizedKey(item);
    duplicates.set(key, [...(duplicates.get(key) || []), item]);
  }
  for (const duplicateItems of duplicates.values()) {
    if (duplicateItems.length > 1)
      conflicts.push({
        code: "duplicate_item",
        message: `Day ${duplicateItems[0]?.dayNumber} repeats "${duplicateItems[0]?.title}".`,
        itemIds: duplicateItems.map((item) => item.id),
      });
  }

  if (input.startDate && input.endDate) {
    const durationDays =
      Math.floor(
        (Date.parse(`${input.endDate}T00:00:00Z`) -
          Date.parse(`${input.startDate}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    for (const item of input.items) {
      if (item.dayNumber > durationDays)
        conflicts.push({
          code: "outside_trip_dates",
          message: `Day ${item.dayNumber} falls outside the known trip dates.`,
          itemIds: [item.id],
        });
    }
  }

  const timedByDay = new Map<number, ConflictItem[]>();
  for (const item of input.items) {
    if (!item.startsAt || !item.endsAt) continue;
    if (Date.parse(item.endsAt) <= Date.parse(item.startsAt)) {
      conflicts.push({
        code: "invalid_time_range",
        message: `"${item.title}" has an invalid start or end time.`,
        itemIds: [item.id],
      });
      continue;
    }
    timedByDay.set(item.dayNumber, [...(timedByDay.get(item.dayNumber) || []), item]);
  }
  for (const timedItems of timedByDay.values()) {
    const ordered = [...timedItems].sort(
      (left, right) => Date.parse(left.startsAt || "") - Date.parse(right.startsAt || ""),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (
        previous &&
        current &&
        Date.parse(previous.endsAt || "") > Date.parse(current.startsAt || "")
      )
        conflicts.push({
          code: "overlapping_times",
          message: `"${previous.title}" overlaps "${current.title}" on day ${current.dayNumber}.`,
          itemIds: [previous.id, current.id],
        });
    }
  }
  return conflicts;
}
