import { Dashboard } from "./Dashboard";
import { Login } from "./Login";
import { isAdmin } from "../lib/auth";
import { getDashboardData } from "../lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAdmin())) return <Login />;
  return <Dashboard initial={await getDashboardData()} />;
}
