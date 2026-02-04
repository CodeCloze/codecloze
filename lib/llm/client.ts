/**
 * Azure AI Foundry / OpenAI Client Configuration
 * 
 * Uses REST API directly instead of SDK to avoid TypeScript type issues
 * 
 * Uses environment variables for configuration:
 * - AZURE_OPENAI_ENDPOINT: The Azure OpenAI endpoint URL (e.g., https://your-resource.openai.azure.com)
 * - AZURE_OPENAI_API_KEY: The API key for authentication
 */

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

  // Use REST API directly: https://{resource}.openai.azure.com/openai/v1/responses
  const responsesURL = `${cleanEndpoint}/openai/v1/responses`;

  console.log("Calling Azure OpenAI Responses API (REST)", {
    deploymentName,
    url: responsesURL,
    hasApiKey: !!apiKey,
  });

  try {
    const response = await fetch(responsesURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey, // Use api-key header for Azure OpenAI
      },
      body: JSON.stringify({
        model: deploymentName, // Deployment name
        input: prompt, // Use input parameter for Responses API
        max_output_tokens: maxTokens // Use max_completion_tokens for Azure AI Foundry models
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Azure OpenAI API error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(`Azure OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Extract the completion text from responses API format
    // According to docs, the response has an `output_text` field
    if (data.output_text) {
      return data.output_text.trim();
    }

    // Fallback: check output array structure
    if (data.output && Array.isArray(data.output) && data.output.length > 0) {
      const firstOutput = data.output[0];
      if (firstOutput.content && Array.isArray(firstOutput.content)) {
        const textContent = firstOutput.content.find((c: any) => c.type === "output_text");
        if (textContent && textContent.text) {
          return textContent.text.trim();
        }
      }
    }

    throw new Error("No completion text returned from Responses API");
  } catch (err: any) {
    // Enhanced error logging for Azure OpenAI issues
    if (err?.status === 404 || err.message?.includes("404")) {
      console.error("Azure OpenAI deployment not found", {
        deploymentName,
        endpoint: cleanEndpoint,
        fullURL: responsesURL,
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
