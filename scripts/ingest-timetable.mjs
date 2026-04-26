import { createHash } from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;

const REQUIRED_HEADERS = [
  "train_id",
  "train_name",
  "train_type",
  "origin_station",
  "destination_station",
  "station_name",
  "arrival_time",
  "departure_time",
  "stop_order",
];

function loadLocalEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");

  if (!process.env.SUPABASE_URL && !process.env.DATABASE_URL) {
    try {
      const envText = fs.readFileSync(envPath, "utf8");

      for (const line of envText.split(/\r?\n/)) {
        if (!line || line.trim().startsWith("#")) {
          continue;
        }

        const separatorIndex = line.indexOf("=");

        if (separatorIndex === -1) {
          continue;
        }

        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);

        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function normalizeStationName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeTrainType(value) {
  return value.trim().toLowerCase() === "fast" ? "fast" : "slow";
}

function assertTimeString(value, fieldName, trainId) {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(
      `Invalid ${fieldName} "${value}" for train ${trainId}. Expected HH:MM.`,
    );
  }
}

function chunk(list, size) {
  const chunks = [];

  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }

  return chunks;
}

async function loadCsvSource() {
  const sourceUrl = process.env.TIMETABLE_SOURCE_URL;
  const sourcePath =
    process.env.TIMETABLE_SOURCE_PATH || "data/mumbai-local-sample.csv";

  if (sourceUrl) {
    const response = await fetch(sourceUrl);

    if (!response.ok) {
      throw new Error(`Failed to download timetable CSV: ${response.status}`);
    }

    const sourceText = await response.text();

    if (/^\s*</.test(sourceText)) {
      throw new Error(
        "TIMETABLE_SOURCE_URL returned an HTML landing page instead of a CSV feed. Provide a direct CSV URL or leave TIMETABLE_SOURCE_URL empty to use a local CSV file.",
      );
    }

    return sourceText;
  }

  const absolutePath = path.resolve(process.cwd(), sourcePath);
  return readFile(absolutePath, "utf8");
}

function parseRows(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length === 0) {
    throw new Error("Timetable source is empty.");
  }

  const headers = Object.keys(records[0]);
  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headers.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      `CSV is missing required headers: ${missingHeaders.join(", ")}`,
    );
  }

  return records.map((row) => {
    const parsedRow = {
      trainId: row.train_id.trim(),
      trainName: row.train_name.trim(),
      trainType: normalizeTrainType(row.train_type),
      originStation: normalizeStationName(row.origin_station),
      destinationStation: normalizeStationName(row.destination_station),
      stationName: normalizeStationName(row.station_name),
      arrivalTime: row.arrival_time.trim(),
      departureTime: row.departure_time.trim(),
      stopOrder: Number.parseInt(row.stop_order, 10),
      line: row.line?.trim() || "Mumbai Local",
    };

    assertTimeString(parsedRow.arrivalTime, "arrival_time", parsedRow.trainId);
    assertTimeString(
      parsedRow.departureTime,
      "departure_time",
      parsedRow.trainId,
    );

    return parsedRow;
  });
}

function buildDataset(rows) {
  const stations = new Map();
  const trains = new Map();

  for (const row of rows) {
    if (!Number.isInteger(row.stopOrder) || row.stopOrder <= 0) {
      throw new Error(`Invalid stop_order for train ${row.trainId}`);
    }

    for (const stationName of [
      row.stationName,
      row.originStation,
      row.destinationStation,
    ]) {
      const slug = normalizeSlug(stationName);
      const existingStation = stations.get(slug);

      stations.set(slug, {
        slug,
        name: stationName,
        line:
          existingStation && existingStation.line !== row.line
            ? "Multiple"
            : row.line,
      });
    }

    const trainKey = `${normalizeSlug(row.line)}:${row.trainId}`;
    const existingTrain = trains.get(trainKey) ?? {
      id: trainKey,
      name: row.trainName,
      type: row.trainType,
      originStationSlug: normalizeSlug(row.originStation),
      destinationStationSlug: normalizeSlug(row.destinationStation),
      stops: [],
    };

    if (
      existingTrain.name !== row.trainName ||
      existingTrain.type !== row.trainType ||
      existingTrain.originStationSlug !== normalizeSlug(row.originStation) ||
      existingTrain.destinationStationSlug !==
        normalizeSlug(row.destinationStation)
    ) {
      throw new Error(
        `Train ${row.trainId} on ${row.line} has inconsistent metadata across source rows.`,
      );
    }

    existingTrain.stops.push({
      stationSlug: normalizeSlug(row.stationName),
      arrivalTime: row.arrivalTime,
      departureTime: row.departureTime,
      stopOrder: row.stopOrder,
    });

    trains.set(trainKey, existingTrain);
  }

  for (const train of trains.values()) {
    train.stops.sort((left, right) => left.stopOrder - right.stopOrder);

    if (train.stops.length < 2) {
      throw new Error(`Train ${train.id} has fewer than two stops.`);
    }

    for (let index = 1; index < train.stops.length; index += 1) {
      if (train.stops[index - 1].stopOrder === train.stops[index].stopOrder) {
        throw new Error(`Train ${train.id} has duplicate stop_order values.`);
      }
    }
  }

  return {
    stations: Array.from(stations.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    trains: Array.from(trains.values()),
  };
}

function validateStationReferences(rows, label) {
  for (const row of rows) {
    if (row.some((value) => value == null)) {
      throw new Error(`Station reference validation failed for ${label}.`);
    }
  }
}

async function upsertStations(client, stations) {
  for (const batch of chunk(stations, 250)) {
    const values = [];
    const placeholders = batch.map((station, index) => {
      const offset = index * 3;
      values.push(station.slug, station.name, station.line);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
    });

    await client.query(
      `
        insert into stations (slug, name, line)
        values ${placeholders.join(", ")}
        on conflict (slug) do update
        set name = excluded.name,
            line = excluded.line
      `,
      values,
    );
  }

  const { rows } = await client.query("select id, slug from stations");
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function replaceSlotData(client, slot, dataset, stationIdBySlug) {
  await client.query(`truncate table stops_${slot}, trains_${slot} restart identity cascade`);

  const trainRows = dataset.trains.map((train) => [
    train.id,
    train.name,
    stationIdBySlug.get(train.originStationSlug),
    stationIdBySlug.get(train.destinationStationSlug),
    train.type,
  ]);

  validateStationReferences(trainRows, `trains_${slot}`);

  for (const batch of chunk(trainRows, 250)) {
    const values = [];
    const placeholders = batch.map((row, index) => {
      const offset = index * 5;
      values.push(...row);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    });

    await client.query(
      `
        insert into trains_${slot} (
          id,
          name,
          origin_station_id,
          destination_station_id,
          type
        )
        values ${placeholders.join(", ")}
      `,
      values,
    );
  }

  const stopRows = dataset.trains.flatMap((train) =>
    train.stops.map((stop) => [
      train.id,
      stationIdBySlug.get(stop.stationSlug),
      stop.arrivalTime,
      stop.departureTime,
      stop.stopOrder,
    ]),
  );

  validateStationReferences(stopRows, `stops_${slot}`);

  for (const batch of chunk(stopRows, 500)) {
    const values = [];
    const placeholders = batch.map((row, index) => {
      const offset = index * 5;
      values.push(...row);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    });

    await client.query(
      `
        insert into stops_${slot} (
          train_id,
          station_id,
          arrival_time,
          departure_time,
          stop_order
        )
        values ${placeholders.join(", ")}
      `,
      values,
    );
  }

  const trainCountResult = await client.query(
    `select count(*)::integer as count from trains_${slot}`,
  );
  const stopCountResult = await client.query(
    `select count(*)::integer as count from stops_${slot}`,
  );

  const trainCount = trainCountResult.rows[0].count;
  const stopCount = stopCountResult.rows[0].count;

  if (trainCount === 0 || stopCount === 0) {
    throw new Error(`Validation failed for slot ${slot}: no data loaded.`);
  }

  return { trainCount, stopCount };
}

async function recordRefreshStart(client) {
  await client.query(
    `
      update refresh_state
      set last_refresh_started_at = now(),
          last_refresh_status = 'running',
          last_refresh_message = 'Refreshing Mumbai timetable dataset...'
      where singleton = true
    `,
  );
}

async function recordRefreshFailure(client, message) {
  await client.query(
    `
      update refresh_state
      set last_refresh_status = 'failed',
          last_refresh_message = $1
      where singleton = true
    `,
    [message],
  );
}

async function main() {
  loadLocalEnvFile();

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  let transactionOpen = false;

  try {
    await recordRefreshStart(client);

    const csvText = await loadCsvSource();
    const checksum = createHash("sha256").update(csvText).digest("hex");
    const rows = parseRows(csvText);
    const dataset = buildDataset(rows);

    await client.query("begin");
    transactionOpen = true;
    await client.query("select pg_advisory_xact_lock(80199421)");

    const stateResult = await client.query(
      "select active_slot from refresh_state where singleton = true",
    );
    const activeSlot = stateResult.rows[0]?.active_slot ?? "current";
    const targetSlot = activeSlot === "current" ? "new" : "current";
    const stationIdBySlug = await upsertStations(client, dataset.stations);
    const { trainCount, stopCount } = await replaceSlotData(
      client,
      targetSlot,
      dataset,
      stationIdBySlug,
    );

    await client.query(
      `
        update refresh_state
        set active_slot = $1,
            last_refresh_completed_at = now(),
            last_refresh_status = 'success',
            last_refresh_message = $2,
            source_checksum = $3
        where singleton = true
      `,
      [
        targetSlot,
        `Loaded ${trainCount} trains and ${stopCount} stops into ${targetSlot}.`,
        checksum,
      ],
    );

    await client.query("commit");
    transactionOpen = false;
    console.log(
      `Refresh complete. Activated slot ${targetSlot} with ${trainCount} trains.`,
    );
  } catch (error) {
    if (transactionOpen) {
      await client.query("rollback");
      transactionOpen = false;
    }

    await recordRefreshFailure(
      client,
      error instanceof Error ? error.message : "Unknown refresh failure",
    );
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
