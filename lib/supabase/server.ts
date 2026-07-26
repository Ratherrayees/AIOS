import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getBrowserEnv } from "../env";
import type { Database } from "../../types/app-database";

/**
 * Request-scoped Supabase client. Use this for authenticated application work.
 * Never use a service-role key in a browser component or a general request path.
 */
export async function createSupabaseServerClient() {
  const env = getBrowserEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot modify response cookies. Middleware/route
          // handlers own refresh-cookie writes.
        }
      },
    },
  });
}
