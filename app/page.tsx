import { TrainSearchShell } from "@/components/train-search-shell";
import { getCurrentMumbaiTime } from "@/lib/time";
import { getRuntimeStatus, getStationOptions } from "@/lib/stations";
import type { RuntimeStatus, StationOption } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let stations: StationOption[] = [];
  let runtimeStatus: RuntimeStatus;

  try {
    [stations, runtimeStatus] = await Promise.all([
      getStationOptions(),
      getRuntimeStatus(),
    ]);
  } catch (error) {
    runtimeStatus = {
      appStatus: "maintenance",
      dependenciesConfigured: false,
      allowDemoData: false,
      production: process.env.NODE_ENV === "production",
      freshness: {
        lastUpdatedAt: null,
        mode: "degraded",
        status: "runtime_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load the Mumbai timetable right now.",
      },
    };
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Mumbai commute, simplified</p>
          <h1>Mumbai Local Smart Train Finder</h1>
          <p className="hero-text">
            Search the next trains in under a second, favor trains that begin at
            your station, and surface the best boarding option for the rush
            ahead.
          </p>
        </div>
        <TrainSearchShell
          stations={stations}
          freshness={runtimeStatus.freshness}
          initialTime={getCurrentMumbaiTime()}
          searchEnabled={
            runtimeStatus.dependenciesConfigured || runtimeStatus.allowDemoData
          }
          maintenanceMessage={
            runtimeStatus.appStatus === "maintenance"
              ? runtimeStatus.freshness.message ??
                "Search is temporarily unavailable while production data is being configured."
              : null
          }
        />
      </section>
    </main>
  );
}
