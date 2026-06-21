import curl2Json from "@bany/curl-to-json";

export interface CurlValidationResult {
  isValid: boolean;
  message?: string;
}

export const validateCurl = (
  curl: string,
  requiredVariables: string[]
): CurlValidationResult => {
  if (!curl.trim().startsWith("curl")) {
    return {
      isValid: false,
      message: "The command must start with 'curl'.",
    };
  }

  let parsed: { url?: string };
  try {
    parsed = curl2Json(curl);
  } catch (error) {
    return {
      isValid: false,
      message:
        "Invalid cURL command syntax. Please check for typos or try validating it on an online tool like reqbin.com/curl-online.",
    };
  }

  // Only allow http(s) endpoints. Blocks javascript:, file:, data:, etc.,
  // which could otherwise be smuggled in via a custom provider cURL and
  // executed/read as a request target.
  const url = (parsed?.url ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return {
      isValid: false,
      message:
        "The request URL must use http:// or https://. Other schemes are not allowed.",
    };
  }

  const missingVariables = requiredVariables.filter(
    (variable) => !curl.includes(`{{${variable}}}`)
  );

  if (missingVariables.length > 0) {
    const missingVarsString = missingVariables
      .map((v) => `{{${v}}}`)
      .join(", ");
    return {
      isValid: false,
      message: `The following required variables are missing: ${missingVarsString}.`,
    };
  }

  return { isValid: true };
};
