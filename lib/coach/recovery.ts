import {
  hasMeaningfulJointPain,
  hasPoorRecovery,
  type RecoverySnapshot,
} from "@/lib/progression";
import type { RecoverySummary } from "./types";

type RecoveryEntry = RecoverySnapshot & { notes: string | null };

function average(entries: RecoveryEntry[]): RecoverySnapshot | null {
  if (entries.length === 0) return null;
  const keys: (keyof RecoverySnapshot)[] = [
    "sleep",
    "energy",
    "soreness",
    "jointPain",
    "stress",
  ];
  const result: RecoverySnapshot = {
    sleep: null,
    energy: null,
    soreness: null,
    jointPain: null,
    stress: null,
  };
  for (const key of keys) {
    const values = entries
      .map((entry) => entry[key])
      .filter((value): value is number => value != null);
    result[key] = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : null;
  }
  return result;
}

export function summariseRecovery(entries: RecoveryEntry[]): RecoverySummary {
  const latest = entries[0]
    ? {
        sleep: entries[0].sleep,
        energy: entries[0].energy,
        soreness: entries[0].soreness,
        jointPain: entries[0].jointPain,
        stress: entries[0].stress,
      }
    : null;
  const avg = average(entries);
  return {
    entries: entries.length,
    latest,
    average: avg,
    poorRecovery: hasPoorRecovery(avg ?? latest),
    meaningfulJointPain: hasMeaningfulJointPain(latest) || hasMeaningfulJointPain(avg),
    notes: entries.flatMap((entry) => (entry.notes ? [entry.notes] : [])).slice(0, 3),
  };
}

export function recoverySummaryText(recovery: RecoverySummary): string {
  if (recovery.entries === 0) return "No recovery check-ins were logged.";
  if (recovery.meaningfulJointPain) return "Meaningful joint pain was reported; progression is paused pending input.";
  if (recovery.poorRecovery) return "Recovery was below baseline, so the plan stays conservative.";
  return "Recovery was adequate for a conservative progression review.";
}
