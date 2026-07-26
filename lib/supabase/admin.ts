import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";
import type { Database } from "../../types/app-database";

/** Server-only client for narrowly scoped administrative workflows. */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
