import OpenAI from "openai";

/**
 * Azure AI Foundry / OpenAI Client Configuration
 * 
 * Uses environment variables for configuration:
 * - AZURE_OPENAI_ENDPOINT: The Azure OpenAI endpoint URL (e.g., https://your-resource.openai.azure.com)
 * - AZURE_OPENAI_API_KEY: The API key for authentication
 */

// Cache the OpenAI client (shared across all deployments)
let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  // Return cached client if available
  if (cachedClient) {
    return cachedClient;
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

  // Configure OpenAI client for Azure OpenAI Responses API
  // Format: https://{resource}.openai.azure.com/openai/v1/
  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: `${cleanEndpoint}/openai/v1/`,
  });

  // Cache the client
  cachedClient = client;

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

  // Log the configuration for debugging (without exposing the API key)
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  let cleanEndpoint = endpoint?.trim() || "";
  if (cleanEndpoint && !cleanEndpoint.startsWith("http://") && !cleanEndpoint.startsWith("https://")) {
    cleanEndpoint = `https://${cleanEndpoint}`;
  }
  cleanEndpoint = cleanEndpoint.replace(/\/$/, "");
  
  console.log("Calling Azure OpenAI Responses API", {
    deploymentName,
    baseURL: `${cleanEndpoint}/openai/v1/`,
    hasApiKey: !!process.env.AZURE_OPENAI_API_KEY,
  });

  try {
    // Use Responses API
    const response = await openaiClient.responses.create({
      model: deploymentName, // Deployment name
      input: prompt, // Use input parameter for Responses API
      max_completion_tokens: maxTokens, // Use max_completion_tokens for Azure AI Foundry models
      temperature: 0, // Deterministic
    });

    // Extract the completion text from responses API format
    // The response structure may vary, check common fields
    if (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
      return response.choices[0].message.content.trim();
    }
    
    if (response.content) {
      return response.content.trim();
    }

    // Try to get text from response object directly
    const responseText = (response as any).text || (response as any).output;
    if (responseText) {
      return String(responseText).trim();
    }

    throw new Error("No completion text returned from Responses API");
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
        fullURL: `${cleanEndpoint}/openai/v1/responses`,
        error: err.message,
      });
      throw new Error(
        `Azure OpenAI deployment "${deploymentName}" not found. Check that the deployment exists and AZURE_OPENAI_ENDPOINT is correct.`
      );
    }
    throw err;
  }
}

/**
 * Call Azure AI Foundry Responses API
 * 
 * Uses the Responses API endpoint (same as callLLM, but kept for backward compatibility)
 * 
 * @param deploymentName - The deployment name
 * @param prompt - The prompt/input to send
 * @param maxTokens - Maximum tokens to generate (default: 800)
 * @returns The completion text
 */
export async function callResponsesAPI(
  deploymentName: string,
  prompt: string,
  maxTokens: number = 800
): Promise<string> {
  // Use the same implementation as callLLM since both use Responses API now
  return callLLM(deploymentName, prompt, maxTokens);
}
