import { demoRefreshMetadata, searchDemoTrains } from "@/lib/mock-data";
import { canUseDemoData, hasSupabaseConfig } from "@/lib/env";
import { getStationOptions } from "@/lib/stations";
import { createSupabaseAdmin } from "@/lib/supabase";
import type { TrainSearchResult } from "@/lib/types";
import { normalizeStationInput } from "@/lib/time";

type SearchTrainOptionsArgs = {
  from: string;
  to: string;
  time: string;
  originOnly: boolean;
  limit?: number;
};

type SearchTrainsRow = {
  train_id: string;
  train_name: string;
  train_type: "fast" | "slow";
  origin_station_name: string;
  destination_station_name: string;
  departure_time: string;
  arrival_time: string;
  starts_here: boolean;
  journey_minutes: number;
};

export async function searchTrainOptions({
  from,
  to,
  time,
  originOnly,
  limit = 15,
}: SearchTrainOptionsArgs): Promise<TrainSearchResult[]> {
  if (canUseDemoData()) {
    return searchDemoTrains(from, to, time, originOnly, limit);
  }

  if (!hasSupabaseConfig()) {
    throw new Error(
      "Search is unavailable until the production database is configured.",
    );
  }

  const stations = await getStationOptions();
  const sourceStation = stations.find(
    (station) => station.slug === normalizeStationInput(from),
  );
  const destinationStation = stations.find(
    (station) => station.slug === normalizeStationInput(to),
  );

  if (!sourceStation) {
    throw new Error(`Unknown source station: ${from}`);
  }

  if (!destinationStation) {
    throw new Error(`Unknown destination station: ${to}`);
  }

  const supabase = createSupabaseAdmin();

  const { data, error } = await supabase.rpc("search_trains", {
    p_source_station_id: sourceStation.id,
    p_destination_station_id: destinationStation.id,
    p_depart_after: time,
    p_origin_only: originOnly,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Database search failed: ${error.message}`);
  }

  return ((data ?? []) as SearchTrainsRow[]).map((row) => ({
    trainId: row.train_id,
    trainName: row.train_name,
    trainType: row.train_type,
    originStation: row.origin_station_name,
    destinationStation: row.destination_station_name,
    departureTime: row.departure_time,
    arrivalTime: row.arrival_time,
    startsHere: row.starts_here,
    journeyMinutes: row.journey_minutes,
  }));
}

export function getSearchMode() {
  return hasSupabaseConfig() ? "live" : demoRefreshMetadata.mode;
}
