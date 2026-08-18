export const routes = {
  week: (weekId: number | string) => `/weeks/${weekId}`,
  weekNext: () => "/week/next",
  day: (weekId: number | string, dayId: number | string) =>
    `/weeks/${weekId}/days/${dayId}`,
  session: (
    weekId: number | string,
    dayId: number | string,
    sessionId: number | string,
  ) => `/weeks/${weekId}/days/${dayId}/sessions/${sessionId}`,
  sessionComplete: (
    weekId: number | string,
    dayId: number | string,
    sessionId: number | string,
  ) => `/weeks/${weekId}/days/${dayId}/sessions/${sessionId}/complete`,
  historySession: (sessionId: number | string) => `/history/sessions/${sessionId}`,
  recovery: (dayId: number | string) => `/recovery?planDayId=${dayId}`,
};
