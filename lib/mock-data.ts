import type { RefreshMetadata, StationOption, TrainSearchResult } from "@/lib/types";
import { minutesBetween, normalizeStationInput } from "@/lib/time";

type MockTrain = {
  id: string;
  name: string;
  trainType: "fast" | "slow";
  originStation: string;
  destinationStation: string;
  line: string;
  stops: Array<{
    station: string;
    time: string;
    stopOrder: number;
  }>;
};

export const demoStations: StationOption[] = [
  { id: 1, name: "Churchgate", slug: "churchgate", line: "Western" },
  { id: 2, name: "Dadar", slug: "dadar", line: "Interchange" },
  { id: 3, name: "Bandra", slug: "bandra", line: "Western" },
  { id: 4, name: "Andheri", slug: "andheri", line: "Western" },
  { id: 5, name: "Borivali", slug: "borivali", line: "Western" },
  { id: 6, name: "Virar", slug: "virar", line: "Western" },
  { id: 7, name: "CSMT", slug: "csmt", line: "Central" },
  { id: 8, name: "Kurla", slug: "kurla", line: "Central" },
  { id: 9, name: "Ghatkopar", slug: "ghatkopar", line: "Central" },
  { id: 10, name: "Thane", slug: "thane", line: "Central" },
  { id: 11, name: "Dombivli", slug: "dombivli", line: "Central" },
  { id: 12, name: "Kalyan", slug: "kalyan", line: "Central" },
];

const demoTrains: MockTrain[] = [
  {
    id: "WR-1001",
    name: "Churchgate Borivali Fast",
    trainType: "fast",
    originStation: "Churchgate",
    destinationStation: "Borivali",
    line: "Western",
    stops: [
      { station: "Churchgate", time: "06:18", stopOrder: 1 },
      { station: "Dadar", time: "06:29", stopOrder: 2 },
      { station: "Bandra", time: "06:36", stopOrder: 3 },
      { station: "Andheri", time: "06:44", stopOrder: 4 },
      { station: "Borivali", time: "07:02", stopOrder: 5 },
    ],
  },
  {
    id: "WR-1002",
    name: "Churchgate Virar Slow",
    trainType: "slow",
    originStation: "Churchgate",
    destinationStation: "Virar",
    line: "Western",
    stops: [
      { station: "Churchgate", time: "06:28", stopOrder: 1 },
      { station: "Dadar", time: "06:40", stopOrder: 2 },
      { station: "Bandra", time: "06:47", stopOrder: 3 },
      { station: "Andheri", time: "06:56", stopOrder: 4 },
      { station: "Borivali", time: "07:18", stopOrder: 5 },
      { station: "Virar", time: "07:45", stopOrder: 6 },
    ],
  },
  {
    id: "CR-2001",
    name: "CSMT Thane Slow",
    trainType: "slow",
    originStation: "CSMT",
    destinationStation: "Thane",
    line: "Central",
    stops: [
      { station: "CSMT", time: "06:10", stopOrder: 1 },
      { station: "Dadar", time: "06:24", stopOrder: 2 },
      { station: "Kurla", time: "06:34", stopOrder: 3 },
      { station: "Ghatkopar", time: "06:40", stopOrder: 4 },
      { station: "Thane", time: "06:55", stopOrder: 5 },
    ],
  },
  {
    id: "CR-2002",
    name: "CSMT Kalyan Fast",
    trainType: "fast",
    originStation: "CSMT",
    destinationStation: "Kalyan",
    line: "Central",
    stops: [
      { station: "CSMT", time: "06:22", stopOrder: 1 },
      { station: "Dadar", time: "06:33", stopOrder: 2 },
      { station: "Kurla", time: "06:42", stopOrder: 3 },
      { station: "Thane", time: "07:03", stopOrder: 4 },
      { station: "Dombivli", time: "07:16", stopOrder: 5 },
      { station: "Kalyan", time: "07:26", stopOrder: 6 },
    ],
  },
  {
    id: "CR-2003",
    name: "Dadar Kalyan Slow",
    trainType: "slow",
    originStation: "Dadar",
    destinationStation: "Kalyan",
    line: "Central",
    stops: [
      { station: "Dadar", time: "06:38", stopOrder: 1 },
      { station: "Kurla", time: "06:48", stopOrder: 2 },
      { station: "Ghatkopar", time: "06:56", stopOrder: 3 },
      { station: "Thane", time: "07:12", stopOrder: 4 },
      { station: "Dombivli", time: "07:25", stopOrder: 5 },
      { station: "Kalyan", time: "07:35", stopOrder: 6 },
    ],
  },
];

export const demoRefreshMetadata: RefreshMetadata = {
  lastUpdatedAt: "2026-04-19T03:02:00+05:30",
  mode: "demo",
  status: "success",
};

export function searchDemoTrains(
  from: string,
  to: string,
  time: string,
  originOnly: boolean,
  limit = 15,
): TrainSearchResult[] {
  const source = normalizeStationInput(from);
  const destination = normalizeStationInput(to);

  return demoTrains
    .map((train) => {
      const sourceStop = train.stops.find(
        (stop) => normalizeStationInput(stop.station) === source,
      );
      const destinationStop = train.stops.find(
        (stop) => normalizeStationInput(stop.station) === destination,
      );

      if (!sourceStop || !destinationStop) {
        return null;
      }

      if (sourceStop.stopOrder >= destinationStop.stopOrder) {
        return null;
      }

      if (sourceStop.time < time) {
        return null;
      }

      const startsHere =
        normalizeStationInput(train.originStation) === source;

      if (originOnly && !startsHere) {
        return null;
      }

      return {
        trainId: train.id,
        trainName: train.name,
        trainType: train.trainType,
        originStation: train.originStation,
        destinationStation: train.destinationStation,
        departureTime: sourceStop.time,
        arrivalTime: destinationStop.time,
        startsHere,
        journeyMinutes: minutesBetween(sourceStop.time, destinationStop.time),
      } satisfies TrainSearchResult;
    })
    .filter((result): result is TrainSearchResult => Boolean(result))
    .sort((left, right) => {
      if (left.departureTime === right.departureTime) {
        return Number(right.startsHere) - Number(left.startsHere);
      }

      return left.departureTime.localeCompare(right.departureTime);
    })
    .slice(0, limit);
}

