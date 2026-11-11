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

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return [
    result.getUTCFullYear().toString().padStart(4, "0"),
    (result.getUTCMonth() + 1).toString().padStart(2, "0"),
    result.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function weekday(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function isWeekend(date) {
  return weekday(date) === "Saturday" || weekday(date) === "Sunday";
}

function nextWeekday(date) {
  let candidate = addDays(date, 1);
  while (isWeekend(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

function nextSaturday() {
  let date = addDays(hongKongDate(0), 1);
  while (weekday(date) !== "Saturday") date = addDays(date, 1);
  return date;
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: { Authorization: `Bearer ${token}` },
  },
});

const client = new Client({
  name: "hong-kong-cafe-demo-smoke",
  version: "1.0.0",
});

function parseToolResult(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Tool returned no text content");
  return JSON.parse(text);
}

async function call(name, args) {
  return parseToolResult(await client.callTool({ name, arguments: args }));
}

try {
  await client.connect(transport);

  const weekdayDate = (() => {
    let date = hongKongDate(12);
    while (isWeekend(date)) date = addDays(date, 1);
    return date;
  })();
  const saturday = nextSaturday();
  const newDate = nextWeekday(weekdayDate);
  const phone = "+852 6123 4567";

  const weekdayWeather = await call("check_weather", { date: weekdayDate });
  const weekendWeather = await call("check_weather", { date: saturday });

  if (weekdayWeather.outdoor_open !== true || weekendWeather.outdoor_open !== false) {
    throw new Error(
      `Weather rule failed: ${JSON.stringify({ weekdayWeather, weekendWeather })}`,
    );
  }

  const availability = await call("check_availability", {
    date: weekdayDate,
    time: "15:00",
    party_size: 4,
  });
  if (!availability.selection_token) {
    throw new Error(`Availability failed: ${JSON.stringify(availability)}`);
  }

  const created = await call("create_reservation", {
    selection_token: availability.selection_token,
    name: "Demo Smoke",
    phone,
    seating: "outside",
    remark: "POC demo smoke test",
  });
  if (!created.ok) {
    throw new Error(`Create failed: ${JSON.stringify(created)}`);
  }

  const found = await call("lookup_reservation", {
    name: "Smoke",
    phone,
    date: weekdayDate,
  });
  if (!found.ok || found.reservation.phone !== "***4567") {
    throw new Error(`Guarded lookup failed: ${JSON.stringify(found)}`);
  }

  const blocked = await call("lookup_reservation", {
    name: "Smoke",
    phone: "+852 6000 0000",
    date: weekdayDate,
  });
  if (blocked.code !== "not_found") {
    throw new Error(`Guardrail failed: ${JSON.stringify(blocked)}`);
  }

  const moved = await call("change_reservation_date", {
    name: "Smoke",
    phone,
    current_date: weekdayDate,
    new_date: newDate,
  });
  if (!moved.ok || moved.reservation.date !== newDate) {
    throw new Error(`Move failed: ${JSON.stringify(moved)}`);
  }

  const oldLookup = await call("lookup_reservation", {
    name: "Smoke",
    phone,
    date: weekdayDate,
  });
  if (oldLookup.code !== "not_found") {
    throw new Error(`Old date still visible: ${JSON.stringify(oldLookup)}`);
  }

  console.log(
    JSON.stringify(
      {
        weather: {
          weekday: weekdayWeather.condition,
          weekend: weekendWeather.condition,
        },
        booking: {
          status: created.status,
          seating: created.reservation.seating,
          remark: created.reservation.remark,
        },
        lookup: { masked_phone: found.reservation.phone, wrong_phone: blocked.code },
        move: { from: weekdayDate, to: moved.reservation.date, time: moved.reservation.time },
        old_date_after_move: oldLookup.code,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
