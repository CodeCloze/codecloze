import { OpenAIClient, AzureKeyCredential } from "@azure/openai";

/**
 * Azure AI Foundry / OpenAI Client Configuration
 * 
 * Uses environment variables for configuration:
 * - AZURE_OPENAI_ENDPOINT: The Azure OpenAI endpoint URL
 * - AZURE_OPENAI_API_KEY: The API key for authentication
 */

let client: OpenAIClient | null = null;

function getClient(): OpenAIClient {
  if (client) {
    return client;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("Azure OpenAI credentials not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY");
  }

  client = new OpenAIClient(
    endpoint,
    new AzureKeyCredential(apiKey)
  );

  return client;
}

/**
 * Call Azure OpenAI with deterministic settings
 * 
 * Uses chat completions API (standard for Azure OpenAI)
 * 
 * @param deploymentName - The deployment name (from environment or parameter)
 * @param prompt - The prompt to send
 * @param maxTokens - Maximum tokens to generate (default: 300)
 * @returns The completion text
 */
export async function callLLM(
  deploymentName: string,
  prompt: string,
  maxTokens: number = 300
): Promise<string> {
  const openaiClient = getClient();

  // Use chat completions API (standard for Azure OpenAI)
  const response = await openaiClient.getChatCompletions(
    deploymentName,
    [
      {
        role: "user",
        content: prompt,
      },
    ],
    {
      temperature: 0, // Deterministic
      maxTokens,
      // No streaming, no retries - single deterministic call
    }
  );

  // Extract the completion text from chat response
  const choice = response.choices[0];
  if (!choice || !choice.message || !choice.message.content) {
    throw new Error("No completion text returned from LLM");
  }

  return choice.message.content.trim();
}
