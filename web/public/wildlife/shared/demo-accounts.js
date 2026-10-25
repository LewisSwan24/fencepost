// Hardcoded authentication is used only for the Fencepost exhibition prototype.
// Client-side credentials and route protection are not secure enough for a deployed production service.
// These intentionally public demo passwords are never written to browser storage.
export const demoAccounts = [
  {
    id: "resident-taylor",
    email: "resident@fencepost.demo",
    password: "resident123",
    displayName: "Taylor",
    role: "user",
  },
  {
    id: "wildlife-moderator",
    email: "moderator@fencepost.demo",
    password: "moderator123",
    displayName: "Wildlife Moderator",
    role: "moderator",
  },
];
export const demoAccountNotice =
  "Demonstration login for the Fencepost prototype. Do not enter a real password.";
