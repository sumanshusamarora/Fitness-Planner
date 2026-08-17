import "dotenv/config";
import { buildTrainingContext } from "@/lib/coach/buildTrainingContext";
import { applyProposal } from "@/lib/coach/applyProposal";
import { createProposalForActivePlan, getProposal } from "@/lib/coach/service";
import { respondToProposal } from "@/lib/coach/respondToProposal";
import { getActivePlan, getSingleUser } from "@/lib/workouts";
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

async function main() {
  const [command, value, flag, answer] = process.argv.slice(2);
  if (command === "context") {
    const [user, plan] = await Promise.all([getSingleUser(), getActivePlan()]);
    if (!user || !plan) throw new Error("No active user and plan were found.");
    console.log(JSON.stringify(await buildTrainingContext(user.id, plan.id), null, 2));
    return;
  }
  if (command === "propose") {
    const stored = await createProposalForActivePlan();
    if (!stored) throw new Error("No active plan was found.");
    printProposal(stored.id, stored.proposal);
    console.log(`Status: ${stored.status}. No workout plan was written.`);
    return;
  }
  if (command === "show") {
    const proposal = await getProposal(Number(value));
    if (!proposal) throw new Error("Proposal not found.");
    printProposal(proposal.id, proposal.proposal);
    console.log(`Status: ${proposal.status}`);
    return;
  }
  if (command === "approve") {
    if (flag !== "--confirm") throw new Error("Approval requires the explicit --confirm flag.");
    const result = await applyProposal(Number(value), { confirmation: "approve" });
    console.log(`Applied Week ${result.weekNumber} as plan #${result.planId}.`);
    return;
  }
  if (command === "answer") {
    if (!flag || !answer) throw new Error("Use: answer <proposal-id> <question-id> <one listed answer>");
    const proposal = await respondToProposal(Number(value), flag, answer);
    printProposal(Number(value), proposal);
    console.log("Answer recorded. Review the updated proposal before approving it.");
    return;
  }
  console.error("Usage: npm run coach -- <context|propose|show ID|answer ID QUESTION ANSWER|approve ID --confirm>");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
