// S24 Ultra - the deployed entrypoint.
//
// Vercel rejects a function whose path contains a space, so the section lives in
// its own space-named folder and this file is the entrypoint it is served from.
// It holds no logic: the section remains the one place its behaviour is defined.

export { default } from '../S24/S24 Ultra/section.js';
