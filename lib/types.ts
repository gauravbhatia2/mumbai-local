export type StationOption = {
  id: number;
  name: string;
  slug: string;
  line: string;
};

export type RefreshMetadata = {
  lastUpdatedAt: string | null;
  mode: "live" | "demo" | "degraded";
  status: string;
  activeSlot?: "current" | "new";
  message?: string | null;
  isStale?: boolean;
  staleAfterHours?: number;
};

export type TrainSearchResult = {
  trainId: string;
  trainName: string;
  trainType: "fast" | "slow";
  originStation: string;
  destinationStation: string;
  departureTime: string;
  arrivalTime: string;
  startsHere: boolean;
  journeyMinutes: number;
};

export type TrainSearchApiResponse = {
  query: {
    from: string;
    to: string;
    time: string;
    originOnly?: boolean;
  };
  freshness: RefreshMetadata;
  bestOptionId: string | null;
  results: TrainSearchResult[];
};

export type RuntimeStatus = {
  appStatus: "ok" | "degraded" | "maintenance";
  dependenciesConfigured: boolean;
  allowDemoData: boolean;
  production: boolean;
  freshness: RefreshMetadata;
};
