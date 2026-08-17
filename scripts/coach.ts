import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { buildTrainingContext } from "@/lib/coach/buildTrainingContext";
import { applyProposal } from "@/lib/coach/applyProposal";
import { createProposalForActivePlan, getProposal } from "@/lib/coach/service";
import { respondToProposal } from "@/lib/coach/respondToProposal";
import { getActivePlan } from "@/lib/workouts";
import { normalizeUsername } from "@/lib/username";
import type { WeeklyPlanProposal } from "@/lib/coach/types";

function printProposal(id: number, proposal: WeeklyPlanProposal) {
  console.log(`Week ${proposal.proposedWeekNumber} proposal #${id}`);
  console.log(`${proposal.summary.completedSessions}/${proposal.summary.plannedSessions} workouts · ${proposal.summary.recoverySummary}`);
  for (const change of proposal.changes) {
    console.log(`${change.exerciseName}: ${change.previous.weightKg ?? "—"} → ${change.proposed.weightKg ?? "—"} kg · ${change.action}`);
    console.log(`  ${change.reason}`);
  }
  for (const question of proposal.questions) console.log(`INPUT: ${question.prompt}`);
}

async function resolveUserId(argv: string[]): Promise<number> {
  const idx = argv.indexOf("--user");
  const token = idx !== -1 ? argv[idx + 1] : process.env.FITNESS_USER_ID;
  if (token) {
    const byId = Number(token);
    if (Number.isInteger(byId) && byId > 0) return byId;
    const normalized = normalizeUsername(token);
    const row = (
      await db.select({ id: users.id }).from(users).where(eq(users.usernameNormalized, normalized)).limit(1)
    )[0];
    if (row) return row.id;
    throw new Error(`No user found for "${token}". Run "npm run coach -- users".`);
  }
  throw new Error("Provide a user with --user <id|username> or the FITNESS_USER_ID env var.");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const value = args[1];

  if (command === "users") {
    const rows = await db.select({ id: users.id, username: users.username, name: users.name }).from(users).orderBy(users.id);
    for (const row of rows) console.log(`${row.id}\t${row.username ?? "-"}\t${row.name}`);
    return;
  }

  const userId = await resolveUserId(args);

  if (command === "context") {
    const plan = await getActivePlan(userId);
    if (!plan) throw new Error("No active plan was found for this user.");
    console.log(JSON.stringify(await buildTrainingContext(userId, plan.id), null, 2));
    return;
  }
  if (command === "propose") {
    const stored = await createProposalForActivePlan(userId);
    if (!stored) throw new Error("No active plan was found.");
    printProposal(stored.id, stored.proposal);
    console.log(`Status: ${stored.status}. No workout plan was written.`);
    return;
  }
  if (command === "show") {
    const proposal = await getProposal(userId, Number(value));
    if (!proposal) throw new Error("Proposal not found.");
    printProposal(proposal.id, proposal.proposal);
    console.log(`Status: ${proposal.status}`);
    return;
  }
  if (command === "approve") {
    const flag = args[2];
    if (flag !== "--confirm") throw new Error("Approval requires the explicit --confirm flag.");
    const result = await applyProposal(userId, Number(value), { confirmation: "approve" });
    console.log(`Applied Week ${result.weekNumber} as plan #${result.planId}.`);
    return;
  }
  if (command === "answer") {
    const questionId = args[2];
    const answer = args[3];
    if (!questionId || !answer) throw new Error("Use: answer <proposal-id> <question-id> <one listed answer>");
    const proposal = await respondToProposal(userId, Number(value), questionId, answer);
    printProposal(Number(value), proposal);
    console.log("Answer recorded. Review the updated proposal before approving it.");
    return;
  }
  console.error("Usage: npm run coach -- <users|context|propose|show ID|answer ID QUESTION ANSWER|approve ID --confirm> [--user ID|username]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
