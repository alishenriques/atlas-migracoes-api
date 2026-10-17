import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnv } from "./schemas/domain.js";

const env = loadEnv();
const server = createServer(createApp(env));

server.listen(env.PORT, () => {
  console.log(`GraphQL ready at http://localhost:${env.PORT}/graphql`);
});
