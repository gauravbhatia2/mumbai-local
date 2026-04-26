export const REFRESH_STALE_HOURS = Number.parseInt(
  process.env.REFRESH_STALE_HOURS ?? "36",
  10,
);

export function hasSupabaseConfig() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

export function canUseDemoData() {
  return !isProductionRuntime() && !hasSupabaseConfig();
}

export function isSearchConfigured() {
  return hasSupabaseConfig();
}

export function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? "";
}
