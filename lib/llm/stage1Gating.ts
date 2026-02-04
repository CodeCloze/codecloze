import { callLLM, TextFormatJsonSchema } from "./client";

/**
 * Stage 1: Gating Model
 * 
 * Determines whether deeper review is warranted.
 * Uses the cheapest Azure AI Foundry model available.
 */

const GATING_SYSTEM_MESSAGE = `You are reviewing a pull request diff.

Determine whether there is any plausible bug risk that could realistically cause:
- runtime errors
- logic regressions
- auth or state bugs
- data integrity issues

Ignore:
- formatting
- refactors
- renames
- comments
- style changes

Use the structured schema enforced by the Responses API to reply. Do not add extra text beyond the schema.

If no meaningful risk exists:
{"review": false}

If any realistic risk might exist:
{"review": true}`;

const GATING_RESPONSE_FORMAT: TextFormatJsonSchema = {
  type: "json_schema",
  name: "gating_review",
  strict: true,
  schema: {
    type: "object",
    properties: {
      review: {
        type: "boolean",
        description: "True when a realistic bug risk warrants further review",
      },
    },
    required: ["review"],
    additionalProperties: false,
  },
};

interface GatingResponse {
  review: boolean;
}

/**
 * Run Stage 1 gating model
 * 
 * @param diffText - The PR diff text
 * @returns true if review is needed, false otherwise
 */
export async function runGatingModel(diffText: string): Promise<boolean> {
  const deploymentName = process.env.AZURE_OPENAI_GATING_DEPLOYMENT;
  if (!deploymentName) {
    throw new Error("AZURE_OPENAI_GATING_DEPLOYMENT not set");
  }

  const messages = [
    { role: "system", content: GATING_SYSTEM_MESSAGE },
    {
      role: "user",
      content: `Diff:\n---\n${diffText}\n---`,
    },
  ];

  try {
    const response = await callLLM(deploymentName, messages, 2000, GATING_RESPONSE_FORMAT);

    let parsed: GatingResponse;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("Failed to parse gating response", {
        response,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return true;
    }

    if (typeof parsed.review !== "boolean") {
      console.error("Invalid gating response structure", parsed);
      return true;
    }

    return parsed.review;
  } catch (err) {
    console.error("Gating model error", err);
    return true;
  }
}
