// Step 3.7: k6 load test (local). Run with the official image:
//   docker run --rm --network host -v "$PWD/supabase/perf/k6":/k6 -v <dir with users.json>:/data \
//     -e APP=http://127.0.0.1:3100 -e SUPABASE_URL=... -e ANON_KEY=... grafana/k6 run /k6/load.js
// users.json comes from sessions.mjs (five signed-in perf users).
//
// Scenarios:
//   task_list  the tasks page (production build), each user in a 5,000-task workspace
//   ask_tools  the queries Ask's tools run (search_tasks, list_overdue) through
//              PostgREST with the user's token, RLS included. The model call itself
//              isn't load-tested: it would cost money and measure Anthropic's latency.
import http from "k6/http";
import { check } from "k6";

const users = JSON.parse(open("/data/users.json"));
const APP = __ENV.APP;
const SUPABASE = __ENV.SUPABASE_URL;
const ANON = __ENV.ANON_KEY;

const ramp = { executor: "ramping-vus", startVUs: 1, stages: [
  { duration: "15s", target: 20 },
  { duration: "30s", target: 20 },
  { duration: "15s", target: 0 },
] };

// RATE=<n>: instead of the 20-user stress ramp, a steady n page loads per
// second for 60 s (closer to real traffic).
const steady = __ENV.RATE && {
  executor: "constant-arrival-rate", rate: Number(__ENV.RATE), timeUnit: "1s",
  duration: "60s", preAllocatedVUs: 50,
};

export const options = {
  scenarios: steady
    ? { task_list: { ...steady, exec: "taskList" } }
    : {
        task_list: { ...ramp, exec: "taskList" },
        ask_tools: { ...ramp, exec: "askTools" },
      },
  thresholds: {
    "http_req_duration{scenario:task_list}": ["p(95)<500"],
    "http_req_duration{scenario:ask_tools}": ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const pick = () => users[Math.floor(Math.random() * users.length)];

export function taskList() {
  const u = pick();
  const r = http.get(`${APP}/tasks`, { headers: { Cookie: u.cookie }, redirects: 0 });
  check(r, { "tasks page 200": (x) => x.status === 200 && x.body.includes("Perf workspace") });
}

export function askTools() {
  const u = pick();
  const headers = { apikey: ANON, Authorization: `Bearer ${u.token}` };
  const base = `${SUPABASE}/rest/v1/tasks?select=id,title,status,priority,due_at&workspace_id=eq.${u.workspaceId}`;
  const words = ["invoice", "deck", "report", "contract", "budget", "roadmap"];
  const q = words[Math.floor(Math.random() * words.length)];
  const search = http.get(`${base}&title=ilike.*${q}*&order=due_at.asc.nullslast&limit=20`, { headers });
  const overdue = http.get(
    `${base}&due_at=lt.${new Date().toISOString()}&status=neq.done&order=due_at.asc&limit=50`,
    { headers },
  );
  check(search, { "search 200": (x) => x.status === 200 });
  check(overdue, { "overdue 200": (x) => x.status === 200 });
}
