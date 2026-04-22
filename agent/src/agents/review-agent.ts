import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { executeTool, toolDefinitions, submitReviewToolDefinition } from "../tools.js";
import { REPO_ROOT } from "../prompts.js";
import { reviewRules } from "../rules.js";
import { getPullRequestDiff, submitReview } from "../github.js";

const client = new Anthropic();

const systemPrompt = `
You are a senior engineer reviewing pull requests for a DeFi application on Solana and Base.

## Your task
Review the provided PR diff against the rules below. Then:
1. Read the relevant source files to verify completeness
2. Decide: APPROVE or REQUEST_CHANGES
3. Write a concise review comment explaining your decision
4. Call submit_review with your decision and comment

## Codebase
Repo root: ${REPO_ROOT}
Key files:
- src/config.ts              — Constants
- src/services/wallet.ts     — Wallet compatibility layer
- src/services/kamino.ts     — Kamino lending operations
- src/services/mayan.ts      — Mayan bridge operations
- src/services/pipeline.ts   — End-to-end orchestration
- src/index.ts               — CLI entry point

${reviewRules}
`;

const reviewToolDefinitions = [...toolDefinitions, submitReviewToolDefinition];

export interface ReviewResult {
  approved: boolean;
  body: string;
}

export async function runReviewAgent(prNumber: number): Promise<ReviewResult> {
  console.log(`\n[review-agent] Starting — PR #${prNumber}\n`);
  let result: ReviewResult = { approved: false, body: "" };

  const diff = await getPullRequestDiff(prNumber);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Review PR #${prNumber}.\n\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``,
    },
  ];

  while (true) {
    let response: Anthropic.Message;
    while (true) {
      try {
        response = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          tools: reviewToolDefinitions,
          messages,
        });
        break;
      } catch (e: any) {
        if (e?.status === 429) {
          const retryAfter = parseInt(e?.headers?.["retry-after"] ?? "30");
          console.log(`[review-agent] Rate limited — waiting ${retryAfter}s before retry`);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        throw e;
      }
    }

    console.log(`[review-agent] stop_reason: ${response.stop_reason}`);

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      console.log("\n[review-agent] Finished\n");
      return result;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      console.log(`[tool] ${block.name}(${JSON.stringify(block.input)})`);

      if (block.name === "submit_review") {
        const { event, body } = block.input as { event: "APPROVE" | "REQUEST_CHANGES"; body: string };
        await submitReview(prNumber, event, body);
        result = { approved: event === "APPROVE", body };
        const toolResult = `Review submitted: ${event}`;
        console.log(`\n[review-agent] Review submitted: ${event}\n`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: toolResult });
      } else {
        const toolResult = executeTool(block.name, block.input as Record<string, string>);
        console.log(`[tool] -> ${toolResult.slice(0, 120)}${toolResult.length > 120 ? "..." : ""}\n`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: toolResult });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Review agent loop ended without returning a result");
}

// Run as CLI: npx tsx src/agents/review-agent.ts <pr-number>
const isMain = process.argv[1]?.includes("agents/review-agent");
if (isMain) {
  const prNumber = parseInt(process.argv[2]);
  if (!prNumber) {
    console.error("Usage: tsx src/agents/review-agent.ts <pr-number>");
    process.exit(1);
  }
  runReviewAgent(prNumber).catch((err) => {
    console.error("Review agent error:", err);
    process.exit(1);
  });
}
