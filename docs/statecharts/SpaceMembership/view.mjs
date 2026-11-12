export const title = "Life OS: one person in a shared space";

const membership = (v) => {
  if (!v.space) return "No space";
  if (v.owner === "U") return "You own it";
  if (v.me === "member") return "You are a member";
  return "You are outside";
};

const throttle = (v) => (v.fails === 3 ? "Locked out" : "Free to try a code");

const work = (v) => (v.assigned ? "A task in your name" : "No task in your name");

export const state = (v) => ({
  Membership: membership(v),
  Throttle: throttle(v),
  Work: work(v),
});

const GROUP = {
  "No space": "none",
  "You own it": "inside",
  "You are a member": "inside",
  "You are outside": "outside",
};

export const group = (v) => GROUP[membership(v)];

export const colors = { inside: "teal", outside: "blue", none: "tan" };

const LABELS = {
  YouCreateTheSpace: "you create a space",
  ATeammateCreatesTheSpace: "a teammate creates the space",
  YouGetTheLink: "you get the invite link",
  YouOpenTheLink: "you open the invite link",
  YouPasteAWrongCode: "you paste a wrong code [the third one]",
  TheLockoutEnds: "the lockout ends",
  ATeammateAssignsYouATask: "a teammate assigns you a task",
  YouLeave: "you leave",
  TheOtherPersonLeavesAsOwner: "the owner leaves",
  TheOwnerRemovesYou: "the owner removes you",
  YouDeleteTheSpace: "you delete the space",
  TheUnassignPassRuns: "the unassign pass runs",
  NoSpace: "nothing changes",
};

export const step = (action) => LABELS[action] ?? action;
