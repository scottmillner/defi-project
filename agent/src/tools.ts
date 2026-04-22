import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

export const toolDefinitions = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file at the given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_bash",
    description: "Run a bash command and return stdout, stderr, and exit code.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The bash command to run" },
        cwd: {
          type: "string",
          description: "Working directory for the command",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "git_create_branch",
    description: "Create and checkout a new git branch.",
    input_schema: {
      type: "object" as const,
      properties: {
        branch: { type: "string", description: "Branch name to create" },
        cwd: { type: "string", description: "Repo directory" },
      },
      required: ["branch", "cwd"],
    },
  },
  {
    name: "git_commit",
    description: "Stage specific files and create a git commit.",
    input_schema: {
      type: "object" as const,
      properties: {
        files: {
          type: "string",
          description: "Space-separated list of file paths to stage",
        },
        message: { type: "string", description: "Commit message" },
        cwd: { type: "string", description: "Repo directory" },
      },
      required: ["files", "message", "cwd"],
    },
  },
  {
    name: "git_push",
    description: "Push the current branch to origin.",
    input_schema: {
      type: "object" as const,
      properties: {
        branch: { type: "string", description: "Branch name to push" },
        cwd: { type: "string", description: "Repo directory" },
      },
      required: ["branch", "cwd"],
    },
  },
];

// Exported separately — only used by review-agent, not all agents
export const submitReviewToolDefinition = {
  name: "submit_review",
  description: "Submit the final PR review decision.",
  input_schema: {
    type: "object" as const,
    properties: {
      event: {
        type: "string",
        enum: ["APPROVE", "REQUEST_CHANGES"],
        description: "The review outcome",
      },
      body: {
        type: "string",
        description: "The review comment explaining the decision",
      },
    },
    required: ["event", "body"],
  },
};

export function executeTool(
  name: string,
  input: Record<string, string>
): string {
  switch (name) {
    case "read_file": {
      try {
        return readFileSync(input.path, "utf-8");
      } catch (e) {
        return `Error reading file: ${e}`;
      }
    }
    case "write_file": {
      try {
        writeFileSync(input.path, input.content, "utf-8");
        return `File written successfully: ${input.path}`;
      } catch (e) {
        return `Error writing file: ${e}`;
      }
    }
    case "run_bash": {
      try {
        const stdout = execSync(input.command, {
          cwd: input.cwd,
          encoding: "utf-8",
          timeout: 120_000,
        });
        return JSON.stringify({ stdout, stderr: "", exitCode: 0 });
      } catch (e: any) {
        return JSON.stringify({
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? String(e),
          exitCode: e.status ?? 1,
        });
      }
    }
    case "git_create_branch": {
      try {
        execSync(`git checkout -b ${input.branch}`, {
          cwd: input.cwd,
          encoding: "utf-8",
        });
        return `Branch created and checked out: ${input.branch}`;
      } catch (e: any) {
        return `Error creating branch: ${e.stderr ?? String(e)}`;
      }
    }
    case "git_commit": {
      try {
        execSync(`git add ${input.files}`, {
          cwd: input.cwd,
          encoding: "utf-8",
        });
        execSync(`git commit -m "${input.message}"`, {
          cwd: input.cwd,
          encoding: "utf-8",
        });
        return `Committed: ${input.message}`;
      } catch (e: any) {
        return `Error committing: ${e.stderr ?? String(e)}`;
      }
    }
    case "git_push": {
      try {
        execSync(`git push -u origin ${input.branch}`, {
          cwd: input.cwd,
          encoding: "utf-8",
        });
        return `Pushed branch: ${input.branch}`;
      } catch (e: any) {
        return `Error pushing: ${e.stderr ?? String(e)}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
