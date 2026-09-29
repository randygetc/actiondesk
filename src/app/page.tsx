import { redirect } from "next/navigation";

// Placeholder until 1.5 adds the (app) route group, whose page redirects to /tasks.
export default function Home() {
  redirect("/login");
}
