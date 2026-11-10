import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Seeds two demo dates through the public MCP endpoint so the phone demo has
// deterministic capacity states:
//   NEARLY_FULL_DATE, 19:00 block: only 2 seats left (party of 2 fits, party of 4 does not).
//   FULL_DATE: every bookable time is filled until no party of 1 fits.
// Refuses to run when FULL_DATE already has no capacity, which means it was seeded before.

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

const NEARLY_FULL_DATE = process.env.DEMO_NEARLY_FULL_DATE ?? hongKongDate(1);
const FULL_DATE = process.env.DEMO_FULL_DATE ?? hongKongDate(2);
const NEARLY_FULL_TIME = "19:00";
const NEARLY_FULL_PARTIES = [10, 10, 10, 8];
const FILL_TIMES = [];
for (let minutes = 11 * 60; minutes <= 20 * 60 + 30; minutes += 30) {
  FILL_TIMES.push(
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
  );
}
const FILL_PARTY_SIZES = [10, 5, 2, 1];

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
  name: "hong-kong-cafe-demo-seed",
  version: "1.0.0",
});

async function call(name, args) {
  return parseToolResult(await client.callTool({ name, arguments: args }));
}

let seededCount = 0;
let phoneIndex = 0;

function nextPhone() {
  phoneIndex += 1;
  return `+852900000${String(phoneIndex).padStart(2, "0")}`;
}

// Returns { fits, token } for the requested slot. Treats a validation error as "does not fit".
async function probe(date, time, partySize) {
  const result = await call("check_availability", { date, time, party_size: partySize });
  if (!result.ok || !result.requested_available || !result.selection_token) {
    return { fits: false, token: undefined };
  }
  return { fits: true, token: result.selection_token };
}

async function book(date, time, partySize, label) {
  const slot = await probe(date, time, partySize);
  if (!slot.fits) return false;
  const booked = await call("create_reservation", {
    selection_token: slot.token,
    name: label,
    phone: nextPhone(),
  });
  if (!booked.ok) {
    throw new Error(`Seed booking failed for ${date} ${time}: ${JSON.stringify(booked)}`);
  }
  seededCount += 1;
  return true;
}

try {
  await client.connect(transport);

  // Idempotency guard: if no time on FULL_DATE accepts even a party of 1, it is already seeded.
  let anyCapacity = false;
  for (const time of FILL_TIMES) {
    if ((await probe(FULL_DATE, time, 1)).fits) {
      anyCapacity = true;
      break;
    }
  }
  if (!anyCapacity) {
    console.log(
      JSON.stringify(
        {
          status: "skipped",
          reason: `${FULL_DATE} has no capacity for a party of 1; seed appears already applied`,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // Step 1: nearly full 19:00 block on NEARLY_FULL_DATE.
  for (const [index, partySize] of NEARLY_FULL_PARTIES.entries()) {
    const ok = await book(NEARLY_FULL_DATE, NEARLY_FULL_TIME, partySize, `Demo Seed Near ${index + 1}`);
    if (!ok) {
      throw new Error(
        `Could not place party of ${partySize} at ${NEARLY_FULL_TIME} on ${NEARLY_FULL_DATE}; pick a future date or clear the date`,
      );
    }
  }

  // Step 2: fill FULL_DATE greedily until no party size fits any bookable time.
  let counter = 0;
  for (const partySize of FILL_PARTY_SIZES) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const time of FILL_TIMES) {
        counter += 1;
        if (await book(FULL_DATE, time, partySize, `Demo Seed Full ${counter}`)) {
          progressed = true;
        }
      }
    }
  }

  // Verify: a party of 2 must have no slot on FULL_DATE, and NEARLY_FULL_DATE must reject a party of 4 at 19:00.
  let fullDateOpenForTwo = false;
  for (const time of FILL_TIMES) {
    if ((await probe(FULL_DATE, time, 2)).fits) {
      fullDateOpenForTwo = true;
      break;
    }
  }
  const nearlyFullFitsFour = (await probe(NEARLY_FULL_DATE, NEARLY_FULL_TIME, 4)).fits;
  const nearlyFullFitsTwo = (await probe(NEARLY_FULL_DATE, NEARLY_FULL_TIME, 2)).fits;

  console.log(
    JSON.stringify(
      {
        status: "seeded",
        bookings_created: seededCount,
        nearly_full: {
          date: NEARLY_FULL_DATE,
          time: NEARLY_FULL_TIME,
          seats_left: 2,
          party_of_2_fits: nearlyFullFitsTwo,
          party_of_4_fits: nearlyFullFitsFour,
        },
        fully_booked: {
          date: FULL_DATE,
          party_of_2_fits_any_time: fullDateOpenForTwo,
        },
      },
      null,
      2,
    ),
  );

  if (fullDateOpenForTwo || nearlyFullFitsFour || !nearlyFullFitsTwo) {
    throw new Error("Seed verification failed; inspect with check_availability before demoing");
  }
} finally {
  await client.close();
}
