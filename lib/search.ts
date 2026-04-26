import { demoRefreshMetadata, searchDemoTrains } from "@/lib/mock-data";
import { canUseDemoData, hasSupabaseConfig } from "@/lib/env";
import { getStationOptions } from "@/lib/stations";
import { createSupabaseAdmin } from "@/lib/supabase";
import type { SearchContext, TrainSearchResult } from "@/lib/types";
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

type SearchTrainOptionsResponse = {
  items: TrainSearchResult[];
  searchContext: SearchContext;
};

function resolveStationMatch(
  input: string,
  stations: Awaited<ReturnType<typeof getStationOptions>>,
) {
  const normalizedInput = normalizeStationInput(input);

  return (
    stations.find((station) => station.slug === normalizedInput) ??
    stations.find(
      (station) => normalizeStationInput(station.name) === normalizedInput,
    )
  );
}

export async function searchTrainOptions({
  from,
  to,
  time,
  originOnly,
  limit = 15,
}: SearchTrainOptionsArgs): Promise<SearchTrainOptionsResponse> {
  if (canUseDemoData()) {
    return {
      items: searchDemoTrains(from, to, time, originOnly, limit),
      searchContext: {
        rolledOverToNextService: false,
        relaxedOriginOnly: false,
      },
    };
  }

  if (!hasSupabaseConfig()) {
    throw new Error(
      "Search is unavailable until the production database is configured.",
    );
  }

  const stations = await getStationOptions();
  const sourceStation = resolveStationMatch(from, stations);
  const destinationStation = resolveStationMatch(to, stations);

  if (!sourceStation) {
    throw new Error(`Unknown source station: ${from}`);
  }

  if (!destinationStation) {
    throw new Error(`Unknown destination station: ${to}`);
  }

  const supabase = createSupabaseAdmin();

  const runSearch = async (
    departAfter: string | null,
    requireOrigin: boolean,
  ) => {
    const { data, error } = await supabase.rpc("search_trains", {
      p_source_station_id: sourceStation.id,
      p_destination_station_id: destinationStation.id,
      p_depart_after: departAfter,
      p_origin_only: requireOrigin,
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
  };

  let searchContext: SearchContext = {
    rolledOverToNextService: false,
    relaxedOriginOnly: false,
  };

  let results = await runSearch(time, originOnly);

  if (results.length === 0 && time) {
    results = await runSearch(null, originOnly);
    searchContext = {
      ...searchContext,
      rolledOverToNextService: results.length > 0,
    };
  }

  if (results.length === 0 && originOnly) {
    results = await runSearch(time, false);
    searchContext = {
      ...searchContext,
      relaxedOriginOnly: results.length > 0,
    };
  }

  if (results.length === 0 && originOnly && time) {
    results = await runSearch(null, false);
    searchContext = {
      rolledOverToNextService: results.length > 0,
      relaxedOriginOnly: results.length > 0,
    };
  }

  return {
    items: results,
    searchContext,
  };
}

export function getSearchMode() {
  return hasSupabaseConfig() ? "live" : demoRefreshMetadata.mode;
}
