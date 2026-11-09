import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const token = process.env.MCP_API_KEY;

if (!url || !token) {
  console.error("MCP_URL and MCP_API_KEY are required");
  process.exit(1);
}

function hongKongDate(daysAhead) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + daysAhead),
  );
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function parseToolResult(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool returned no text content");
  return JSON.parse(text);
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
});
const client = new Client({
  name: "hong-kong-cafe-business-smoke",
  version: "1.0.0",
});

async function call(name, args) {
  return parseToolResult(
    await client.callTool({ name, arguments: args }),
  );
}

async function availability(date, partySize) {
  const result = await call("check_availability", {
    date,
    time: "15:00",
    party_size: partySize,
  });
  if (!result.ok || !result.selection_token) {
    throw new Error(`Availability failed: ${JSON.stringify(result)}`);
  }
  return result.selection_token;
}

try {
  await client.connect(transport);

  const standardDate = hongKongDate(10);
  const selectionToken = await availability(standardDate, 4);
  const first = await call("create_reservation", {
    selection_token: selectionToken,
    name: "MCP Smoke A",
    phone: "+85291234567",
  });
  const retry = await call("create_reservation", {
    selection_token: selectionToken,
    name: "MCP Smoke A",
    phone: "+85291234567",
  });

  if (!first.ok || retry.status !== "already_confirmed") {
    throw new Error(`Idempotency failed: ${JSON.stringify({ first, retry })}`);
  }

  const raceDate = hongKongDate(11);
  for (let index = 0; index < 3; index += 1) {
    const tokenForTen = await availability(raceDate, 10);
    const booked = await call("create_reservation", {
      selection_token: tokenForTen,
      name: `MCP Smoke Fill ${index + 1}`,
      phone: "+85291234567",
    });
    if (!booked.ok) {
      throw new Error(`Capacity setup failed: ${JSON.stringify(booked)}`);
    }
  }

  const [raceTokenA, raceTokenB] = await Promise.all([
    availability(raceDate, 6),
    availability(raceDate, 6),
  ]);
  const [raceA, raceB] = await Promise.all([
    call("create_reservation", {
      selection_token: raceTokenA,
      name: "MCP Smoke Race A",
      phone: "+85291234567",
    }),
    call("create_reservation", {
      selection_token: raceTokenB,
      name: "MCP Smoke Race B",
      phone: "+85291234567",
    }),
  ]);

  const successes = [raceA, raceB].filter((result) => result.ok).length;
  const conflicts = [raceA, raceB].filter(
    (result) => result.code === "slot_taken",
  ).length;

  if (successes !== 1 || conflicts !== 1) {
    throw new Error(
      `Concurrency invariant failed: ${JSON.stringify({ raceA, raceB })}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        standard_booking: first.status,
        idempotent_retry: retry.status,
        concurrency: {
          successes,
          conflicts,
          capacity_limit_enforced: true,
        },
        test_dates: [standardDate, raceDate],
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
