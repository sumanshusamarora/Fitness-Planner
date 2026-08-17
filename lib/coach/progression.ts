// The canonical deterministic progression engine remains in lib/progression.
// This re-export gives coaching callers a stable domain-local import path.
export {
  hasMeaningfulJointPain,
  hasPoorRecovery,
  recommendNextWeight,
  roundToQuarter,
  smallestIncrement,
} from "@/lib/progression";
export type { ProgressionParams, ProgressionResult, RecoverySnapshot } from "@/lib/progression";
