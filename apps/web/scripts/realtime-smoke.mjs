import { io } from "socket.io-client";

const apiUrl = process.env.SMOKE_API_URL ?? "http://localhost:4000";
const wsUrl = process.env.SMOKE_WS_URL ?? "http://localhost:4001";
const email = process.env.SMOKE_EMAIL ?? "admin@bms.local";
const password = process.env.SMOKE_PASSWORD ?? "admin123";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? "10000");
const retryDelayMs = 500;

function fail(message) {
  console.error(`[realtime-smoke] ${message}`);
  process.exit(1);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonFetch(url, init) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.text();
        fail(`${init?.method ?? "GET"} ${url} failed: ${res.status} ${body}`);
      }
      return res.json();
    } catch (err) {
      lastError = err;
      await delay(retryDelayMs);
    }
  }

  fail(
    `${init?.method ?? "GET"} ${url} did not become reachable: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

const login = await jsonFetch(`${apiUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});

const auth = { Authorization: `Bearer ${login.accessToken}` };
const alarms = await jsonFetch(`${apiUrl}/api/v1/alarms?limit=25`, {
  headers: auth,
});
const target = alarms.items.find((alarm) => !alarm.acknowledgedAt);
if (!target) {
  fail("no open alarm available to acknowledge; reset seed data or start the simulator");
}

const socket = io(`${wsUrl}/ws/alarms`, {
  transports: ["websocket"],
  timeout: timeoutMs,
});

const eventPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error("timed out waiting for acknowledged alarm event"));
  }, timeoutMs);

  socket.on("connect_error", (err) => {
    clearTimeout(timer);
    reject(err);
  });

  socket.on("alarm", (evt) => {
    if (evt?.type === "acknowledged" && evt.alarm?.id === target.id) {
      clearTimeout(timer);
      resolve(evt);
    }
  });
});

await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});

await jsonFetch(`${apiUrl}/api/v1/alarms/${target.id}/ack`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    reason: "Phase 1 Sprint B Redis realtime smoke test",
  }),
});

await eventPromise;
socket.disconnect();

console.log(
  `[realtime-smoke] ok: alarm ${target.id} acknowledged via ${apiUrl} and received on ${wsUrl}`,
);
