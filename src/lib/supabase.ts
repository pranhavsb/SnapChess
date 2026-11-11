import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Null when the env vars are missing; the app keeps working offline without uploads. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

if (!supabase) {
  console.warn(
    "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env",
  );
}

let userIdPromise: Promise<string | null> | null = null;

/**
 * Signs in anonymously on first load and reuses the stored session afterwards.
 * The returned user id is what RLS checks (auth.uid()) and is also the session_id
 * written with every scan label.
 */
export function ensureAnonymousUser(): Promise<string | null> {
  if (userIdPromise) return userIdPromise;
  userIdPromise = (async () => {
    if (!supabase) return null;
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session) return existing.session.user.id;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn(`Anonymous sign-in failed: ${error.message}`);
      return null;
    }
    return data.user?.id ?? null;
  })();
  userIdPromise.then((id) => {
    if (id === null) userIdPromise = null;
  });
  return userIdPromise;
}

/** Same value as the user id, named for the scan_labels.session_id column. */
export const getSessionId = ensureAnonymousUser;
