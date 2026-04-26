"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  RefreshMetadata,
  StationOption,
  TrainSearchApiResponse,
} from "@/lib/types";
import { formatFreshnessLabel } from "@/lib/time";

type TrainSearchShellProps = {
  stations: StationOption[];
  freshness: RefreshMetadata;
  initialTime: string;
  searchEnabled: boolean;
  maintenanceMessage: string | null;
};

export function TrainSearchShell({
  stations,
  freshness,
  initialTime,
  searchEnabled,
  maintenanceMessage,
}: TrainSearchShellProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState(initialTime);
  const [originOnly, setOriginOnly] = useState(true);
  const [response, setResponse] = useState<TrainSearchApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const stationNames = useMemo(
    () => stations.map((station) => `${station.name} (${station.line})`),
    [stations],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!searchEnabled) {
      setResponse(null);
      setError(
        maintenanceMessage ??
          "Search is temporarily unavailable while production data is being configured.",
      );
      return;
    }

    startTransition(async () => {
      try {
        const params = new URLSearchParams({
          from,
          to,
          time,
          originOnly: String(originOnly),
        });

        const result = await fetch(`/api/trains?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await result.json()) as
          | TrainSearchApiResponse
          | { error: string };

        if (!result.ok) {
          throw new Error("error" in payload ? payload.error : "Search failed.");
        }

        if ("error" in payload) {
          throw new Error(payload.error);
        }

        setResponse(payload);
      } catch (searchError) {
        setResponse(null);
        setError(
          searchError instanceof Error
            ? searchError.message
            : "Unable to search trains right now.",
        );
      }
    });
  };

  const activeFreshness = response?.freshness ?? freshness;

  return (
    <section className="search-shell">
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="from-station">From station</label>
            <input
              id="from-station"
              list="station-list"
              type="text"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="Dadar"
              autoComplete="off"
              disabled={!searchEnabled}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="to-station">To station</label>
            <input
              id="to-station"
              list="station-list"
              type="text"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="Thane"
              autoComplete="off"
              disabled={!searchEnabled}
              required
            />
          </div>

          <div className="field field--full">
            <label htmlFor="departure-time">Departure time</label>
            <input
              id="departure-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={!searchEnabled}
              required
            />
          </div>
        </div>

        <label className="checkbox-row" htmlFor="origin-only">
          <input
            id="origin-only"
            type="checkbox"
            checked={originOnly}
            onChange={(event) => setOriginOnly(event.target.checked)}
            disabled={!searchEnabled}
          />
          <div className="checkbox-copy">
            <strong>Only show trains starting here</strong>
            <span>Higher chance of getting a seat and easier boarding.</span>
          </div>
        </label>

        <div className="action-row">
          <button type="submit" disabled={isPending || !searchEnabled}>
            {isPending ? "Finding trains..." : "Search trains"}
          </button>

          <div className="freshness-note">
            Last updated: {formatFreshnessLabel(activeFreshness.lastUpdatedAt)}
          </div>
        </div>

        {activeFreshness.mode !== "live" ? (
          <span className="mode-pill">
            {activeFreshness.mode === "demo" ? "Demo data" : "Data degraded"}
          </span>
        ) : null}

        {maintenanceMessage ? (
          <div className="error-banner">{maintenanceMessage}</div>
        ) : null}

        {activeFreshness.mode === "degraded" && !maintenanceMessage ? (
          <div className="warning-banner">
            {activeFreshness.message ??
              `Timetable data may be stale or degraded. Last successful refresh was ${formatFreshnessLabel(
                activeFreshness.lastUpdatedAt,
              )}.`}
          </div>
        ) : null}
      </form>

      <datalist id="station-list">
        {stationNames.map((stationName) => (
          <option key={stationName} value={stationName} />
        ))}
      </datalist>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="results-shell">
        <div className="results-header">
          <h2>Next trains</h2>
          <p>
            {response
              ? `${response.results.length} options found`
              : "Search a route to see the next services."}
          </p>
        </div>

        {!response ? (
          <div className="empty-state">
            {searchEnabled
              ? "Search any two stations to get the next trains, ranked by departure time and nudged toward trains that start at your station."
              : "Production search is disabled until Supabase credentials and timetable data are configured."}
          </div>
        ) : response.results.length === 0 ? (
          <div className="empty-state">
            No trains matched this route after {response.query.time}. Try a
            slightly earlier time or switch off the origin-only filter.
          </div>
        ) : (
          response.results.map((train) => {
            const isBest = response.bestOptionId === train.trainId;

            return (
              <article
                className={`train-card ${isBest ? "train-card--best" : ""}`}
                key={`${train.trainId}-${train.departureTime}`}
              >
                <div className="train-topline">
                  <div className="train-time">
                    <strong>{train.departureTime}</strong>
                    <span className="train-type">{train.trainType}</span>
                  </div>

                  {isBest ? (
                    <span className="best-badge">Star Best Option</span>
                  ) : null}
                </div>

                <div className="train-route">
                  <span>
                    <strong>{train.originStation}</strong> to{" "}
                    <strong>{train.destinationStation}</strong>
                  </span>
                  <span>Arrival {train.arrivalTime}</span>
                </div>

                <div className="train-meta">
                  <span
                    className={`seat-badge ${
                      train.startsHere
                        ? "seat-badge--starts"
                        : "seat-badge--passes"
                    }`}
                  >
                    {train.startsHere
                      ? "Green Starts here"
                      : "Red Passing train"}
                  </span>
                  <span>{train.journeyMinutes} min trip</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
