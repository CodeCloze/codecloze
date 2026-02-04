import OpenAI from "openai";

/**
 * Azure AI Foundry / OpenAI Client Configuration
 * 
 * Uses environment variables for configuration:
 * - AZURE_OPENAI_ENDPOINT: The Azure OpenAI endpoint URL (e.g., https://your-resource.openai.azure.com)
 * - AZURE_OPENAI_API_KEY: The API key for authentication
 */

// Cache clients per deployment name since each deployment needs its own baseURL
const clientCache: Map<string, OpenAI> = new Map();

function getClient(deploymentName: string): OpenAI {
  // Return cached client if available
  if (clientCache.has(deploymentName)) {
    return clientCache.get(deploymentName)!;
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error("Azure OpenAI credentials not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY");
  }

  // Normalize endpoint: add https:// if missing, remove trailing slash
  let cleanEndpoint = endpoint.trim();
  if (!cleanEndpoint.startsWith("http://") && !cleanEndpoint.startsWith("https://")) {
    cleanEndpoint = `https://${cleanEndpoint}`;
  }
  cleanEndpoint = cleanEndpoint.replace(/\/$/, "");

  // Configure OpenAI client for Azure OpenAI
  // Azure OpenAI requires the deployment name in the base URL path
  // Format: https://{endpoint}/openai/deployments/{deployment-name}
  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: `${cleanEndpoint}/openai/deployments/${deploymentName}`,
    defaultQuery: { "api-version": "2024-02-15-preview" },
    defaultHeaders: {
      "api-key": apiKey,
    },
  });

  // Cache the client for this deployment
  clientCache.set(deploymentName, client);

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
  const openaiClient = getClient(deploymentName);

  // Log the configuration for debugging (without exposing the API key)
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  let cleanEndpoint = endpoint?.trim() || "";
  if (cleanEndpoint && !cleanEndpoint.startsWith("http://") && !cleanEndpoint.startsWith("https://")) {
    cleanEndpoint = `https://${cleanEndpoint}`;
  }
  cleanEndpoint = cleanEndpoint.replace(/\/$/, "");
  
  console.log("Calling Azure OpenAI", {
    deploymentName,
    baseURL: `${cleanEndpoint}/openai/deployments/${deploymentName}`,
    hasApiKey: !!process.env.AZURE_OPENAI_API_KEY,
  });

  try {
    // Use chat completions API (standard for Azure OpenAI)
    // For Azure OpenAI, the model parameter can be the deployment name or any string
    // The actual deployment is determined by the baseURL path
    const response = await openaiClient.chat.completions.create({
      model: deploymentName, // Can be deployment name or any string for Azure
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0, // Deterministic
      max_tokens: maxTokens,
      // No streaming, no retries - single deterministic call
    });

    // Extract the completion text from chat response
    const choice = response.choices[0];
    if (!choice || !choice.message || !choice.message.content) {
      throw new Error("No completion text returned from LLM");
    }

    return choice.message.content.trim();
  } catch (err: any) {
    // Enhanced error logging for Azure OpenAI issues
    if (err?.code === "DeploymentNotFound" || err?.status === 404) {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      let cleanEndpoint = endpoint?.trim() || "";
      if (cleanEndpoint && !cleanEndpoint.startsWith("http://") && !cleanEndpoint.startsWith("https://")) {
        cleanEndpoint = `https://${cleanEndpoint}`;
      }
      cleanEndpoint = cleanEndpoint.replace(/\/$/, "");
      
      console.error("Azure OpenAI deployment not found", {
        deploymentName,
        endpoint: cleanEndpoint,
        fullURL: `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions`,
        error: err.message,
      });
      throw new Error(
        `Azure OpenAI deployment "${deploymentName}" not found. Check that the deployment exists and AZURE_OPENAI_ENDPOINT is correct.`
      );
    }
    throw err;
  }
}
