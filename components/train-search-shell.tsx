"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  RefreshMetadata,
  StationOption,
  TrainSearchApiResponse,
} from "@/lib/types";
import { formatFreshnessLabel } from "@/lib/time";

const QUICK_ROUTES_STORAGE_KEY = "mumbai-local-quick-routes-v1";
const MAX_QUICK_ROUTES = 3;

type QuickRoute = {
  id: string;
  from: string;
  to: string;
  originOnly: boolean;
};

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
  const [quickRoutes, setQuickRoutes] = useState<QuickRoute[]>([]);
  const [isPending, startTransition] = useTransition();

  const stationNames = useMemo(
    () => stations.map((station) => `${station.name} (${station.line})`),
    [stations],
  );

  useEffect(() => {
    try {
      const savedRoutes = window.localStorage.getItem(QUICK_ROUTES_STORAGE_KEY);

      if (!savedRoutes) {
        return;
      }

      const parsedRoutes = JSON.parse(savedRoutes) as QuickRoute[];

      if (Array.isArray(parsedRoutes)) {
        setQuickRoutes(parsedRoutes.slice(0, MAX_QUICK_ROUTES));
      }
    } catch {
      window.localStorage.removeItem(QUICK_ROUTES_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      QUICK_ROUTES_STORAGE_KEY,
      JSON.stringify(quickRoutes),
    );
  }, [quickRoutes]);

  const runSearch = async (
    nextFrom: string,
    nextTo: string,
    nextTime: string,
    nextOriginOnly: boolean,
  ) => {
    const params = new URLSearchParams({
      from: nextFrom,
      to: nextTo,
      time: nextTime,
      originOnly: String(nextOriginOnly),
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
  };

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
        await runSearch(from, to, time, originOnly);
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

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
    setResponse(null);
    setError(null);
  };

  const handleSaveQuickRoute = () => {
    if (!from.trim() || !to.trim()) {
      setError("Choose both stations before saving a quick route.");
      return;
    }

    const nextRoute: QuickRoute = {
      id: `${from}__${to}__${originOnly ? "origin" : "all"}`,
      from,
      to,
      originOnly,
    };

    setQuickRoutes((currentRoutes) => {
      const withoutDuplicate = currentRoutes.filter(
        (route) => route.id !== nextRoute.id,
      );

      return [nextRoute, ...withoutDuplicate].slice(0, MAX_QUICK_ROUTES);
    });
    setError(null);
  };

  const handleQuickRouteSearch = (route: QuickRoute) => {
    setFrom(route.from);
    setTo(route.to);
    setOriginOnly(route.originOnly);
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
        await runSearch(route.from, route.to, time, route.originOnly);
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

  const handleRemoveQuickRoute = (routeId: string) => {
    setQuickRoutes((currentRoutes) =>
      currentRoutes.filter((route) => route.id !== routeId),
    );
  };

  const activeFreshness = response?.freshness ?? freshness;
  const searchContext = response?.searchContext;

  return (
    <section className="search-shell">
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="station-row">
          <div className="field field--station">
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

          <div className="swap-field">
            <button
              className="swap-button"
              type="button"
              onClick={handleSwap}
              disabled={!searchEnabled || (!from && !to)}
              aria-label="Swap from and to stations"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="swap-icon"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7 7H18M18 7L14.5 3.5M18 7L14.5 10.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M17 17H6M6 17L9.5 13.5M6 17L9.5 20.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="field field--station">
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

        <div className="quick-routes">
          <div className="quick-routes-header">
            <strong>Quick routes</strong>
            <button
              type="button"
              className="text-button"
              onClick={handleSaveQuickRoute}
              disabled={!searchEnabled || !from.trim() || !to.trim()}
            >
              Save current route
            </button>
          </div>

          {quickRoutes.length === 0 ? (
            <p className="quick-routes-empty">
              Save up to three commute routes for one-tap search.
            </p>
          ) : (
            <div className="quick-route-list">
              {quickRoutes.map((route) => (
                <div className="quick-route-card" key={route.id}>
                  <button
                    type="button"
                    className="quick-route-button"
                    onClick={() => handleQuickRouteSearch(route)}
                    disabled={!searchEnabled}
                  >
                    <span>
                      {route.from} to {route.to}
                    </span>
                    <small>
                      {route.originOnly ? "Starts here only" : "All matching trains"}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="quick-route-remove"
                    onClick={() => handleRemoveQuickRoute(route.id)}
                    aria-label={`Remove quick route ${route.from} to ${route.to}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
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

        {searchContext?.rolledOverToNextService ||
        searchContext?.relaxedOriginOnly ? (
          <div className="warning-banner">
            {searchContext.rolledOverToNextService
              ? "Showing the next available service from the current timetable because no later train matched the selected time."
              : "Showing passing trains because no origin-starting train matched the current filter."}
            {searchContext.rolledOverToNextService &&
            searchContext.relaxedOriginOnly
              ? " The search also relaxed the origin-only filter to avoid an empty result."
              : ""}
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
