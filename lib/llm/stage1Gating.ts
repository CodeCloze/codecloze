import { callLLM, TextFormatRequest } from "./client";

/**
 * Stage 1: Gating Model
 * 
 * Determines whether deeper review is warranted.
 * Uses the cheapest Azure AI Foundry model available.
 */

const GATING_PROMPT = `You are reviewing a pull request diff.

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
{"review": true}

Diff:
---
{DIFF}
---`;

const GATING_RESPONSE_FORMAT: TextFormatRequest = {
  type: "json_schema",
  name: "gating_review",
  description: "Indicates whether a full review is required based on the diff",
  instructions: "Return exactly one JSON object matching this schema without additional commentary.",
  json_schema: {
    type: "object",
    properties: {
      review: {
        type: "boolean",
        description: "True when a realistic bug risk warrants further review",
      },
    },
    required: ["review"],
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
  // Get deployment name from environment (e.g., "gpt-5-nano" or equivalent)
  const deploymentName = process.env.AZURE_OPENAI_GATING_DEPLOYMENT;
  if (!deploymentName) {
    throw new Error("AZURE_OPENAI_GATING_DEPLOYMENT not set");
  }

  // Replace {DIFF} placeholder in prompt
  const prompt = GATING_PROMPT.replace("{DIFF}", diffText);

  try {
    // Call LLM with token limit for gating
    // Note: Reasoning models use reasoning tokens that count against max_completion_tokens
    // We need higher limits to account for reasoning + completion tokens
    // Using 1000 tokens to ensure we get completion text even with reasoning
    const response = await callLLM(deploymentName, prompt, 2000, GATING_RESPONSE_FORMAT);

    // Parse JSON response strictly
    let parsed: GatingResponse;
    try {
      // Try to extract JSON from response (handle cases where LLM adds extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // Parse failure = fail open (treat as review needed)
      console.error("Failed to parse gating response", {
        response,
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return true; // Fail open - assume review needed
    }

    // Validate response structure
    if (typeof parsed.review !== "boolean") {
      console.error("Invalid gating response structure", parsed);
      return true; // Fail open
    }

    return parsed.review;
  } catch (err) {
    // Any error = fail open
    console.error("Gating model error", err);
    return true; // Fail open - assume review needed
  }
}
