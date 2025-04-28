// background.js
const CODY_API_ENDPOINT =
  "https://laxtst-insg-001.office.cyberu.com/.api/llm/chat/completions"; // Replace!

// --- Core Logic ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzePage") {
    // *** KEY CHANGE: Get tabId from request payload ***
    const targetTabId = request.tabId;

    if (!targetTabId) {
      sendResponse({
        error:
          "Analysis Failed: Target Tab ID was not provided in the message.",
      });
      return false; // Indicate sync response or no response needed
    }

    // We still need the tab's URL for validation. Get it using the ID.
    chrome.tabs.get(targetTabId, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          error: `Analysis Failed: Could not get details for tab ID ${targetTabId}. ${chrome.runtime.lastError.message}`,
        });
        return; // Exit callback
      }

      if (!tab) {
        sendResponse({
          error: `Analysis Failed: No tab found matching ID ${targetTabId}.`,
        });
        return; // Exit callback
      }

      // Proceed with analysis, passing the retrieved tab object or just ID/URL
      getPageContentAndAnalyze(tab) // Pass the full tab object now
        .then((report) => {
          sendResponse({ report: report });
        })
        .catch((error) => {
          sendResponse({ error: `Analysis Failed: ${error.message}` });
        });
    }); // End chrome.tabs.get callback

    return true; // Indicates asynchronous response (because of chrome.tabs.get)
  }
  // Handle other actions if needed
  return false;
});

// --- Main Analysis Orchestration (Now accepts targetTab) ---
async function getPageContentAndAnalyze(targetTab) {
  console.log(
    "[getPageContentAndAnalyze] Starting analysis with tab:",
    targetTab
  );
  // Accepts full tab object
  if (!targetTab || !targetTab.id || !targetTab.url) {
    console.error("[getPageContentAndAnalyze] Invalid tab object:", targetTab);
    throw new Error("Invalid targetTab object received.");
  }
  try {
    console.log(
      `[getPageContentAndAnalyze] Fetching HTML content for tab ID: ${targetTab.id}, URL: ${targetTab.url}`
    );
    const htmlContent = await getCurrentPageHTML(targetTab.id, targetTab.url); // Pass ID and URL
    console.log(
      `[getPageContentAndAnalyze] HTML content retrieved, length: ${htmlContent.length} characters`
    );

    console.log("[getPageContentAndAnalyze] Creating accessibility prompt");
    const prompt = createAccessibilityPrompt(htmlContent);

    console.log("[getPageContentAndAnalyze] Calling Cody API for analysis");
    const report = await callCodyApi(prompt);
    console.log("[getPageContentAndAnalyze] Received analysis report:", report);

    // Download the report as a JSON file
    console.log("[getPageContentAndAnalyze] Preparing report download");
    return report;
  } catch (error) {
    console.error("[getPageContentAndAnalyze] Error during analysis:", error);
    throw error;
  }
}

// --- Helper Function: Get API Key from Storage (No changes needed) ---
async function getStoredApiKey() {
  try {
    const result = await chrome.storage.local.get(["codyApiKey"]);
    if (chrome.runtime.lastError) {
      throw new Error(`Storage Error: ${chrome.runtime.lastError.message}`);
    }
    if (result.codyApiKey) {
      return result.codyApiKey;
    } else {
      return null;
    }
  } catch (e) {
    throw new Error("Could not retrieve API key from storage.");
  }
}

// --- Helper Function: Call Cody API (No changes needed) ---
async function callCodyApi(promptText) {
  const token = await getStoredApiKey();
  if (!token) {
    throw new Error(
      "Cody API Access Token is not configured. Please set it in the extension popup."
    );
  }
  const requestBody = JSON.stringify({
    /* ... your Cody request body ... */
    model: "google::v1::gemini-2.0-flash", //"anthropic::2024-10-22::claude-3-7-sonnet-latest",
    messages: [{ role: "user", content: promptText }],
    temperature: 0.7,
    max_tokens: 8192,
  });

  try {
    let clientName = "chrome-ext-accessibility-checker";
    let clientVersion = "0.1.0";
    const response = await fetch(CODY_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${token}`,
        "X-Sourcegraph-Should-Trace": "true",
        "X-Requested-With": `${clientName} ${clientVersion}`,
      },
      body: requestBody,
    });
    const responseText = await response.json();
    if (!response.ok) {
      let errorBodyText = `API Error: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        errorBodyText += ` - ${errorBody}`;
      } catch (e) {
        /* ignore */
      }
      if (response.status === 401 || response.status === 403)
        errorBodyText += " (Check Token)";
      throw new Error(errorBodyText);
    }

    return responseText.choices[0].message.content;
  } catch (error) {
    throw error;
  }
}
function extractContentFromCodyResponse(jsonString) {
  if (!jsonString || typeof jsonString !== "string") {
    return null;
  }
  try {
    const responseObject = JSON.parse(jsonString);
    // Adjust the path based on the ACTUAL structure seen in the raw log
    const content = responseObject?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}
// --- Helper Function: Get Page HTML (MODIFIED - No longer queries tabs) ---
async function getCurrentPageHTML(tabId, tabUrl) {
  // Check URL validity
  if (
    !tabUrl ||
    (!tabUrl.startsWith("http:") && !tabUrl.startsWith("https:"))
  ) {
    throw new Error("Cannot analyze non-web pages (e.g., chrome://, file://).");
  }

  try {
    // *** Define the function to be executed INSIDE the target page ***
    const scriptToExecute = () => {
      // This code runs within the web page's context where DOMParser IS available
      const targetDivId = "ctl00_masterPageBody";
      const targetDiv = document.getElementById(targetDivId);

      if (targetDiv) {
        // Found the specific div, return its outerHTML
        return targetDiv.outerHTML;
      } else {
        // Target div not found, return the entire document's outerHTML
        return document.documentElement.outerHTML;
      }
    };

    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: scriptToExecute, // Execute the function defined above
    });

    // Process the result returned from the page script
    if (results && results[0] && results[0].result) {
      const resultingHtml = results[0].result; // This is either the div's HTML or the full page HTML
      // No need for DOMParser here anymore!
      return resultingHtml;
    } else {
      throw new Error("Could not retrieve page HTML via script injection.");
    }
  } catch (error) {
    // Check for specific injection errors
    if (error.message.includes("Cannot access contents of url")) {
      throw new Error(
        `Cannot access contents of the page at ${tabUrl}. It might be restricted.`
      );
    }
    if (error.message.includes("No target specified")) {
      throw new Error(
        `Scripting error: No target specified (tabId: ${tabId}).`
      );
    }
    throw error; // Re-throw other errors
  }
}

// --- Helper Function: Create Prompt (No changes needed) ---
function createAccessibilityPrompt(pageHtml) {
  return `
    You are an accessibility expert tasked with analyzing the following HTML document for **all** accessibility issues.
  
    Focus specifically on:
      1. **Screen Reader Compatibility** (e.g., missing alt text, incorrect ARIA attributes, unlabeled form elements, non-semantic HTML elements),
      2. **Keyboard Navigation** (e.g., non-focusable elements, missing skip links, improper tab order, lack of visible focus indicators),
      3. **WCAG 2.0 & 2.1 Compliance** (e.g., insufficient color contrast, improper use of headings, missing error messages, text resizing issues),
      4. **General Accessibility Best Practices** (e.g., language attributes, semantic structure, accessibility of multimedia content, ARIA roles and attributes),
      5. **ARIA Best Practices** (e.g., incorrect or missing ARIA attributes, incorrect role usage).
      6. **No redundant issues** Combine all similar issues into a single issue.
  
    Analyze the document for **all existing accessibility issues** related to these areas. Identify **all problems** and their corresponding WCAG rule(s), ARIA issues, or other best practices.

    **EXAMPLE of the required output is direct json no prefix output should be directly able to parse:**
        [
            {
                "Rule/Guideline":"WCAG 2.1 1.1.1",
                "Why":"Image is missing the alt attribute.",
                "How to fix":"Add an alt attribute describing the image content or function, e.g., <img src='...' alt='Description'>."
            },
            {
                "Rule/Guideline":"WCAG 2.1 2.4.4",
                "Why":"Link text 'Details' is ambiguous without surrounding context.",
                "How to fix":"Provide more descriptive link text or use aria-label to provide context, e.g., <a href='...' aria-label='View Details for Product X'>Details</a>."
            }
        ]
        The response should contain only raw **JSON data**. Please **do not include any markdown or other formatting**—just the pure JSON array, no text or markdown.
  
      HTML document:
      ${pageHtml}
    `;
}
