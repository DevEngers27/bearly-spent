// Plain ESM shared by the browser and server. Attempts count graded tries,
// starting at zero. Rotate all 15 subsets before repeating one.
export const LESSON_QUESTION_COUNT = 4;

export function pickLessonIndexes(childId, lessonId, attempt = 0) {
  let seed = 2166136261;
  for (const char of JSON.stringify([childId || "", lessonId])) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const indexes = [0, 1, 2, 3, 4, 5];
  const offset = seed % 15;
  for (let i = indexes.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  const pairs = [];
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) pairs.push([i, j]);
  }
  const [a, b] = pairs[(offset + attempt % pairs.length) % pairs.length];
  return indexes.filter((_, i) => i !== a && i !== b);
}
