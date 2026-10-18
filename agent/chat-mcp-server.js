import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, appendFile } from "node:fs/promises";
import {
  createAssistantTools,
  assistantToolDefinitions,
} from "./assistant-tools.js";
const context = JSON.parse(await readFile(process.argv[2], "utf8"));
const tools = createAssistantTools(context, {
  onCall: (event) =>
    appendFile(context.audit_path, JSON.stringify(event) + "\n", {
      mode: 0o600,
    }),
});
const server = new Server(
  { name: "twstock-chat", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: assistantToolDefinitions.map((t) => ({
    ...t,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  })),
}));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(await tools.call(params.name, params.arguments)),
        },
      ],
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
process.stdin.on("end", () => process.exit(0));
