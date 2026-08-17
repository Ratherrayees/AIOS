import { createHash } from "node:crypto";

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const DEMO_MARKER = "AIOS MVP DEMO";

function deterministicUuid(namespace, label) {
  const hex = createHash("sha256")
    .update(`${namespace}:${DEMO_MARKER}:${label}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function isoAt(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function dateAt(offsetDays) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function targetOrganizationArgument() {
  const cli = process.argv.find((value) => value.startsWith("--organization="));
  return cli?.slice("--organization=".length) || process.env.SEED_ORGANIZATION_ID;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let organizationId = targetOrganizationArgument();
  if (!organizationId) {
    const { data: organizations, error } = await supabase
      .from("organizations")
      .select("id, name")
      .order("created_at");
    if (error) throw error;
    if (organizations.length !== 1) {
      throw new Error(
        "Set SEED_ORGANIZATION_ID or pass --organization=<uuid> when more than one agency exists.",
      );
    }
    organizationId = organizations[0].id;
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError || !organization) {
    throw organizationError || new Error("The target agency was not found.");
  }

  const { data: member, error: memberError } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (memberError || !member) {
    throw memberError || new Error("The demo seed needs an active owner or admin.");
  }
  const actorId = member.user_id;
  const id = (label) => deterministicUuid(organizationId, label);

  async function upsert(table, rows) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async function insertMissing(table, rows) {
    const ids = rows.map((row) => row.id);
    const { data: existing, error: readError } = await supabase
      .from(table)
      .select("id")
      .in("id", ids);
    if (readError) throw new Error(`${table}: ${readError.message}`);
    const present = new Set((existing || []).map((row) => row.id));
    const missing = rows.filter((row) => !present.has(row.id));
    if (!missing.length) return;
    const { error } = await supabase.from(table).insert(missing);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  const companyIds = [id("company-northstar"), id("company-orbit")];
  await upsert("companies", [
    {
      id: companyIds[0],
      organization_id: organizationId,
      owner_id: actorId,
      name: "Northstar Design Collective [DEMO]",
      email: "travel@northstar-demo.example.invalid",
      website: "https://northstar-demo.example.invalid",
    },
    {
      id: companyIds[1],
      organization_id: organizationId,
      owner_id: actorId,
      name: "Orbit Labs [DEMO]",
      email: "people@orbit-demo.example.invalid",
      website: "https://orbit-demo.example.invalid",
    },
  ]);

  const contacts = [
    ["aisha", "Aisha", "Khan", companyIds[0], "email", "Asia/Kolkata"],
    ["rahul", "Rahul", "Sharma", companyIds[0], "whatsapp", "Asia/Kolkata"],
    ["meera", "Meera", "Patel", companyIds[1], "email", "Asia/Kolkata"],
    ["kabir", "Kabir", "Dar", null, "phone", "Asia/Kolkata"],
    ["sana", "Sana", "Mir", null, "email", "Asia/Kolkata"],
    ["arjun", "Arjun", "Rao", companyIds[1], "whatsapp", "Asia/Kolkata"],
    ["nida", "Nida", "Bashir", null, "email", "Asia/Kolkata"],
  ].map(([key, firstName, lastName, companyId, channel, timeZone], index) => ({
    id: id(`contact-${key}`),
    organization_id: organizationId,
    owner_id: actorId,
    company_id: companyId,
    first_name: firstName,
    last_name: lastName,
    email: `${key}.traveller.${index + 1}@aios-demo.example.invalid`,
    phone: `+91990000${String(1000 + index)}`,
    preferred_channel: channel,
    preferred_locale: "en-IN",
    time_zone: timeZone,
    communication_consent: "granted",
    consent_recorded_at: isoAt(-30 * 86_400_000),
    consent_source: `${DEMO_MARKER} fixture`,
  }));
  await upsert("contacts", contacts);

  const dealRows = [
    {
      key: "unassigned-maldives",
      contact: 0,
      owner_id: null,
      title: "Maldives honeymoon enquiry [DEMO]",
      stage: "new",
      destination: "Maldives",
      value_amount: 240000,
      probability: 25,
      first_response_due_at: isoAt(-3 * 3_600_000),
      first_responded_at: null,
      next_step: null,
      notes: "Two adults, flexible dates in November, private pool preferred. Budget approximately INR 240,000.",
    },
    {
      key: "qualified-dubai",
      contact: 1,
      owner_id: actorId,
      title: "Dubai family holiday [DEMO]",
      stage: "qualified",
      destination: "Dubai",
      value_amount: 185000,
      probability: 60,
      first_response_due_at: isoAt(-5 * 86_400_000),
      first_responded_at: isoAt(-5 * 86_400_000 + 900_000),
      follow_up_due_at: isoAt(-7 * 3_600_000),
      next_step: "Confirm children’s ages and passport validity",
      notes: "Family of four considering Dubai for six nights. Need children ages and passport status before proposal.",
    },
    {
      key: "proposal-japan",
      contact: 2,
      owner_id: actorId,
      title: "Japan design tour [DEMO]",
      stage: "proposal",
      destination: "Tokyo and Kyoto",
      value_amount: 520000,
      probability: 75,
      first_response_due_at: isoAt(-10 * 86_400_000),
      first_responded_at: isoAt(-10 * 86_400_000 + 600_000),
      follow_up_due_at: isoAt(20 * 3_600_000),
      next_step: "Review rail-pass and ryokan options",
      notes: "Two travellers; architecture, food and slow travel. Dates confirmed for March.",
    },
    {
      key: "decision-turkey",
      contact: 3,
      owner_id: actorId,
      title: "Türkiye cultural circuit [DEMO]",
      stage: "decision",
      destination: "Istanbul and Cappadocia",
      value_amount: 310000,
      probability: 85,
      first_responded_at: isoAt(-12 * 86_400_000),
      follow_up_due_at: isoAt(24 * 3_600_000),
      next_step: "Customer deciding between two hotel options",
      notes: "Quote shared internally for demonstration; no external booking commitment exists.",
    },
    {
      key: "won-bali",
      contact: 4,
      owner_id: actorId,
      title: "Bali wellness retreat [DEMO]",
      stage: "won",
      destination: "Bali",
      value_amount: 275000,
      probability: 100,
      won_at: isoAt(-14 * 86_400_000),
      first_responded_at: isoAt(-20 * 86_400_000),
      next_step: "Complete supplier confirmations and collect final balance",
      notes: "Confirmed customer intent. Supplier follow-ups remain approval-gated.",
    },
    {
      key: "lost-europe",
      contact: 5,
      owner_id: actorId,
      title: "Central Europe summer [DEMO]",
      stage: "lost",
      destination: "Prague and Vienna",
      value_amount: 430000,
      probability: 0,
      lost_at: isoAt(-20 * 86_400_000),
      lost_reason: "Customer postponed travel",
      first_responded_at: isoAt(-30 * 86_400_000),
      next_step: null,
      notes: "Retained as fictional loss analytics evidence.",
    },
    {
      key: "new-ladakh",
      contact: 6,
      owner_id: actorId,
      title: "Ladakh private journey [DEMO]",
      stage: "new",
      destination: "Ladakh",
      value_amount: 195000,
      probability: 30,
      first_response_due_at: isoAt(45 * 60_000),
      next_step: "Call to confirm acclimatization requirements",
      notes: "Three travellers considering a seven-night private trip in September.",
    },
  ].map((row, index) => ({
    id: id(`deal-${row.key}`),
    organization_id: organizationId,
    created_at: isoAt(-(45 - index * 3) * 86_400_000),
    stage_entered_at: isoAt(-(20 - index * 2) * 86_400_000),
    contact_id: contacts[row.contact].id,
    owner_id: row.owner_id,
    title: row.title,
    stage: row.stage,
    destination: row.destination,
    value_amount: row.value_amount,
    currency: "INR",
    probability: row.probability,
    source: index % 2 === 0 ? "Website demo" : "Referral demo",
    source_campaign: `${DEMO_MARKER} August`,
    expected_close_at: row.stage === "won" || row.stage === "lost" ? dateAt(-14) : dateAt(14 + index * 3),
    travel_start: dateAt(60 + index * 5),
    travel_end: dateAt(66 + index * 5),
    traveller_count: index === 1 ? 4 : index === 6 ? 3 : 2,
    first_response_due_at: row.first_response_due_at || null,
    first_responded_at: row.first_responded_at || null,
    follow_up_due_at: row.follow_up_due_at || null,
    next_step: row.next_step,
    notes: row.notes,
    won_at: row.won_at || null,
    lost_at: row.lost_at || null,
    lost_reason: row.lost_reason || null,
    last_activity_at: isoAt(-(index + 1) * 86_400_000),
    qualified_at: ["qualified", "proposal", "decision", "won"].includes(row.stage)
      ? isoAt(-(index + 8) * 86_400_000)
      : null,
  }));
  await upsert("deals", dealRows);

  const conversationRows = [
    {
      key: "maldives-email",
      contact: 0,
      deal: 0,
      channel: "email",
      status: "open",
      priority: "high",
      assignee_id: actorId,
      subject: "Honeymoon villa options",
      response_due_at: isoAt(-2 * 3_600_000),
      last_message_at: isoAt(-3 * 3_600_000),
    },
    {
      key: "dubai-whatsapp",
      contact: 1,
      deal: 1,
      channel: "whatsapp",
      status: "inbox",
      priority: "urgent",
      assignee_id: null,
      subject: "Revised Dubai stay",
      response_due_at: isoAt(-70 * 60_000),
      last_message_at: isoAt(-80 * 60_000),
    },
    {
      key: "japan-email",
      contact: 2,
      deal: 2,
      channel: "email",
      status: "pending",
      priority: "normal",
      assignee_id: actorId,
      subject: "Japan itinerary feedback",
      response_due_at: isoAt(18 * 3_600_000),
      last_message_at: isoAt(-10 * 3_600_000),
    },
    {
      key: "turkey-phone",
      contact: 3,
      deal: 3,
      channel: "phone",
      status: "closed",
      priority: "normal",
      assignee_id: actorId,
      subject: "Hotel shortlist call",
      response_due_at: null,
      last_message_at: isoAt(-2 * 86_400_000),
    },
  ].map((row) => ({
    id: id(`conversation-${row.key}`),
    organization_id: organizationId,
    contact_id: contacts[row.contact].id,
    deal_id: dealRows[row.deal].id,
    external_id: `${DEMO_MARKER.toLowerCase().replaceAll(" ", "-")}:${row.key}`,
    channel: row.channel,
    status: row.status,
    priority: row.priority,
    assignee_id: row.assignee_id,
    subject: `${row.subject} [DEMO]`,
    response_due_at: row.response_due_at,
    last_message_at: row.last_message_at,
  }));
  await upsert("conversations", conversationRows);

  await insertMissing(
    "messages",
    [
      ["maldives-1", 0, "inbound", "We are planning our honeymoon for November. Can you suggest a quiet water villa with a private pool?", -3 * 3_600_000],
      ["maldives-2", 0, "internal", "Demo note: confirm exact dates and meal-plan preference before drafting a quote.", -2.8 * 3_600_000],
      ["dubai-1", 1, "inbound", "Can you revise this for six nights? We are two adults and two children, but I still need to send their ages.", -80 * 60_000],
      ["japan-1", 2, "outbound", "We have prepared a Tokyo and Kyoto outline for your review.", -12 * 3_600_000],
      ["japan-2", 2, "inbound", "Please include one ryokan night and keep the pace relaxed. We prefer food and architecture experiences.", -10 * 3_600_000],
      ["turkey-1", 3, "internal", "Demo call completed; customer is comparing two hotel categories.", -2 * 86_400_000],
    ].map(([key, conversation, direction, body, offset]) => ({
      id: id(`message-${key}`),
      organization_id: organizationId,
      conversation_id: conversationRows[conversation].id,
      direction,
      body,
      sent_at: isoAt(offset),
      author_id: direction === "inbound" ? null : actorId,
      provider: null,
      external_id: `${DEMO_MARKER}:${key}`,
      sender_address:
        direction === "inbound"
          ? contacts[[0, 1, 2, 3][conversation]].email
          : "team@agency-demo.example.invalid",
      recipient_addresses:
        direction === "inbound"
          ? ["inbox@agency-demo.example.invalid"]
          : [contacts[[0, 1, 2, 3][conversation]].email],
      subject: conversationRows[conversation].subject,
      metadata: { fixture: DEMO_MARKER },
    })),
  );

  const quoteRows = [
    {
      key: "japan",
      deal: 2,
      title: "Japan slow-design proposal [DEMO]",
      status: "draft",
      total: 520000,
      net: 464285.71,
      tax: 55714.29,
      margin: 104285.71,
    },
    {
      key: "turkey",
      deal: 3,
      title: "Türkiye cultural circuit [DEMO]",
      status: "shared",
      total: 310000,
      net: 276785.71,
      tax: 33214.29,
      margin: 56785.71,
    },
    {
      key: "bali",
      deal: 4,
      title: "Bali wellness retreat [DEMO]",
      status: "accepted",
      total: 275000,
      net: 245535.71,
      tax: 29464.29,
      margin: 55535.71,
      accepted_at: isoAt(-14 * 86_400_000),
    },
  ].map((row) => ({
    id: id(`quote-${row.key}`),
    organization_id: organizationId,
    deal_id: dealRows[row.deal].id,
    owner_id: actorId,
    title: row.title,
    status: row.status,
    current_version: 1,
    currency: "INR",
    valid_until: dateAt(14),
    accepted_at: row.accepted_at || null,
    fixture: row,
  }));
  await upsert(
    "quotes",
    quoteRows.map(({ fixture, ...row }) => {
      void fixture;
      return row;
    }),
  );
  await insertMissing(
    "quote_versions",
    quoteRows.map((quote) => ({
      id: id(`quote-version-${quote.fixture.key}-1`),
      organization_id: organizationId,
      quote_id: quote.id,
      version: 1,
      itinerary_snapshot: {
        summary: `${quote.fixture.title} customer proposal fixture`,
        inclusions: ["Accommodation", "Private transfers", "Selected experiences"],
      },
      // Protected supplier costs live in the structured commercial tables.
      // The legacy JSON column is database-constrained to remain empty.
      cost_lines: [],
      net_amount: quote.fixture.net,
      tax_amount: quote.fixture.tax,
      total_amount: quote.fixture.total,
      margin_amount: quote.fixture.margin,
      margin_percent: Number(((quote.fixture.margin / quote.fixture.net) * 100).toFixed(4)),
      terms_snapshot: { payment: "Demo only; no external commitment" },
      created_by: actorId,
    })),
  );

  const supplierRows = [
    {
      key: "bali-hotel",
      name: "Serene Ubud Resort [DEMO]",
      category: "hotel",
      email: "reservations@serene-ubud.example.invalid",
      quality_rating: 4.6,
    },
    {
      key: "bali-ground",
      name: "Island Ground Services [DEMO]",
      category: "destination_management",
      email: "ops@island-ground.example.invalid",
      quality_rating: 4.3,
    },
    {
      key: "japan-ground",
      name: "Kyoto Journey Partners [DEMO]",
      category: "destination_management",
      email: "team@kyoto-journey.example.invalid",
      quality_rating: 4.8,
    },
  ].map((row) => ({
    id: id(`supplier-${row.key}`),
    organization_id: organizationId,
    name: row.name,
    category: row.category,
    email: row.email,
    preferred_currency: "INR",
    status: "active",
    quality_rating: row.quality_rating,
    payment_terms_days: 14,
    cancellation_terms: "Demo fixture; confirm the live supplier contract before commitment.",
    terms: { fixture: DEMO_MARKER },
  }));
  await upsert("suppliers", supplierRows);

  const tripRows = [
    {
      key: "bali-upcoming",
      deal: 4,
      quote: 2,
      name: "Bali wellness retreat [DEMO]",
      destination: "Bali",
      status: "confirmed",
      start: dateAt(5),
      end: dateAt(11),
      zone: "Asia/Makassar",
    },
    {
      key: "dubai-live",
      deal: 1,
      quote: null,
      name: "Dubai family on-trip simulation [DEMO]",
      destination: "Dubai",
      status: "in_travel",
      start: dateAt(-1),
      end: dateAt(3),
      zone: "Asia/Dubai",
    },
    {
      key: "japan-completed",
      deal: null,
      quote: null,
      name: "Japan completed operations sample [DEMO]",
      destination: "Tokyo",
      status: "completed",
      start: dateAt(-50),
      end: dateAt(-42),
      zone: "Asia/Tokyo",
    },
  ].map((row) => ({
    id: id(`trip-${row.key}`),
    organization_id: organizationId,
    deal_id: row.deal == null ? null : dealRows[row.deal].id,
    quote_id: row.quote == null ? null : quoteRows[row.quote].id,
    owner_id: actorId,
    name: row.name,
    destination: row.destination,
    status: row.status,
    start_date: row.start,
    end_date: row.end,
    time_zone: row.zone,
    currency: "INR",
    operations_notes: `${DEMO_MARKER}: exercise readiness, bookings, documents, tasks and payment exceptions.`,
  }));
  await upsert("trips", tripRows);

  await upsert("travelers", [
    {
      id: id("traveler-bali-lead"),
      organization_id: organizationId,
      trip_id: tripRows[0].id,
      contact_id: contacts[4].id,
      first_name: "Sana",
      last_name: "Mir",
      email: contacts[4].email,
      role: "lead_traveler",
      preferences: { wellness: true, fixture: DEMO_MARKER },
    },
    {
      id: id("traveler-bali-guest"),
      organization_id: organizationId,
      trip_id: tripRows[0].id,
      first_name: "Adil",
      last_name: "Mir",
      email: "adil.traveller@aios-demo.example.invalid",
      role: "traveler",
      preferences: { vegetarian: true, fixture: DEMO_MARKER },
    },
    {
      id: id("traveler-dubai-lead"),
      organization_id: organizationId,
      trip_id: tripRows[1].id,
      contact_id: contacts[1].id,
      first_name: "Rahul",
      last_name: "Sharma",
      email: contacts[1].email,
      role: "lead_traveler",
      preferences: { family_room: true, fixture: DEMO_MARKER },
    },
  ]);

  const bookingRows = [
    {
      key: "bali-hotel",
      trip: 0,
      supplier: 0,
      type: "hotel",
      status: "confirmed",
      title: "Ubud resort stay [DEMO]",
      reference: "DEMO-UBUD-001",
      start: isoAt(5 * 86_400_000),
      end: isoAt(9 * 86_400_000),
      cost: 92000,
      confirmed: isoAt(-3 * 86_400_000),
    },
    {
      key: "bali-transfer",
      trip: 0,
      supplier: 1,
      type: "transfer",
      status: "requested",
      title: "Airport transfer awaiting confirmation [DEMO]",
      reference: null,
      start: isoAt(5 * 86_400_000),
      end: isoAt(5 * 86_400_000 + 7_200_000),
      cost: 8500,
      confirmed: null,
    },
    {
      key: "dubai-activity",
      trip: 1,
      supplier: 1,
      type: "activity",
      status: "failed",
      title: "Desert activity service failure [DEMO]",
      reference: null,
      start: isoAt(20 * 3_600_000),
      end: isoAt(25 * 3_600_000),
      cost: 18000,
      confirmed: null,
    },
  ].map((row) => ({
    id: id(`booking-${row.key}`),
    organization_id: organizationId,
    trip_id: tripRows[row.trip].id,
    supplier_id: supplierRows[row.supplier].id,
    booking_type: row.type,
    status: row.status,
    title: row.title,
    confirmation_reference: row.reference,
    service_start_at: row.start,
    service_end_at: row.end,
    cost_amount: row.cost,
    currency: "INR",
    confirmed_at: row.confirmed,
    details: { fixture: DEMO_MARKER },
  }));
  await upsert("bookings", bookingRows);

  await upsert("itinerary_items", [
    {
      id: id("itinerary-bali-arrival"),
      organization_id: organizationId,
      trip_id: tripRows[0].id,
      booking_id: bookingRows[1].id,
      day_number: 1,
      position: 0,
      item_type: "transfer",
      title: "Airport arrival and Ubud transfer [DEMO]",
      starts_at: isoAt(5 * 86_400_000),
      ends_at: isoAt(5 * 86_400_000 + 7_200_000),
      time_zone: "Asia/Makassar",
      location: { name: "Ngurah Rai International Airport" },
      content: { status: "awaiting supplier confirmation", fixture: DEMO_MARKER },
    },
    {
      id: id("itinerary-bali-checkin"),
      organization_id: organizationId,
      trip_id: tripRows[0].id,
      booking_id: bookingRows[0].id,
      day_number: 1,
      position: 1,
      item_type: "stay",
      title: "Ubud resort check-in [DEMO]",
      time_zone: "Asia/Makassar",
      location: { name: "Ubud" },
      content: { fixture: DEMO_MARKER },
    },
    {
      id: id("itinerary-bali-wellness"),
      organization_id: organizationId,
      trip_id: tripRows[0].id,
      day_number: 2,
      position: 0,
      item_type: "activity",
      title: "Guided wellness morning [DEMO]",
      time_zone: "Asia/Makassar",
      location: { name: "Ubud" },
      content: { confirmation_required: true, fixture: DEMO_MARKER },
    },
  ]);

  await upsert("payments", [
    {
      id: id("payment-bali-receivable"),
      organization_id: organizationId,
      deal_id: dealRows[4].id,
      trip_id: tripRows[0].id,
      title: "Bali customer final balance [DEMO]",
      direction: "receivable",
      status: "overdue",
      amount: 165000,
      paid_amount: 55000,
      currency: "INR",
      due_at: dateAt(-2),
      description: "Demo outstanding customer balance; no bank settlement implied.",
      created_by: actorId,
    },
    {
      id: id("payment-bali-payable"),
      organization_id: organizationId,
      deal_id: dealRows[4].id,
      trip_id: tripRows[0].id,
      supplier_id: supplierRows[0].id,
      title: "Ubud resort supplier balance [DEMO]",
      direction: "payable",
      status: "pending",
      amount: 92000,
      paid_amount: 0,
      currency: "INR",
      due_at: dateAt(1),
      description: "Demo supplier obligation; no payment instruction exists.",
      created_by: actorId,
    },
    {
      id: id("payment-japan-paid"),
      organization_id: organizationId,
      title: "Completed Japan receivable [DEMO]",
      direction: "receivable",
      status: "paid",
      amount: 350000,
      paid_amount: 350000,
      currency: "INR",
      due_at: dateAt(-55),
      paid_at: isoAt(-54 * 86_400_000),
      description: "Historical demo settlement evidence.",
      created_by: actorId,
    },
  ]);

  await upsert("tasks", [
    {
      id: id("task-dubai-overdue"),
      organization_id: organizationId,
      contact_id: contacts[1].id,
      deal_id: dealRows[1].id,
      assignee_id: actorId,
      title: "Confirm Dubai children’s ages [DEMO]",
      status: "open",
      due_at: isoAt(-5 * 3_600_000),
    },
    {
      id: id("task-bali-supplier"),
      organization_id: organizationId,
      contact_id: contacts[4].id,
      deal_id: dealRows[4].id,
      trip_id: tripRows[0].id,
      assignee_id: actorId,
      title: "Review Bali transfer confirmation [DEMO]",
      status: "in_progress",
      due_at: isoAt(6 * 3_600_000),
    },
    {
      id: id("task-japan-quote"),
      organization_id: organizationId,
      contact_id: contacts[2].id,
      deal_id: dealRows[2].id,
      assignee_id: actorId,
      title: "Review Japan quote draft [DEMO]",
      status: "open",
      due_at: isoAt(20 * 3_600_000),
    },
    {
      id: id("task-completed"),
      organization_id: organizationId,
      deal_id: dealRows[3].id,
      assignee_id: actorId,
      title: "Complete hotel shortlist call [DEMO]",
      status: "completed",
      completed_at: isoAt(-2 * 86_400_000),
      due_at: isoAt(-3 * 86_400_000),
    },
  ]);

  const knowledgeSourceId = id("knowledge-source-bali-operations");
  await insertMissing("knowledge_sources", [
    {
      id: knowledgeSourceId,
      organization_id: organizationId,
      title: "Bali operations handbook [DEMO]",
      source_kind: "destination_guide",
      authority: "internal",
      status: "approved",
      sensitivity: "normal",
      version_label: "demo-1",
      source_url: "https://knowledge-demo.example.invalid/bali-operations",
      summary: "Fictional approved evidence for testing grounded AIOS answers.",
      valid_from: dateAt(-30),
      review_due_on: dateAt(120),
      created_by: actorId,
      reviewed_by: actorId,
      reviewed_at: isoAt(-2 * 86_400_000),
    },
  ]);
  await insertMissing("knowledge_sections", [
    {
      id: id("knowledge-section-bali-transfer"),
      organization_id: organizationId,
      source_id: knowledgeSourceId,
      heading: "Arrival transfers",
      content: "For this demo workflow, arrival transfers must be reconfirmed 72 hours before arrival and the confirmation reference must be recorded in Trip Operations.",
      citation_label: "Bali operations handbook [DEMO] — Arrival transfers",
      position: 0,
      created_by: actorId,
    },
    {
      id: id("knowledge-section-bali-voucher"),
      organization_id: organizationId,
      source_id: knowledgeSourceId,
      heading: "Traveller vouchers",
      content: "For this demo workflow, hotel and transfer vouchers are reviewed internally before any traveller-facing document is shared.",
      citation_label: "Bali operations handbook [DEMO] — Traveller vouchers",
      position: 1,
      created_by: actorId,
    },
  ]);

  const countTables = [
    "contacts",
    "deals",
    "conversations",
    "messages",
    "tasks",
    "quotes",
    "trips",
    "travelers",
    "bookings",
    "itinerary_items",
    "suppliers",
    "payments",
    "knowledge_sources",
    "knowledge_sections",
  ];
  const counts = {};
  for (const table of countTables) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    if (error) throw new Error(`${table}: ${error.message}`);
    counts[table] = count || 0;
  }
  console.log(
    JSON.stringify({
      seeded: true,
      marker: DEMO_MARKER,
      organization: { id: organization.id, name: organization.name },
      counts,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
