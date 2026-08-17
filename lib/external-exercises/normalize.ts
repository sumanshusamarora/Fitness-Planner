/**
 * Shared text / value normalization used by both the import normalizers and
 * the matching layer. The goal is stable, comparable strings — not aggressive
 * rewriting of provider terminology.
 */

/** Collapse all whitespace and trim. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A lossy key for fuzzy name comparison: lowercase, strip punctuation, collapse spaces. */
export function nameKey(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize a name key into a sorted set of significant tokens. */
export function nameTokens(value: string): Set<string> {
  return new Set(
    nameKey(value)
      .split(" ")
      .filter((t) => t.length > 0),
  );
}

/** Normalize a free-form list value into a trimmed, de-duplicated string array. */
export function normalizeStringList(
  value: string | string[] | null | undefined,
): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    // Split on common separators so "Back / Lats" becomes ["Back", "Lats"].
    for (const part of item.split(/[;,/]+/)) {
      const cleaned = collapseWhitespace(part);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(cleaned);
      }
    }
  }
  return out;
}

/** Normalize a single label (difficulty, exercise type) to a clean string or null. */
export function normalizeLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = collapseWhitespace(value);
  return cleaned ? cleaned : null;
}

/**
 * Muscle-group canonicalization used ONLY for comparison. Both the canonical
 * `exercises.primary_muscle` values (Chest, Back, Quads, …) and provider muscle
 * names (Pectoralis, Lats, Quadriceps, …) map to one of these groups.
 */
const MUSCLE_GROUPS: Record<string, string[]> = {
  chest: ["chest", "pectoral", "pectoralis", "pecs"],
  back: [
    "back", "lat", "lats", "latissimus", "upper back", "lower back",
    "trapezius", "traps", "rhomboid", "rhomboids", "erector", "erectors",
    "spinal erectors", "middle back", "teres",
  ],
  shoulders: [
    "shoulder", "shoulders", "deltoid", "delts", "deltoids",
    "lateral deltoid", "anterior deltoid", "posterior deltoid",
    "rear delt", "rear deltoid", "front deltoid",
  ],
  biceps: ["biceps", "bicep", "brachialis", "brachioradialis"],
  triceps: [
    "triceps", "tricep", "lateral head triceps", "medial head triceps",
    "long head triceps",
  ],
  quads: ["quads", "quad", "quadriceps", "quadricep"],
  hamstrings: ["hamstrings", "hamstring"],
  glutes: [
    "glutes", "glute", "gluteus", "gluteus maximus", "gluteus medius",
    "gluteus minimus",
  ],
  calves: ["calves", "calf", "gastrocnemius", "soleus"],
  core: [
    "core", "abdominals", "abs", "abdominal", "obliques", "oblique",
    "rectus abdominis", "transverse abdominis", "serratus",
  ],
  forearms: ["forearm", "forearms", "wrist", "wrists", "grip"],
  adductors: ["adductor", "adductors", "inner thigh"],
  abductors: ["abductor", "abductors", "outer thigh"],
  cardiovascular: ["cardiovascular", "cardio"],
};

export type MuscleGroup = keyof typeof MUSCLE_GROUPS | "other";

const muscleIndex = buildIndex(MUSCLE_GROUPS);

function buildIndex(groups: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [group, terms] of Object.entries(groups)) {
    for (const term of terms) map.set(nameKey(term), group);
  }
  return map;
}

export function canonicalMuscleGroup(muscle: string): MuscleGroup {
  const key = nameKey(muscle);
  const hit = muscleIndex.get(key);
  if (hit) return hit as MuscleGroup;
  // fall back to token prefix matching for e.g. "Pectoralis Major".
  for (const [group, terms] of Object.entries(MUSCLE_GROUPS)) {
    if (terms.some((t) => key.includes(nameKey(t)))) return group as MuscleGroup;
  }
  return "other";
}

/** Equipment canonicalization used ONLY for comparison. */
const EQUIPMENT_GROUPS: Record<string, string[]> = {
  machine: ["machine"],
  cable: ["cable", "cable machine", "cables"],
  dumbbell: ["dumbbell", "dumbbells"],
  barbell: ["barbell", "barbells"],
  bodyweight: ["bodyweight", "body weight", "body-weight", "none", "body"],
  band: ["band", "bands", "resistance band", "resistance bands"],
  kettlebell: ["kettlebell", "kettlebells"],
  smith: ["smith", "smith machine", "smith-machine"],
  ezbar: ["ez bar", "ez-bar", "ez curl bar"],
  pullupbar: ["pull up bar", "pull-up bar", "chin-up bar", "chin up bar"],
  plate: ["plate", "weight plate", "plates"],
  stabilityball: ["stability ball", "swiss ball", "exercise ball"],
  medicineball: ["medicine ball", "medicine-ball"],
  bosu: ["bosu", "bosu ball"],
  suspension: ["suspension", "trx", "suspension trainer"],
  cardio: ["cardio"],
};

export type EquipmentGroup = keyof typeof EQUIPMENT_GROUPS | "other";

const equipmentIndex = buildIndex(EQUIPMENT_GROUPS);

export function canonicalEquipmentGroup(equipment: string): EquipmentGroup {
  const key = nameKey(equipment);
  const hit = equipmentIndex.get(key);
  if (hit) return hit as EquipmentGroup;
  for (const [group, terms] of Object.entries(EQUIPMENT_GROUPS)) {
    if (terms.some((t) => key.includes(nameKey(t)))) return group as EquipmentGroup;
  }
  return "other";
}

/** Levenshtein distance for fuzzy name comparison. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** 0..1 similarity (1 = identical). */
export function similarity(a: string, b: string): number {
  const ak = nameKey(a);
  const bk = nameKey(b);
  if (!ak && !bk) return 1;
  if (!ak || !bk) return 0;
  const max = Math.max(ak.length, bk.length);
  return 1 - levenshtein(ak, bk) / max;
}

/** Jaccard similarity between token sets. */
export function tokenOverlap(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  return intersection / (ta.size + tb.size - intersection);
}
