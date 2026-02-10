import { createApp } from "./app.js";
import { bootstrapEnv } from "./bootstrapEnv.js";

bootstrapEnv();

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  // Keep startup log minimal to avoid noisy server output.
  console.log(`douyin-copy-engine-v2 listening on :${port}`);
});
