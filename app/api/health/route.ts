import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runtimeStatus = await getRuntimeStatus();

    return NextResponse.json(runtimeStatus, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
      status:
        runtimeStatus.appStatus === "ok"
          ? 200
          : runtimeStatus.appStatus === "degraded"
            ? 200
            : 503,
    });
  } catch (error) {
    return NextResponse.json(
      {
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
              : "Unable to inspect app health.",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
        status: 503,
      },
    );
  }
}
