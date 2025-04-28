// popup.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("[Popup] DOM content loaded, initializing popup UI");

  // --- Get DOM Elements ---
  const apiKeyInput = document.getElementById("apiKey");
  const saveKeyBtn = document.getElementById("saveKeyBtn");
  const keyStatusDiv = document.getElementById("keyStatus");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const resultsDiv = document.getElementById("results");
  const downloadBtn = document.getElementById("downloadBtn"); // Download button

  // Basic check that all elements exist
  if (
    !apiKeyInput ||
    !saveKeyBtn ||
    !keyStatusDiv ||
    !analyzeBtn ||
    !resultsDiv ||
    !downloadBtn
  ) {
    resultsDiv.textContent = "Initialization Error: HTML elements missing.";
    resultsDiv.className = "error-status";
    // Disable buttons if elements are missing
    if (saveKeyBtn) saveKeyBtn.disabled = true;
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }
  console.log("[Popup] All required DOM elements retrieved.");

  // --- Variable to store the latest report data ---
  let currentReportData = null;

  // --- Function to Update Key Status and Analyze Button State ---
  const updateKeyStatus = () => {
    console.log("[Popup:updateKeyStatus] Checking API key status...");
    keyStatusDiv.textContent = "Checking token status...";
    keyStatusDiv.className = ""; // Reset classes

    try {
      chrome.storage.local.get(["codyApiKey"], (result) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[Popup:updateKeyStatus] Storage GET Error:",
            chrome.runtime.lastError
          );
          keyStatusDiv.textContent = "Error checking token status.";
          keyStatusDiv.className = "error-status";
          analyzeBtn.disabled = true;
          return;
        }

        if (result && result.codyApiKey) {
          console.log("[Popup:updateKeyStatus] API Token FOUND.");
          keyStatusDiv.textContent = "API Token is set.";
          keyStatusDiv.className = "success-status";
          apiKeyInput.placeholder = "Token set (leave blank to keep)";
          apiKeyInput.value = ""; // Don't show stored key
          analyzeBtn.disabled = false; // Enable analyze button
          // Don't reset resultsDiv here, it might show a report
        } else {
          console.log("[Popup:updateKeyStatus] API Token NOT FOUND.");
          keyStatusDiv.textContent =
            "API Token not set. Please enter and save.";
          keyStatusDiv.className = "error-status";
          apiKeyInput.placeholder = "Enter your token";
          analyzeBtn.disabled = true; // Disable analyze button
          resultsDiv.textContent =
            "Set your API Token above, then click Analyze."; // Reset results message
        }
      });
    } catch (error) {
      console.error("[Popup:updateKeyStatus] Unexpected error:", error);
      keyStatusDiv.textContent = "Unexpected error checking status.";
      keyStatusDiv.className = "error-status";
      analyzeBtn.disabled = true;
    }
  };

  // --- Event Listener for Save Button ---
  saveKeyBtn.addEventListener("click", () => {
    console.log("[Popup:saveKey] 'Save Token' button clicked.");
    const apiKey = apiKeyInput.value.trim();

    if (apiKey) {
      console.log("[Popup:saveKey] Attempting to save non-empty key...");
      keyStatusDiv.textContent = "Saving token...";
      keyStatusDiv.className = ""; // Clear status style

      try {
        chrome.storage.local.set({ codyApiKey: apiKey }, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "[Popup:saveKey] Storage SET Error:",
              chrome.runtime.lastError
            );
            keyStatusDiv.textContent = "Error saving token.";
            keyStatusDiv.className = "error-status";
            analyzeBtn.disabled = true;
          } else {
            console.log("[Popup:saveKey] API Key saved successfully.");
            keyStatusDiv.textContent = "API Token saved successfully!";
            keyStatusDiv.className = "success-status";
            // Call updateKeyStatus AFTER successful save to refresh UI state
            updateKeyStatus();
          }
        });
      } catch (error) {
        console.error("[Popup:saveKey] Unexpected error during save:", error);
        keyStatusDiv.textContent = "Unexpected error saving token.";
        keyStatusDiv.className = "error-status";
        analyzeBtn.disabled = true;
      }
    } else {
      console.warn("[Popup:saveKey] Save attempt with empty input.");
      keyStatusDiv.textContent = "Please enter a token value to save.";
      keyStatusDiv.className = "error-status";
    }
  });

  // --- Function to handle downloading the report ---
  const downloadReport = () => {
    if (!currentReportData) {
      console.error(
        "[Popup:download] Download clicked, but no report data available."
      );
      alert("No report data is available to download.");
      return;
    }
    console.log("[Popup:download] Preparing report for download.");

    let dataToSave = currentReportData;
    let fileExtension = ".txt";
    let mimeType = "text/plain";

    // Try to format as pretty JSON
    try {
      console.log(
        "[Popup:download] Attempting to format report data as JSON..."
      );
      let potentialJson = null;
      if (typeof dataToSave === "object") {
        // If background already parsed it
        potentialJson = dataToSave;
      } else if (typeof dataToSave === "string") {
        const trimmedData = dataToSave.trim();
        if (trimmedData.startsWith("[") || trimmedData.startsWith("{")) {
          potentialJson = JSON.parse(trimmedData);
        }
      }

      if (potentialJson !== null) {
        dataToSave = JSON.stringify(potentialJson, null, 2); // Pretty print
        fileExtension = ".json";
        mimeType = "application/json";
        console.log("[Popup:download] Successfully formatted as pretty JSON.");
      } else {
        console.log(
          "[Popup:download] Data not detected as JSON, saving as raw text."
        );
        // Ensure dataToSave is a string if it wasn't already
        if (typeof dataToSave !== "string") {
          dataToSave = String(dataToSave);
        }
      }
    } catch (e) {
      console.warn(
        "[Popup:download] Could not parse/format as JSON, saving raw data.",
        e
      );
      // Ensure dataToSave is a string if it wasn't already
      if (typeof dataToSave !== "string") {
        dataToSave = String(currentReportData); // Fallback to original string representation
      }
    }

    const blob = new Blob([dataToSave], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = `accessibility-report-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, "-")}${fileExtension}`;

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`[Popup:download] Download triggered for ${filename}.`);
  };

  // --- Event Listener for Analyze Button ---
  analyzeBtn.addEventListener("click", async () => {
    if (analyzeBtn.disabled) {
      console.warn(
        "[Popup:analyze] Analyze button clicked while disabled. Ignoring."
      );
      return;
    }
    console.log("[Popup:analyze] 'Analyze' button clicked.");
    resultsDiv.textContent = "Getting active tab info...";
    resultsDiv.className = ""; // Clear previous status styles
    analyzeBtn.disabled = true;
    downloadBtn.disabled = true; // Disable download button during process
    downloadBtn.style.display = "none"; // Hide download button
    currentReportData = null; // Clear previous report data

    let targetTabId = null;
    let errorOccurred = false;

    try {
      // Get active tab ID
      console.log("[Popup:analyze] Querying for active tab...");
      const queryResult = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      console.log("[Popup:analyze] Tab query result:", queryResult);

      if (
        queryResult &&
        queryResult.length > 0 &&
        queryResult[0] &&
        queryResult[0].id
      ) {
        const currentTab = queryResult[0];
        targetTabId = currentTab.id;
        console.log(
          `[Popup:analyze] Found active tab ID: ${targetTabId}, URL: ${currentTab.url}`
        );

        // Validate URL
        if (
          !currentTab.url ||
          (!currentTab.url.startsWith("http:") &&
            !currentTab.url.startsWith("https:"))
        ) {
          console.error(
            `[Popup:analyze] Invalid URL for analysis: ${currentTab.url}`
          );
          throw new Error(
            "Cannot analyze non-web pages (e.g., chrome://, file://)."
          );
        }
        console.log("[Popup:analyze] Tab URL is valid.");
      } else {
        console.error(
          "[Popup:analyze] Could not find active tab with ID.",
          queryResult
        );
        throw new Error("Could not identify the active web page tab.");
      }

      // Send message to background script if tab ID found
      if (targetTabId) {
        resultsDiv.textContent =
          "Requesting analysis from background... Please wait.";
        console.log(
          `[Popup:analyze] Sending 'analyzePage' message for tabId: ${targetTabId}`
        );
        chrome.runtime.sendMessage(
          {
            action: "analyzePage",
            tabId: targetTabId,
          },
          (response) => {
            console.log(
              "[Popup:analyze] Received response callback from background."
            );

            // Always re-enable analyze button after attempt (unless fatal error)
            analyzeBtn.disabled = false;

            if (chrome.runtime.lastError) {
              console.error(
                "[Popup:analyze] Communication error:",
                chrome.runtime.lastError
              );
              resultsDiv.textContent = `Error communicating with background: ${chrome.runtime.lastError.message}`;
              resultsDiv.className = "error-status";
              // Keep download disabled/hidden
            } else if (response) {
              if (response.report) {
                console.log("[Popup:analyze] Report received successfully.");
                currentReportData = response.report; // Store the received data

                // Display a preview or summary
                const reportPreview =
                  (typeof currentReportData === "string"
                    ? currentReportData
                    : JSON.stringify(currentReportData)) || "";
                resultsDiv.textContent = "Report ready for download.";
                resultsDiv.className = ""; // Clear error style

                downloadBtn.disabled = false; // Enable download button
                downloadBtn.style.display = "inline-block"; // Show download button
                console.log("[Popup:analyze] Download button enabled.");
              } else if (response.error) {
                console.warn(
                  "[Popup:analyze] Analysis error received from background:",
                  response.error
                );
                resultsDiv.textContent = `Analysis Error: ${response.error}`;
                resultsDiv.className = "error-status";
                // Keep download disabled/hidden
              } else {
                console.warn(
                  "[Popup:analyze] Received unexpected response structure:",
                  response
                );
                resultsDiv.textContent =
                  "Received unexpected response from background script.";
                resultsDiv.className = "error-status";
              }
            } else {
              console.error(
                "[Popup:analyze] No response object received from background."
              );
              resultsDiv.textContent =
                "No response received from background script.";
              resultsDiv.className = "error-status";
            }
          } // End callback function
        ); // End sendMessage
      } else {
        // Should have been caught earlier, but safety net
        throw new Error("Internal logic error: targetTabId not set.");
      }
    } catch (error) {
      // Catch errors from tab query or URL validation
      errorOccurred = true;
      console.error("[Popup:analyze] Error during pre-send checks:", error);
      resultsDiv.textContent = `Error: ${error.message}`;
      resultsDiv.className = "error-status";
    } finally {
      // Ensure analyze button is re-enabled if an error occurred before sending
      if (errorOccurred) {
        analyzeBtn.disabled = false;
        downloadBtn.disabled = true; // Keep download disabled
        downloadBtn.style.display = "none"; // Keep download hidden
        console.log(
          "[Popup:analyze] Re-enabled analyze button after pre-send error."
        );
      }
    }
  }); // End analyzeBtn listener

  // --- Event Listener for Download Button ---
  downloadBtn.addEventListener("click", downloadReport);

  // --- Initial Setup: Check API Key Status ---
  console.log("[Popup] Running initial API key status check on load.");
  updateKeyStatus();
}); // End DOMContentLoaded
