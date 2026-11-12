export const title = "Life OS: one task, on the board or in the Library";

export const state = (v) => {
  if (!v.alive) return "Deleted";
  if (v.archived) return v.done ? "In the Library, ticked off" : "In the Library";
  return v.done ? "On the board, ticked off" : "On the board";
};

const GROUP = {
  "On the board": "board",
  "On the board, ticked off": "board",
  "In the Library": "library",
  "In the Library, ticked off": "library",
  Deleted: "gone",
};

export const group = (v) => GROUP[state(v)];

export const colors = { board: "teal", library: "blue", gone: "tan" };

const LABELS = {
  YouTickItOff: "you tick it off",
  YouReopenIt: "you untick it",
  YouArchiveIt: "you archive it",
  YouRestoreIt: "you restore it from the Library",
  YouDeleteIt: "you delete it",
};

export const step = (action) => LABELS[action] ?? action;
