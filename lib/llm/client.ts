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

  const requestBody = {
    model: deploymentName, // Deployment name
    input: prompt, // Use input parameter for Responses API
    max_output_tokens: maxTokens, // Use max_completion_tokens for Azure AI Foundry models
  };

  console.log("=== Azure OpenAI Responses API Request ===", {
    deploymentName,
    url: responsesURL,
    endpoint: cleanEndpoint,
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    requestBody: {
      ...requestBody,
      input: requestBody.input.substring(0, 200) + (requestBody.input.length > 200 ? "..." : ""), // Log first 200 chars of input
      inputLength: requestBody.input.length,
    },
    maxTokens,
  });

  try {
    const response = await fetch(responsesURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey, // Use api-key header for Azure OpenAI
      },
      body: JSON.stringify(requestBody),
    });

    console.log("=== Azure OpenAI API Response Status ===", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      console.error("=== Azure OpenAI API Error Response ===", {
        status: response.status,
        statusText: response.statusText,
        responseText,
        deploymentName,
        endpoint: cleanEndpoint,
        fullURL: responsesURL,
      });
      throw new Error(`Azure OpenAI API error: ${response.status} ${responseText}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      console.error("=== Failed to parse JSON response ===", {
        responseText,
        parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      throw new Error(`Failed to parse JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }

    console.log("=== Azure OpenAI API Success Response ===", {
      id: data.id,
      model: data.model,
      status: data.status,
      error: data.error,
      incomplete_details: data.incomplete_details,
      output_text: data.output_text?.substring(0, 200) + (data.output_text?.length > 200 ? "..." : ""), // Log first 200 chars
      output_text_length: data.output_text?.length,
      output_array_length: data.output?.length,
      usage: data.usage,
      temperature: data.temperature,
      max_output_tokens: data.max_output_tokens,
      hasOutput: !!data.output,
      outputStructure: data.output ? {
        length: data.output.length,
        firstItemType: data.output[0]?.type,
        firstItemRole: data.output[0]?.role,
        firstItemContentLength: data.output[0]?.content?.length,
      } : null,
    });

    // Extract the completion text from responses API format
    // According to docs, the response has an `output_text` field
    if (data.output_text) {
      console.log("=== Extracted output_text ===", {
        length: data.output_text.length,
        preview: data.output_text.substring(0, 100),
      });
      return data.output_text.trim();
    }

    // Fallback: check output array structure
    if (data.output && Array.isArray(data.output) && data.output.length > 0) {
      console.log("=== Attempting to extract from output array ===", {
        outputLength: data.output.length,
        firstOutput: JSON.stringify(data.output[0], null, 2).substring(0, 500),
      });
      
      const firstOutput = data.output[0];
      if (firstOutput.content && Array.isArray(firstOutput.content)) {
        const textContent = firstOutput.content.find((c: any) => c.type === "output_text");
        if (textContent && textContent.text) {
          console.log("=== Extracted text from output array ===", {
            length: textContent.text.length,
            preview: textContent.text.substring(0, 100),
          });
          return textContent.text.trim();
        }
      }
    }

    console.error("=== No completion text found in response ===", {
      responseKeys: Object.keys(data),
      fullResponse: JSON.stringify(data, null, 2).substring(0, 2000), // Log first 2000 chars of full response
    });
    throw new Error("No completion text returned from Responses API");
  } catch (err: any) {
    console.error("=== Azure OpenAI API Exception ===", {
      errorType: err?.constructor?.name,
      errorMessage: err?.message,
      errorStack: err?.stack,
      status: err?.status,
      code: err?.code,
      deploymentName,
      endpoint: cleanEndpoint,
      fullURL: responsesURL,
    });

    // Enhanced error logging for Azure OpenAI issues
    if (err?.status === 404 || err.message?.includes("404")) {
      console.error("=== 404 Error Details ===", {
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
