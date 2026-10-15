
"use strict";

// Replace these with your real Supabase project details.
const SUPABASE_URL = "https://iopactkfsrnwrjcpbump.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvcGFjdGtmc3Jud3JqY3BidW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzk3MzIsImV4cCI6MjEwNzY1NTczMn0.b5R2nKWKDvciZu5qpaY53C9bA2TW6W6bsbia1ojuF64";

const $ = (selector) => document.querySelector(selector);

const configNotice = $("#configNotice");
const authPanel = $("#authPanel");
const dashPanel = $("#dashPanel");
const authMessage = $("#authMessage");
const keyMessage = $("#keyMessage");

let supabaseClient = null;
let mode = "login";
let currentSession = null;
let refreshInProgress = false;

function showMessage(element, message, type = "error") {
  if (!element) return;
  element.textContent = message;
  element.className = `notice ${type}`;
}

function hideMessage(element) {
  if (!element) return;
  element.textContent = "";
  element.classList.add("hidden");
}

function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || text;
    button.disabled = false;
  }
}

function setMode(nextMode) {
  mode = nextMode === "signup" ? "signup" : "login";

  $("#loginTab").classList.toggle("active", mode === "login");
  $("#signupTab").classList.toggle("active", mode === "signup");
  $("#authSubmit").textContent =
    mode === "login" ? "Sign in →" : "Create account →";

  $("#password").autocomplete =
    mode === "login" ? "current-password" : "new-password";

  hideMessage(authMessage);
}

function setLoggedIn(session) {
  currentSession = session || null;

  const loggedIn = Boolean(currentSession);

  authPanel.classList.toggle("hidden", loggedIn);
  dashPanel.classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    $("#userEmail").textContent =
      currentSession.user?.email || "Signed in";
    hideMessage(authMessage);
    loadKeys();
  } else {
    $("#userEmail").textContent = "";
    $("#keysList").textContent = "Sign in to load your keys.";
    hideMessage(keyMessage);
  }
}

async function getAccessToken() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured.");
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;

  currentSession = data.session;

  if (!currentSession?.access_token) {
    throw new Error("Please sign in again.");
  }

  return currentSession.access_token;
}

async function apiRequest(path, options = {}) {
  const token = await getAccessToken();

  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { detail: raw || "Unexpected server response." };
  }

  if (!response.ok) {
    throw new Error(
      data.detail || data.message || `Request failed (${response.status})`
    );
  }

  return data;
}

function extractKeys(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.keys)) return data.keys;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function renderKeys(data) {
  const container = $("#keysList");
  container.replaceChildren();

  const keys = extractKeys(data);

  if (!keys.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No API keys found yet. Create your first key above.";
    container.appendChild(empty);
    return;
  }

  keys.forEach((key) => {
    const item = document.createElement("div");
    item.className = "key-item";

    const title = document.createElement("strong");
    title.textContent = key.name || key.label || "API key";

    const id = document.createElement("p");
    id.className = "muted";
    id.textContent = `ID: ${key.id ?? key.key_id ?? "Not provided"}`;

    item.append(title, id);

    // Only show a key if the API actually returns it.
    // Many services reveal the full secret only once, at creation.
    const secret = key.key || key.api_key || key.token;

    if (secret) {
      const value = document.createElement("p");
      value.className = "key-value";
      value.textContent = secret;
      item.appendChild(value);

      const copy = document.createElement("button");
      copy.className = "secondary";
      copy.type = "button";
      copy.textContent = "Copy key";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(secret);
          copy.textContent = "Copied!";
        } catch {
          showMessage(keyMessage, "Could not copy automatically.", "error");
        }
      });
      item.appendChild(copy);
    }

    const keyId = key.id ?? key.key_id;

    if (keyId !== undefined && keyId !== null) {
      const revoke = document.createElement("button");
      revoke.className = "secondary danger";
      revoke.type = "button";
      revoke.textContent = "Revoke";
      revoke.style.marginLeft = "8px";

      revoke.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to revoke this API key?")) return;

        revoke.disabled = true;

        try {
          await apiRequest(
            `/api/keys/${encodeURIComponent(keyId)}`,
            { method: "DELETE" }
          );
          showMessage(keyMessage, "API key revoked.", "success");
          await loadKeys();
        } catch (error) {
          showMessage(keyMessage, error.message);
          revoke.disabled = false;
        }
      });

      item.appendChild(revoke);
    }

    container.appendChild(item);
  });
}

async function loadKeys() {
  if (!currentSession || refreshInProgress) return;

  refreshInProgress = true;
  $("#keysList").textContent = "Loading API keys...";

  try {
    const data = await apiRequest("/api/keys");
    renderKeys(data);
  } catch (error) {
    $("#keysList").textContent = "";
    showMessage(keyMessage, error.message);
  } finally {
    refreshInProgress = false;
  }
}

async function handleAuth(event) {
  event.preventDefault();
  hideMessage(authMessage);

  if (!supabaseClient) {
    showMessage(authMessage, "Supabase is not configured.");
    return;
  }

  const email = $("#email").value.trim();
  const password = $("#password").value;
  const button = $("#authSubmit");

  setBusy(button, true, "Please wait...");

  try {
    let result;

    if (mode === "signup") {
      result = await supabaseClient.auth.signUp({ email, password });

      if (result.error) throw result.error;

      if (!result.data.session) {
        showMessage(
          authMessage,
          "Account created. Check your email to confirm your account before signing in.",
          "success"
        );
        return;
      }
    } else {
      result = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (result.error) throw result.error;
    }

    setLoggedIn(result.data.session);
  } catch (error) {
    showMessage(authMessage, error.message || "Authentication failed.");
  } finally {
    setBusy(button, false, "Sign in →");
    $("#authSubmit").textContent =
      mode === "login" ? "Sign in →" : "Create account →";
  }
}

async function handleCreateKey(event) {
  event.preventDefault();
  hideMessage(keyMessage);

  const name = $("#keyName").value.trim();
  if (!name) {
    showMessage(keyMessage, "Enter a name for your API key.");
    return;
  }

  const button = $("#createKeyBtn");
  setBusy(button, true, "Creating key...");

  try {
    const result = await apiRequest("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name })
    });

    showMessage(
      keyMessage,
      result.key || result.api_key || result.token
        ? "API key created. Copy and save it securely."
        : "Request completed. Check the key list below.",
      "success"
    );

    // Display the response when it contains a newly created secret.
    const secret = result.key || result.api_key || result.token;

    if (secret) {
      const secretBox = document.createElement("div");
      secretBox.className = "key-item";

      const label = document.createElement("strong");
      label.textContent = "New API key — save it now";

      const value = document.createElement("p");
      value.className = "key-value";
      value.textContent = secret;

      const copy = document.createElement("button");
      copy.className = "secondary";
      copy.type = "button";
      copy.textContent = "Copy key";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(secret);
          copy.textContent = "Copied!";
        } catch {
          showMessage(keyMessage, "Copy failed. Select and copy the key manually.");
        }
      });

      secretBox.append(label, value, copy);
      $("#keysList").prepend(secretBox);
    }

    $("#keyName").value = "";
    await loadKeys();
  } catch (error) {
    showMessage(keyMessage, error.message || "Could not create API key.");
  } finally {
    setBusy(button, false, "+ Create API key");
  }
}

async function logout() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    showMessage(authMessage, error.message);
    return;
  }

  setLoggedIn(null);
  setMode("login");
}

async function init() {
  const placeholder =
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes("PASTE_YOUR") ||
    SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

  const validUrl =
    /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL);

  if (
    !validUrl ||
    placeholder ||
    SUPABASE_ANON_KEY.length < 20 ||
    !window.supabase?.createClient
  ) {
    configNotice.classList.remove("hidden");
    showMessage(
      authMessage,
      !window.supabase?.createClient
        ? "Supabase JS library did not load. Check your internet connection and script tag."
        : "Supabase is not configured. Check the Project URL and public key."
    );
    return;
  }

  configNotice.classList.add("hidden");

  try {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

    $("#loginTab").addEventListener("click", () => setMode("login"));
    $("#signupTab").addEventListener("click", () => setMode("signup"));
    $("#authForm").addEventListener("submit", handleAuth);
    $("#keyForm").addEventListener("submit", handleCreateKey);
    $("#logoutBtn").addEventListener("click", logout);
    $("#refreshBtn").addEventListener("click", loadKeys);

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;

    setLoggedIn(data.session);

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      currentSession = session || null;
      setLoggedIn(currentSession);
    });
  } catch (error) {
    showMessage(authMessage, error.message || "Could not initialize Supabase.");
  }
}

document.addEventListener("DOMContentLoaded", init);
