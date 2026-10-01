// ---------- Settings ----------
const API_URL = "https://translate.googleapis.com/translate_a/single";
const MAX_CHUNK_BYTES = 450;      
const REQUEST_TIMEOUT_MS = 10000; 
const MAX_CHARS = 2000;           

const languages = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "ja", name: "Japanese" },
  { code: "ru", name: "Russian" },
  { code: "zh-CN", name: "Chinese (Simplified)" }
];

// ---------- Page elements ----------
const sourceSelect = document.getElementById("sourceLanguage");
const targetSelect = document.getElementById("targetLanguage");
const swapButton = document.getElementById("swapButton");
const inputText = document.getElementById("inputText");
const outputText = document.getElementById("outputText");
const charCount = document.getElementById("charCount");
const translateButton = document.getElementById("translateButton");
const copyButton = document.getElementById("copyButton");
const clearButton = document.getElementById("clearButton");
const statusMessage = document.getElementById("status");
const errorMessage = document.getElementById("errorMessage");

// Every translation gets a number. If the user clicks Clear while a request
// is running, the number changes and the old result is ignored.
let requestId = 0;
let statusTimer = null;

// ---------- Setup ----------
function fillLanguageDropdowns() {
  sourceSelect.add(new Option("Auto Detect", "Autodetect"));

  for (const language of languages) {
    sourceSelect.add(new Option(language.name, language.code));
    targetSelect.add(new Option(language.name, language.code));
  }

  sourceSelect.value = "en";
  targetSelect.value = "hi";
}

// ---------- Small UI helpers ----------
function updateCharCount() {
  charCount.textContent = inputText.value.length + " / " + MAX_CHARS + " characters";
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

function showStatus(message, hideAfterMs) {
  clearTimeout(statusTimer);
  statusMessage.textContent = message;
  if (hideAfterMs) {
    statusTimer = setTimeout(() => { statusMessage.textContent = ""; }, hideAfterMs);
  }
}

function setOutput(text) {
  outputText.textContent = text;
  copyButton.disabled = text === "";
}

// Disables the buttons while a request is running (prevents duplicate requests)
function setLoading(isLoading) {
  translateButton.disabled = isLoading;
  swapButton.disabled = isLoading;
  translateButton.textContent = isLoading ? "Translating..." : "Translate";
  showStatus(isLoading ? "Translating..." : "");
}

// ---------- Splitting long text ----------
function byteLength(text) {
  // Hindi, Arabic etc. use more than 1 byte per character, so count bytes
  return new TextEncoder().encode(text).length;
}

// Splits one line into pieces small enough for the API (sentence by sentence)
function splitIntoChunks(line) {
  const sentences = line.match(/[^.!?।؟]+[.!?।؟]*\s*/g) || [line];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (byteLength(current + sentence) <= MAX_CHUNK_BYTES) {
      current += sentence;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (byteLength(sentence) <= MAX_CHUNK_BYTES) {
      current = sentence;
      continue;
    }

    // A single sentence that is still too long: split it by words
    for (const word of sentence.split(" ")) {
      const next = current ? current + " " + word : word;
      if (byteLength(next) <= MAX_CHUNK_BYTES) {
        current = next;
      } else {
        chunks.push(current);
        current = word;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim() !== "");
}

// ---------- Talking to the API ----------
// Translates one small piece of text. Throws an Error with a friendly message.
async function translateChunk(chunk, source, target) {
  // This API uses "auto" for automatic language detection
  const sourceCode = source === "Autodetect" ? "auto" : source;

  const url = API_URL +
              "?client=gtx&dt=t" +
              "&sl=" + encodeURIComponent(sourceCode) +
              "&tl=" + encodeURIComponent(target) +
              "&q=" + encodeURIComponent(chunk);

  // AbortController lets us cancel the request if it takes too long
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("Could not reach the translation service. Check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new Error("Too many requests. Please wait a minute and try again.");
  }
  if (!response.ok) {
    throw new Error("The translation service returned an error (HTTP " + response.status + "). Please try again later.");
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("The translation service sent an unexpected response.");
  }

  // The response looks like: [ [ ["translated text", "original text", ...], ... ], ... ]
  // A long sentence can come back in several pieces, so join them together
  const pieces = data && data[0];
  if (!Array.isArray(pieces)) {
    throw new Error("The translation failed. The service returned an unexpected format.");
  }

  const translated = pieces.map((piece) => piece[0] || "").join("");
  if (translated.trim() === "") {
    throw new Error("The translation failed. Please try again.");
  }

  return translated;
}

// Translates the whole text, keeping the original line breaks
async function translateText(text, source, target, myRequestId) {
  const translatedLines = [];

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      translatedLines.push(""); // keep blank lines without calling the API
      continue;
    }

    const translatedParts = [];
    for (const chunk of splitIntoChunks(line)) {
      if (myRequestId !== requestId) return null; // user cleared the page, stop
      translatedParts.push(await translateChunk(chunk.trim(), source, target));
    }
    translatedLines.push(translatedParts.join(" "));
  }

  return translatedLines.join("\n");
}

// ---------- Button actions ----------
async function handleTranslate() {
  if (translateButton.disabled) return; // a request is already running

  const text = inputText.value.trim();
  const source = sourceSelect.value;
  const target = targetSelect.value;

  hideError();
  setOutput(""); // never leave an old translation on screen

  if (text === "") {
    showError("Please enter some text to translate.");
    inputText.focus();
    return;
  }

  if (source === target) {
    showError("Please choose two different languages.");
    return;
  }

  const myRequestId = ++requestId;
  setLoading(true);

  try {
    const result = await translateText(text, source, target, myRequestId);
    if (myRequestId !== requestId) return; // result is outdated, ignore it
    setOutput(result);
  } catch (error) {
    if (myRequestId !== requestId) return;
    showError(error.message); // output stays empty, so no fake success
  } finally {
    if (myRequestId === requestId) setLoading(false);
  }
}

function swapLanguages() {
  let newSource = targetSelect.value;
  let newTarget = sourceSelect.value;

  // "Auto Detect" can't be a target, so pick a sensible one
  if (newTarget === "Autodetect") {
    newTarget = newSource === "en" ? "hi" : "en";
  }

  sourceSelect.value = newSource;
  targetSelect.value = newTarget;

  // If there is a translation, move it into the input box for translating back
  const currentTranslation = outputText.textContent;
  if (currentTranslation) {
    inputText.value = currentTranslation;
    setOutput("");
    updateCharCount();
  }

  hideError();
}

async function copyTranslation() {
  const text = outputText.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    showStatus("Translation copied to clipboard.", 2500);
  } catch (error) {
    // Fallback for browsers that block the clipboard API (e.g. some file:// pages)
    const temp = document.createElement("textarea");
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(temp);

    if (copied) {
      showStatus("Translation copied to clipboard.", 2500);
    } else {
      showError("Could not copy automatically. Please select the text and copy it manually.");
    }
  }
}

function clearAll() {
  requestId++; // ignore any request that is still running
  setLoading(false);
  inputText.value = "";
  setOutput("");
  hideError();
  showStatus("");
  updateCharCount();
  inputText.focus();
}

// ---------- Connect everything ----------
fillLanguageDropdowns();
updateCharCount();

translateButton.addEventListener("click", handleTranslate);
swapButton.addEventListener("click", swapLanguages);
copyButton.addEventListener("click", copyTranslation);
clearButton.addEventListener("click", clearAll);
inputText.addEventListener("input", updateCharCount);

// Ctrl+Enter (Windows) or Cmd+Enter (Mac) translates
inputText.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    handleTranslate();
  }
});