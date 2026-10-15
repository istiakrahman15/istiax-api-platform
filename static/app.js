
/*
 * ISTIAX API Platform
 * Supabase authentication + API key dashboard
 *
 * IMPORTANT:
 * Use only your Supabase Project URL and public
 * anon/publishable key here.
 * NEVER put the service_role or secret key here.
 */

const SUPABASE_URL = "https://iopactkfsrnwrjcpbump.supabase.co";
const SUPABASE_ANON_KEY = "PASTE_YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY_HERE";

/* ---------- Configuration ---------- */

const configured =
  typeof SUPABASE_URL === "string" &&
  /^https:\/\/[^/]+\.supabase\.co\/?$/.test(SUPABASE_URL) &&
  typeof SUPABASE_ANON_KEY === "string" &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes("PASTE_YOUR_") &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const notice = document.querySelector("#configNotice");
const authPanel = document.querySelector("#authPanel");
const dashPanel = document.querySelector("#dashPanel");

let supabaseClient = null;
let mode = "login";

const $ = (selector) => document.querySelector(selector);

function message(text, error = false) {
  const element = $("#authMsg");
  if (!element) return;

  element.textContent = text;
  element.style.color = error ? "#ff9caa" : "#c9f36a";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

/* ---------- Supabase initialization ---------- */

if (notice) {
  notice.classList.toggle("hidden", configured);
}

if (configured && window.supabase?.createClient) {
  try {
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );
  } catch (error) {
    console.error("Supabase initialization failed:", error);
    message("Supabase could not initialize. Check your configuration.", true);
  }
} else if (configured && !window.supabase?.createClient) {
  console.error("Supabase JS library was not loaded.");
}

/* ---------- Login / Signup mode ---------- */

function setMode(nextMode) {
  mode = nextMode;

  $("#loginTab")?.classList.toggle("active", mode === "login");
  $("#signupTab")?.classList.toggle("active", mode === "signup");

  const submitButton = $("#authSubmit");

  if (submitButton) {
    submitButton.innerHTML =
      mode === "login"
        ? 'Sign in <span>→</span>'
        : 'Create account <span>→</span>';
  }

  message("");
}

$("#loginTab")?.addEventListener("click", () => setMode("login"));
$("#signupTab")?.addEventListener("click", () => setMode("signup"));

/* ---------- Session ---------- */

async function getSession() {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) throw error;

  return data.session;
}

/* ---------- Authenticated API requests ---------- */

async function api(path, options = {}) {
  const session = await getSession();

  if (!session) {
    throw new Error("Please sign in again.");
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json"
  };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Your session is invalid or expired. Please sign in again.");
    }

    throw new Error(
      data.detail || data.message || `Request failed (${response.status})`
    );
  }

  return data;
}

/* ---------- Login / Signup form ---------- */

$("#authForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!supabaseClient) {
    message(
      "Supabase is not configured. Check the URL, public key and Supabase JS library.",
      true
    );
    return;
  }

  const email = $("#email")?.value.trim();
  const password = $("#password")?.value;
  const submitButton = $("#authSubmit");

  if (!email || !password) {
    message("Enter your email and password.", true);
    return;
  }

  if (submitButton) submitButton.disabled = true;
  message("Please wait…");

  try {
    let result;

    if (mode === "login") {
      result = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });
    } else {
      result = await supabaseClient.auth.signUp({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    if (mode === "signup" && !result.data.session) {
      message("Account created. Check your email to confirm, then sign in.");
      return;
    }

    message(mode === "login" ? "Signed in successfully." : "Account created.");
    await refreshUI();
  } catch (error) {
    console.error("Authentication error:", error);
    message(error.message || "Authentication failed.", true);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

/* ---------- Logout ---------- */

$("#logoutBtn")?.addEventListener("click", async () => {
  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;

    await refreshUI();
    message("Signed out successfully.");
  } catch (error) {
    console.error("Logout error:", error);
    alert(error.message || "Could not sign out.");
  }
});

/* ---------- Create API key ---------- */

$("#createKey")?.addEventListener("click", async () => {
  const button = $("#createKey");
  if (button) button.disabled = true;

  try {
    const result = await api("/api/keys", {
      method: "POST",
      body: "{}"
    });

    if (!result.api_key) {
      throw new Error("The server did not return an API key.");
    }

    const keyValue = $("#newKeyValue");
    const newKeyPanel = $("#newKey");

    if (keyValue) keyValue.textContent = result.api_key;
    newKeyPanel?.classList.remove("hidden");

    await loadKeys();
  } catch (error) {
    console.error("Create API key error:", error);
    alert(error.message || "Could not create API key.");
  } finally {
    if (button) button.disabled = false;
  }
});

/* ---------- Copy API key ---------- */

$("#copyKey")?.addEventListener("click", async () => {
  const value = $("#newKeyValue")?.textContent || "";
  const button = $("#copyKey");

  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);

    if (button) {
      const originalText = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    }
  } catch {
    alert("Clipboard unavailable. Select and copy the key manually.");
  }
});

/* ---------- Load API keys ---------- */

async function loadKeys() {
  const container = $("#keysList");
  if (!container) return;

  container.textContent = "Loading…";

  try {
    const data = await api("/api/keys");

    if (!Array.isArray(data.keys)) {
      throw new Error("Unexpected response from the API.");
    }

    if (data.keys.length === 0) {
      container.innerHTML =
        '<p class="muted">No API keys yet. Generate your first key above.</p>';
      return;
    }

    container.replaceChildren();

    for (const key of data.keys) {
      const row = document.createElement("div");
      row.className = "keyitem";

      const info = document.createElement("div");
      info.className = "keyinfo";

      const code = document.createElement("code");
      code.textContent = `${key.key_prefix || "API"}••••••••`;

      const small = document.createElement("small");
      const createdDate = key.created_at
        ? new Date(key.created_at).toLocaleDateString()
        : "Unknown";

      small.textContent =
        `${key.is_active ? "Active" : "Revoked"} · Created ${createdDate}`;

      info.append(code, small);
      row.append(info);

      if (key.is_active) {
        const button = document.createElement("button");
        button.className = "revoke";
        button.textContent = "Revoke";

        button.addEventListener("click", async () => {
          if (!confirm("Revoke this API key? Existing integrations will stop working.")) {
            return;
          }

          button.disabled = true;

          try {
            await api(`/api/keys/${encodeURIComponent(key.id)}`, {
              method: "DELETE"
            });

            await loadKeys();
          } catch (error) {
            console.error("Revoke API key error:", error);
            alert(error.message || "Could not revoke API key.");
            button.disabled = false;
          }
        });

        row.append(button);
      }

      container.append(row);
    }
  } catch (error) {
    console.error("Load API keys error:", error);

    container.innerHTML =
      `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

/* ---------- Refresh dashboard ---------- */

let refreshInProgress = false;

async function refreshUI() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    const session = await getSession();

    authPanel?.classList.toggle("hidden", Boolean(session));
    dashPanel?.classList.toggle("hidden", !session);

    if (session) {
      const userEmail = $("#userEmail");

      if (userEmail) {
        userEmail.textContent = session.user.email || "User";
      }

      await loadKeys();
    }
  } catch (error) {
    console.error("Dashboard refresh error:", error);
    message(error.message || "Could not load your session.", true);
  } finally {
    refreshInProgress = false;
  }
}

/* ---------- Auth state listener ---------- */

if (supabaseClient) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.info("Auth state changed:", event);
    setTimeout(() => refreshUI(), 0);
  });
}

/* ---------- Initial page load ---------- */

if (!configured) {
  console.error(
    "Supabase configuration is missing. Check SUPABASE_URL and SUPABASE_ANON_KEY."
  );
} else if (!supabaseClient) {
  console.error(
    "Supabase client is unavailable. Check that the Supabase JS library loads before app.js."
  );
}

refreshUI();
