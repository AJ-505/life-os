export const title = "Life OS: one project, on the board or in the Library";

export const state = (v) => {
  if (!v.alive) return "Deleted";
  if (v.status === "active") return "On the board";
  if (v.status === "done") return "Done, in the Library";
  return "Shelved, in the Library";
};

const GROUP = {
  "On the board": "board",
  "Shelved, in the Library": "library",
  "Done, in the Library": "library",
  Deleted: "gone",
};

export const group = (v) => GROUP[state(v)];

export const colors = { board: "teal", library: "blue", gone: "tan" };

const LABELS = {
  YouShelveIt: "you shelve it",
  YouPutItBackOnTheBoard: "you restore it",
  YouMarkItDone: "you mark it done",
  YouDeleteIt: "you delete it and its tasks",
  TheProjectIsGone: "it is gone",
};

export const step = (action) => LABELS[action] ?? action;
