import { createBrowserClient } from "@supabase/ssr";
import { getBrowserEnv } from "../env";
import type { Database } from "../../types/app-database";

export function createSupabaseBrowserClient() {
  const env = getBrowserEnv();
  return createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
