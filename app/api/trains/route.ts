import { NextRequest, NextResponse } from "next/server";
import { isProductionRuntime, isSearchConfigured } from "@/lib/env";
import { searchTrainOptions } from "@/lib/search";
import { getRefreshMetadata } from "@/lib/stations";
import { getCurrentMumbaiTime } from "@/lib/time";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().trim().min(2, "Source station is required."),
  to: z.string().trim().min(2, "Destination station is required."),
  time: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .default(getCurrentMumbaiTime()),
  originOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export async function GET(request: NextRequest) {
  try {
    if (isProductionRuntime() && !isSearchConfigured()) {
      return NextResponse.json(
        {
          error:
            "Search is unavailable until Supabase credentials are configured in production.",
        },
        { status: 503 },
      );
    }

    const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = querySchema.parse(raw);

    if (query.from.toLowerCase() === query.to.toLowerCase()) {
      return NextResponse.json(
        { error: "Source and destination stations must be different." },
        { status: 400 },
      );
    }

    const [results, freshness] = await Promise.all([
      searchTrainOptions({
        from: query.from,
        to: query.to,
        time: query.time,
        originOnly: query.originOnly ?? false,
        limit: 15,
      }),
      getRefreshMetadata(),
    ]);

    return NextResponse.json(
      {
        query,
        freshness,
        bestOptionId: results[0]?.trainId ?? null,
        results,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message ?? "Invalid search query.",
        },
        { status: 400 },
      );
    }

    const message =
      error instanceof Error ? error.message : "Unable to search trains.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
