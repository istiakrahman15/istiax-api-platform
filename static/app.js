// Add the Supabase Project URL and anon/public key here. Never put the service-role key in this file.
const SUPABASE_URL = "https://iopactkfsrnwrjcpbump.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvcGFjdGtmc3Jud3JqY3BidW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzk3MzIsImV4cCI6MjEwNzY1NTczMn0.b5R2nKWKDvciZu5qpaY53C9bA2TW6W6bsbia1ojuF64";
const configured = SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY !== "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvcGFjdGtmc3Jud3JqY3BidW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzk3MzIsImV4cCI6MjEwNzY1NTczMn0.b5R2nKWKDvciZu5qpaY53C9bA2TW6W6bsbia1ojuF64";
const notice = document.querySelector("#configNotice");
const authPanel = document.querySelector("#authPanel");
const dashPanel = document.querySelector("#dashPanel");
let supabaseClient = null;
let mode = "login";
if (!configured) notice.classList.remove("hidden");
else supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (s) => document.querySelector(s);
$("#loginTab").onclick = () => setMode("login");
$("#signupTab").onclick = () => setMode("signup");
function setMode(next) {
  mode = next;
  $("#loginTab").classList.toggle("active", mode === "login");
  $("#signupTab").classList.toggle("active", mode === "signup");
  $("#authSubmit").innerHTML = mode === "login" ? 'Sign in <span>→</span>' : 'Create account <span>→</span>';
  $("#authMsg").textContent = "";
}
function message(text, error=false) { $("#authMsg").textContent = text; $("#authMsg").style.color = error ? "#ff9caa" : "#c9f36a"; }
async function getSession() { if (!supabaseClient) return null; const {data} = await supabaseClient.auth.getSession(); return data.session; }
async function api(path, options={}) {
  const session = await getSession();
  if (!session) throw new Error("Please sign in again.");
  const response = await fetch(path, {...options, headers: {...(options.headers||{}), Authorization: `Bearer ${session.access_token}`, "Content-Type":"application/json"}});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.detail || data.message || "Request failed");
  return data;
}
$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!supabaseClient) return message("Configure Supabase URL and anon key in static/app.js first.", true);
  const email = $("#email").value.trim(), password = $("#password").value;
  $("#authSubmit").disabled = true; message("Please wait…");
  try {
    const result = mode === "login"
      ? await supabaseClient.auth.signInWithPassword({email,password})
      : await supabaseClient.auth.signUp({email,password});
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) message("Account created. Check your email to confirm, then sign in.");
    else { message("Success."); await refreshUI(); }
  } catch(err) { message(err.message || "Authentication failed.", true); }
  finally { $("#authSubmit").disabled = false; }
});
$("#logoutBtn").onclick = async () => { await supabaseClient.auth.signOut(); await refreshUI(); };
$("#createKey").onclick = async () => {
  $("#createKey").disabled = true;
  try {
    const result = await api("/api/keys", {method:"POST",body:"{}"});
    $("#newKeyValue").textContent = result.api_key;
    $("#newKey").classList.remove("hidden");
    await loadKeys();
  } catch(err) { alert(err.message); }
  finally { $("#createKey").disabled = false; }
};
$("#copyKey").onclick = async () => {
  try { await navigator.clipboard.writeText($("#newKeyValue").textContent); $("#copyKey").textContent = "Copied"; }
  catch { alert("Please select and copy the key manually."); }
};
async function loadKeys() {
  const container = $("#keysList"); container.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const data = await api("/api/keys");
    if (!data.keys.length) { container.innerHTML = '<p class="muted">No API keys yet. Generate your first key above.</p>'; return; }
    container.innerHTML = "";
    for (const key of data.keys) {
      const row = document.createElement("div"); row.className = "keyitem";
      const info = document.createElement("div"); info.className = "keyinfo";
      const code = document.createElement("code"); code.textContent = key.key_prefix + "••••••••";
      const small = document.createElement("small"); small.textContent = `${key.is_active ? "Active" : "Revoked"} · Created ${new Date(key.created_at).toLocaleDateString()}`;
      info.append(code, small); row.append(info);
      if (key.is_active) {
        const btn = document.createElement("button"); btn.className = "revoke"; btn.textContent = "Revoke";
        btn.onclick = async () => { if (!confirm("Revoke this API key? Existing integrations will stop working.")) return; try { await api(`/api/keys/${key.id}`, {method:"DELETE"}); await loadKeys(); } catch(err) { alert(err.message); } };
        row.append(btn);
      }
      container.append(row);
    }
  } catch(err) { container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function refreshUI() {
  const session = await getSession();
  authPanel.classList.toggle("hidden", !!session);
  dashPanel.classList.toggle("hidden", !session);
  if (session) { $("#userEmail").textContent = session.user.email || "User"; await loadKeys(); }
}
if (supabaseClient) supabaseClient.auth.onAuthStateChange(() => setTimeout(refreshUI, 0));
refreshUI();
