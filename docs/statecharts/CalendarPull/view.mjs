export const title = "Life OS: the Calendar view reading Google";

export const state = (v) => {
  if (v.running) return "Reading Google";
  if (v.fetched) return "This week is fetched";
  if (v.covered) return "Fetch failed, blocked for five minutes";
  return v.age === "over5min"
    ? "This week was never fetched"
    : "Waiting out the navigation gap";
};

const GROUP = {
  "Reading Google": "reading",
  "This week is fetched": "settled",
  "This week was never fetched": "waiting",
  "Waiting out the navigation gap": "waiting",
  "Fetch failed, blocked for five minutes": "stuck",
};

export const group = (v) => GROUP[state(v)];

export const colors = { settled: "teal", reading: "blue", waiting: "blue", stuck: "orange" };

const LABELS = {
  TheClockAdvances: "time passes",
  YouOpenAnotherWeek: "you open another week",
  TheViewAsksGoogle: "the view asks Google [the gate is open]",
  ThePullSucceeds: "Google answers",
  ThePullFails: "Google does not answer",
};

export const step = (action, from) => {
  if (action === "ThePullFails")
    return from.fetched
      ? "the refresh fails, the week keeps its old events"
      : "the first read fails";
  return LABELS[action] ?? action;
};
