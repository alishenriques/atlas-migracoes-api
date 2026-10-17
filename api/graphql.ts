import { createApp } from "../src/app.js";

const app = createApp();

const handler = (request: Request) => app.fetch(request);

export { handler as GET, handler as POST, handler as OPTIONS };
