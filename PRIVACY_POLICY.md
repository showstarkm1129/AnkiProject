# Privacy Policy — Anki Card Creator

_Last updated: 2025-02-27_

## Overview

Anki Card Creator is a Chrome extension that helps you create Anki flashcards by capturing regions of web pages and optionally generating AI-powered explanations. This policy explains what data is handled and how.

---

## Data We Collect

**This extension does not collect, store, or transmit any personal data to its developers.**

### Data stored locally on your device

The following data is stored in Chrome's local storage (`chrome.storage.local`) and **never leaves your device** except as described below:

| Data | Purpose | Where it goes |
|---|---|---|
| API keys (Gemini, OpenAI, Anthropic, OpenRouter) | Authenticate requests to AI providers | Sent only to the respective AI provider's API endpoint |
| Selected AI provider and model name | Restore settings between sessions | Stays on device |
| Custom instruction text | Personalize AI explanations | Sent to the AI provider as part of the prompt |
| Last selected Anki deck and note type | Restore selections between sessions | Stays on device |
| Deck tree open/close state | Restore UI state | Stays on device |

### Data processed during use (not persisted)

- **Captured screenshots**: Page region images captured during card creation are held in memory and sent to AnkiConnect (running locally on `localhost:8765`) to be saved as Anki card media. They are never sent to any external server by this extension.
- **AI explanation requests**: When you use the AI explanation feature, the captured image and your custom instruction are sent **directly from your browser** to the AI provider you selected. This extension's developers have no access to this data.

---

## External Services

When you use the AI explanation feature, data is sent to one of the following services depending on your selection. Please review their respective privacy policies:

- **Google Gemini**: [https://policies.google.com/privacy](https://policies.google.com/privacy)
- **OpenAI**: [https://openai.com/policies/privacy-policy](https://openai.com/policies/privacy-policy)
- **Anthropic**: [https://www.anthropic.com/privacy](https://www.anthropic.com/privacy)
- **OpenRouter**: [https://openrouter.ai/privacy](https://openrouter.ai/privacy)

AnkiConnect runs entirely on your local machine (`localhost:8765`) and no data is sent externally via this connection.

---

## Permissions Explanation

| Permission | Reason |
|---|---|
| `activeTab` | Capture the visible area of the current tab when you click the extension icon |
| `scripting` | Inject the region-selection UI into the current page |
| `storage` | Save your API keys and settings locally on your device |
| `tabs` | Identify the current tab to send the selection UI to the correct page |
| `http://localhost:8765/*` | Communicate with AnkiConnect running on your local machine |
| `https://generativelanguage.googleapis.com/*` | Send AI requests to Google Gemini (only when selected) |
| `https://api.openai.com/*` | Send AI requests to OpenAI (only when selected) |
| `https://api.anthropic.com/*` | Send AI requests to Anthropic (only when selected) |
| `https://openrouter.ai/*` | Send AI requests to OpenRouter (only when selected) |

---

## Data Security

- Your API keys are stored in `chrome.storage.local`, which is sandboxed to this extension and inaccessible to other extensions or websites.
- No data is sent to any server operated by the extension's developers.
- All communication with AI providers is made directly from your browser over HTTPS.

---

## Changes to This Policy

If this policy is updated, the _Last updated_ date at the top of this document will be revised. Significant changes will be noted in the repository's release notes.

---

## Contact

If you have questions about this privacy policy, please open an issue on the GitHub repository:
[https://github.com/showstarkm1129/AnkiProject](https://github.com/showstarkm1129/AnkiProject)
