// Step 3.7: sign in the five perf users and print what k6 needs, as JSON:
// [{ cookie, token, workspaceId }]. Contains live tokens: write it outside
// the repo.  node supabase/perf/k6/sessions.mjs > /tmp/k6-users.json
import { createServerClient } from "@supabase/ssr";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const users = [];
for (let n = 1; n <= 5; n++) {
  const jar = new Map();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: `perf${n}@example.com`,
    password: "perf-password",
  });
  if (error) throw error;
  // A 5,000-task workspace this user owns: the page's current workspace.
  const { data: ws, error: wsError } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspace:workspaces(name)")
    .eq("user_id", data.user.id)
    .eq("role", "owner")
    .like("workspace.name", "Perf workspace %")
    .not("workspace", "is", null)
    .limit(1)
    .single();
  if (wsError) throw wsError;
  jar.set("ws", ws.workspace_id);
  users.push({
    cookie: [...jar].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; "),
    token: data.session.access_token,
    workspaceId: ws.workspace_id,
  });
}
console.log(JSON.stringify(users));
