import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  // The complete app uses the production project and its existing main branch.
  // Refuse preview branches and accidental links to another project's main.
  branch: (branch) => {
    if (branch.name !== "main" || branch.id !== "br-hidden-leaf-b8l1j76r") {
      throw new Error("This repository uses bitter-glade-72523152/main only.");
    }
    return {};
  },
});
