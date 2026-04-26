import { unstable_cache } from "next/cache";
import {
  REFRESH_STALE_HOURS,
  canUseDemoData,
  hasSupabaseConfig,
  isProductionRuntime,
  isSearchConfigured,
} from "@/lib/env";
import { demoRefreshMetadata, demoStations } from "@/lib/mock-data";
import { createSupabaseAdmin } from "@/lib/supabase";
import { hoursSince } from "@/lib/time";
import type { RefreshMetadata, RuntimeStatus, StationOption } from "@/lib/types";

function normalizeRefreshMetadata(
  freshness: RefreshMetadata,
): RefreshMetadata {
  const isStale = hoursSince(freshness.lastUpdatedAt) > REFRESH_STALE_HOURS;
  const degradedStatus =
    freshness.status !== "success" ||
    freshness.mode === "degraded" ||
    isStale;

  return {
    ...freshness,
    mode: degradedStatus && freshness.mode !== "demo" ? "degraded" : freshness.mode,
    isStale,
    staleAfterHours: REFRESH_STALE_HOURS,
  };
}

const loadStations = unstable_cache(
  async (): Promise<StationOption[]> => {
    if (canUseDemoData()) {
      return demoStations;
    }

    if (!hasSupabaseConfig()) {
      return [];
    }

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("stations")
      .select("id, name, slug, line")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`Unable to load stations: ${error.message}`);
    }

    return (data ?? []) as StationOption[];
  },
  ["station-options"],
  {
    revalidate: 60 * 60 * 24,
    tags: ["stations"],
  },
);

const loadRefreshMetadata = unstable_cache(
  async (): Promise<RefreshMetadata> => {
    if (canUseDemoData()) {
      return normalizeRefreshMetadata(demoRefreshMetadata);
    }

    if (!hasSupabaseConfig()) {
      return normalizeRefreshMetadata({
        lastUpdatedAt: null,
        mode: "degraded",
        status: "missing_configuration",
        message:
          "Search is unavailable until Supabase credentials are configured.",
      });
    }

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("refresh_status_view")
      .select(
        "last_refresh_completed_at, last_refresh_status, active_slot, last_refresh_message",
      )
      .single();

    if (error) {
      throw new Error(`Unable to load refresh state: ${error.message}`);
    }

    return normalizeRefreshMetadata({
      lastUpdatedAt: data.last_refresh_completed_at,
      mode: "live",
      status: data.last_refresh_status,
      activeSlot: data.active_slot,
      message: data.last_refresh_message,
    });
  },
  ["refresh-state"],
  {
    revalidate: 300,
    tags: ["refresh-state"],
  },
);

export async function getStationOptions() {
  return loadStations();
}

export async function getRefreshMetadata() {
  return loadRefreshMetadata();
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const freshness = await getRefreshMetadata();
  const dependenciesConfigured = isSearchConfigured();
  const allowDemoData = canUseDemoData();
  const production = isProductionRuntime();

  const appStatus =
    !dependenciesConfigured && production
      ? "maintenance"
      : freshness.mode === "degraded"
        ? "degraded"
        : "ok";

  return {
    appStatus,
    dependenciesConfigured,
    allowDemoData,
    production,
    freshness,
  };
}
