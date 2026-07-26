export type DuplicateComparableContact = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  created_at: string;
};

export type ContactDuplicateCandidate = {
  primary: DuplicateComparableContact;
  duplicate: DuplicateComparableContact;
  reason: "email" | "phone" | "name_and_company";
};

function normalizedText(value: string | null) {
  return (value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizedPhone(value: string | null) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : "";
}

function matchReason(
  left: DuplicateComparableContact,
  right: DuplicateComparableContact,
) {
  const leftEmail = normalizedText(left.email);
  const rightEmail = normalizedText(right.email);
  if (leftEmail && leftEmail === rightEmail) return "email" as const;

  const leftPhone = normalizedPhone(left.phone);
  const rightPhone = normalizedPhone(right.phone);
  if (leftPhone && leftPhone === rightPhone) return "phone" as const;

  const leftName = normalizedText(
    `${left.first_name} ${left.last_name || ""}`,
  );
  const rightName = normalizedText(
    `${right.first_name} ${right.last_name || ""}`,
  );
  if (
    leftName &&
    leftName === rightName &&
    left.company_id &&
    left.company_id === right.company_id
  )
    return "name_and_company" as const;
  return null;
}

/** Returns review candidates only; it never merges or scores a contact. */
export function findContactDuplicateCandidates(
  contacts: DuplicateComparableContact[],
) {
  const sorted = [...contacts].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
  const candidates: ContactDuplicateCandidate[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sorted.length;
      rightIndex += 1
    ) {
      const primary = sorted[leftIndex]!;
      const duplicate = sorted[rightIndex]!;
      const reason = matchReason(primary, duplicate);
      if (reason) candidates.push({ primary, duplicate, reason });
    }
  }
  return candidates;
}
