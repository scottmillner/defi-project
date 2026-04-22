import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { executeTool, toolDefinitions } from "../tools.js";
import { systemPrompt } from "../prompts.js";
import { createPullRequest } from "../github.js";

const client = new Anthropic();

export interface AgentResult {
  prNumber: number;
  branch: string;
}

export interface FixOptions {
  prNumber: number;
  branch: string;
  reviewComments: string;
}

export async function runCodingAgent(
  service: string,
  issueNumber?: number,
  fix?: FixOptions
): Promise<AgentResult> {
  const branch = fix?.branch ?? `implement/${service}`;
  const mode = fix ? "fix" : "implement";

  console.log(`\n[coding-agent] Starting — ${mode}: ${service}\n`);

  const userMessage = fix
    ? `The PR for the "${service}" service received review feedback. Fix the issues and push to the existing branch: ${branch}.

Review comments:
${fix.reviewComments}

Push to the existing branch — do NOT create a new branch.`
    : `Implement the "${service}" service following the patterns described in the system prompt.

After implementation:
1. Create a new branch: ${branch}
2. Commit the changed files
3. Push the branch to origin`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // Agentic loop — keep going until the model stops calling tools
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    });

    console.log(`[coding-agent] stop_reason: ${response.stop_reason}`);

    // Add assistant response to message history
    messages.push({ role: "assistant", content: response.content });

    // If no more tool calls, open the PR and we're done
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      if (textBlock && textBlock.type === "text") {
        console.log(`\n[coding-agent] Finished:\n\n${textBlock.text}\n`);
      }

      const prBody = [
        `## Summary`,
        `Implements the \`${service}\` service.`,
        ``,
        issueNumber ? `Closes #${issueNumber}` : "",
        ``,
        `Generated with Claude Agent SDK`,
      ].join("\n");

      // In fix mode the PR already exists — no need to open a new one
      if (fix) {
        console.log(`\n[coding-agent] Fixes pushed to branch: ${branch}\n`);
        return { prNumber: fix.prNumber, branch };
      }

      console.log(`\n[coding-agent] Opening PR for branch: ${branch}`);
      const pr = await createPullRequest(
        `feat(services): implement ${service} service`,
        prBody,
        branch
      );
      console.log(`[coding-agent] PR opened: ${pr.url}\n`);
      return { prNumber: pr.number, branch };
    }

    // Execute all tool calls and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      console.log(`[tool] ${block.name}(${JSON.stringify(block.input)})`);
      const result = executeTool(
        block.name,
        block.input as Record<string, string>
      );
      console.log(
        `[tool] -> ${result.slice(0, 120)}${result.length > 120 ? "..." : ""}\n`
      );

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }

    // Feed results back to the model
    messages.push({ role: "user", content: toolResults });
  }

  // Unreachable — while(true) always exits via return above.
  throw new Error("Agent loop ended without returning a result");
}

// Only run as CLI when executed directly
const isMain = process.argv[1]?.includes("agents/coding-agent");
if (isMain) {
  const service = process.argv[2];
  const issueNumber = process.argv[3] ? parseInt(process.argv[3]) : undefined;

  if (!service) {
    console.error("Usage: tsx src/agents/coding-agent.ts <service-name> [issue-number]");
    console.error("Example: tsx src/agents/coding-agent.ts wallet 1");
    process.exit(1);
  }

  runCodingAgent(service, issueNumber).catch((err) => {
    console.error("Agent error:", err);
    process.exit(1);
  });
}
