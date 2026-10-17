import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, appendFile } from "node:fs/promises";
import { createStockTools, toolDefinitions } from "./tools.js";
import {
  checkReportDraft,
  validationToolDefinition,
} from "./report-validation.js";

const context = JSON.parse(await readFile(process.argv[2], "utf8"));
const tools = createStockTools(context, {
  onCall: (event) =>
    appendFile(context.audit_path, JSON.stringify(event) + "\n", {
      mode: 0o600,
    }),
});
const server = new Server(
  { name: "twstock-platform", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...toolDefinitions, validationToolDefinition].map((t) => ({
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
    if (params.name === validationToolDefinition.name) {
      const calls = (await readFile(context.audit_path, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const result = checkReportDraft(
        params.arguments,
        calls,
        context.snapshot.report,
        context.user_message,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
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
