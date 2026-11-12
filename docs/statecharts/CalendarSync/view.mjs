export const title = "Life OS: one task's Google Calendar event";

const wants = (v) => v.sync && v.due && (v.switch || v.auto);
const waiting = (v) => v.work !== "none";

export const state = (v) => {
  if (v.issue === "removed") return "Marked deleted in Google";
  if (v.issue === "limited" && !waiting(v)) return "Rate limited, nothing retries";
  if (wants(v)) {
    if (!v.event) return waiting(v) ? "Waiting to be added" : "Missing, nothing adds it";
    return v.work === "cleanup" ? "Waiting to be removed" : "On the calendar";
  }
  if (v.event) return waiting(v) ? "Waiting to be removed" : "Left behind in Google";
  return "Not on the calendar";
};

const GROUP = {
  "On the calendar": "settled",
  "Not on the calendar": "settled",
  "Waiting to be added": "waiting",
  "Waiting to be removed": "waiting",
};

export const group = (v) => GROUP[state(v)] ?? "stuck";

export const colors = { settled: "teal", waiting: "blue", stuck: "orange" };

const LABELS = {
  YouTurnSyncOn: "you turn sync on",
  YouTurnAutoAddOn: "you turn auto-add on",
  YouTurnSyncOff: "you turn sync off",
  YouTurnAutoAddOff: "you turn auto-add off",
  YouDateTheTask: "you give it a date",
  YouTurnTheSwitchOn: "you give it a date",
  YouFinishTheTask: "you take the date away",
  YouTurnTheSwitchOff: "you take the date away",
  ThePushRuns: "the push runs",
  TheCleanupDeletesTheEvent: "the cleanup runs",
  GoogleLimitsThePush: "Google rate-limits",
  GoogleLimitsTheRetry: "Google rate-limits",
  ThePushFindsTheEventDeleted: "it is gone in Google",
  GoogleRefusesTheCleanup: "Google refuses",
  YouPressRepair: "you press Repair",
};

export const step = (action) => LABELS[action] ?? action;
