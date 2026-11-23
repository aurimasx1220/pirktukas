import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null | undefined;

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  return Boolean(url && key);
}

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient !== undefined) return supabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  if (!url || !key) {
    supabaseClient = null;
    return null;
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}
