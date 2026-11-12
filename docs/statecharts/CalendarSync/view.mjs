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
  YouDateTheTask: "you date the task or turn its switch on",
  YouTurnTheSwitchOn: "you date the task or turn its switch on",
  YouFinishTheTask: "you clear the date, finish the task, or turn its switch off",
  YouTurnTheSwitchOff: "you clear the date, finish the task, or turn its switch off",
  ThePushRuns: "the push runs",
  TheCleanupDeletesTheEvent: "the cleanup deletes the event",
  GoogleLimitsThePush: "Google rate limits the push",
  GoogleLimitsTheRetry: "Google rate limits the push",
  ThePushFindsTheEventDeleted: "the push finds it deleted in Google",
  GoogleRefusesTheCleanup: "Google refuses the cleanup",
  YouPressRepair: "you press Repair",
};

export const step = (action) => LABELS[action] ?? action;
