import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/session";
import Dashboard from "./Dashboard";

async function DashboardGate() {
  await connection();
  if (!(await hasSession())) redirect("/");
  return <Dashboard />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<main className="dashboard-page"><p className="muted">Ładowanie…</p></main>}>
      <DashboardGate />
    </Suspense>
  );
}
