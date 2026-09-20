// Thin wrapper — both /api/jp-device and /api/jp-devices are served
// by Backend/jp-devices.js. This shim keeps the vercel.json route
// and any imports referencing Backend/jp-device.js working.
export { default } from './jp-devices.js';
