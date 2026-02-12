const supabase = window.supabase.createClient(
  window.__SUPABASE_URL__,
  window.__SUPABASE_ANON_KEY__
);

const COUNTRIES = [
  { label: "مصر", value: "Egypt", currency: "EGP" },
  { label: "السودان", value: "Sudan", currency: "SDG" },
  { label: "امريكا", value: "USA", currency: "USD" },
  { label: "دول الخليج", value: "Gulf", currency: "AED" },
];

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fillCountrySelect(selectEl) {
  selectEl.innerHTML = COUNTRIES
    .map((c) => `<option value="${c.value}">${c.label}</option>`)
    .join("");
}

function countryByValue(v) {
  return COUNTRIES.find((c) => c.value === v) || null;
}

async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function createClient({ full_name, phone, email }) {
  const { data, error } = await supabase
    .from("clients")
    .insert([{ full_name, phone, email }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function upsertRate({ from_country, to_country, from_currency, to_currency, rate }) {
  const { data, error } = await supabase
    .from("exchange_rates")
    .upsert([{ from_country, to_country, from_currency, to_currency, rate, active: true }], {
      onConflict: "from_country,to_country,from_currency,to_currency",
    })
    .select();
  if (error) throw error;
  return data;
}

async function listRates() {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function getRate({ from_country, to_country, from_currency, to_currency }) {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate")
    .eq("from_country", from_country)
    .eq("to_country", to_country)
    .eq("from_currency", from_currency)
    .eq("to_currency", to_currency)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data?.rate ?? null;
}

async function createTransfer(row) {
  const { data, error } = await supabase
    .from("transfers")
    .insert([row])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateTransfer(id, patch) {
  const { error } = await supabase.from("transfers").update(patch).eq("id", id);
  if (error) throw error;
}

async function listTransfers({ status = "" } = {}) {
  let q = supabase
    .from("transfers")
    .select("id,order_ref,status,send_country,receive_country,send_amount,send_currency,proof_path,created_at, clients(full_name)")
    .order("created_at", { ascending: false });

  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function listTransfersByClient(clientId) {
  const { data, error } = await supabase
    .from("transfers")
    .select("id,order_ref,status,send_country,receive_country,send_amount,send_currency,proof_path,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function uploadProof(file, transferId) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${transferId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("proofs")
    .upload(path, file, { upsert: false });

  if (error) throw error;
  return path;
}

async function getSignedProofUrl(path) {
  const { data, error } = await supabase.storage
    .from("proofs")
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// -------- UI --------
function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tab = btn.dataset.tab;
      ["clients", "newTransfer", "transfers", "rates"].forEach((t) => {
        const el = $("tab-" + t);
        if (el) el.style.display = t === tab ? "block" : "none";
      });

      if (tab === "clients") reloadClients();
      if (tab === "transfers") reloadTransfers();
      if (tab === "rates") reloadRates();
    });
  });
}

function setupReceiverToggle() {
  const phoneBox = $("rcPhoneBox");
  const bankBox = $("rcBankBox");
  document.querySelectorAll('input[name="rcType"]').forEach((r) => {
    r.addEventListener("change", () => {
      const v = document.querySelector('input[name="rcType"]:checked').value;
      phoneBox.style.display = v === "phone" ? "block" : "none";
      bankBox.style.display = v === "bank" ? "block" : "none";
    });
  });
}

async function reloadClients() {
  const rows = await listClients();
  const search = $("clientSearch").value.trim().toLowerCase();

  const filtered = !search
    ? rows
    : rows.filter((r) =>
        (r.full_name || "").toLowerCase().includes(search) ||
        (r.phone || "").toLowerCase().includes(search) ||
        (r.email || "").toLowerCase().includes(search)
      );

  $("clientsTbody").innerHTML = filtered
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.full_name)}</td>
        <td>${escapeHtml(r.phone || "")}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td><button class="btn ghost" data-open-client="${r.id}">فتح</button></td>
      </tr>`
    )
    .join("");

  $("tClient").innerHTML = rows
    .map((r) => `<option value="${r.id}">${escapeHtml(r.full_name)}${r.phone ? " - " + escapeHtml(r.phone) : ""}</option>`)
    .join("");

  document.querySelectorAll("button[data-open-client]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.getAttribute("data-open-client");
      await openClientFile(id, rows.find((x) => x.id === id));
    });
  });
}

async function openClientFile(clientId, clientRow) {
  $("clientFile").style.display = "block";
  $("clientFileTitle").textContent = `${clientRow?.full_name || ""} — معاملات العميل`;

  const rows = await listTransfersByClient(clientId);
  $("clientTransfersTbody").innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.order_ref)}</td>
        <td>${escapeHtml(r.send_country)} → ${escapeHtml(r.receive_country)}</td>
        <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${r.proof_path ? `<button class="btn ghost" data-proof="${escapeHtml(r.proof_path)}">فتح</button>` : ""}</td>
      </tr>`
    )
    .join("");

  document.querySelectorAll("button[data-proof]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const path = btn.getAttribute("data-proof");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      } catch (e) {
        alert(e.message || "Failed to open proof");
      }
    });
  });
}

async function reloadTransfers() {
  const status = $("filterStatus").value;
  const rows = await listTransfers({ status });

  $("transfersTbody").innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.order_ref)}</td>
        <td>${escapeHtml(r.clients?.full_name || "")}</td>
        <td>${escapeHtml(r.send_country)} → ${escapeHtml(r.receive_country)}</td>
        <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
        <td>
          <select data-status-id="${r.id}">
            ${["Pending","Processing","Completed","Cancelled"].map((s) => `<option value="${s}" ${s===r.status?"selected":""}>${s}</option>`).join("")}
          </select>
        </td>
        <td>${r.proof_path ? `<button class="btn ghost" data-proof="${escapeHtml(r.proof_path)}">فتح</button>` : ""}</td>
      </tr>`
    )
    .join("");

  document.querySelectorAll('select[data-status-id]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const id = sel.getAttribute("data-status-id");
      try {
        await updateTransfer(id, { status: sel.value });
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

  document.querySelectorAll("button[data-proof]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const path = btn.getAttribute("data-proof");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      } catch (e) {
        alert(e.message || "Failed to open proof");
      }
    });
  });
}

async function reloadRates() {
  const rows = await listRates();
  $("ratesTbody").innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.from_country)}</td>
        <td>${escapeHtml(r.to_country)}</td>
        <td>${escapeHtml(r.from_currency)} → ${escapeHtml(r.to_currency)}</td>
        <td>${Number(r.rate).toFixed(4)}</td>
      </tr>`
    )
    .join("");
}

async function onAddClient() {
  const full_name = $("cName").value.trim();
  const phone = $("cPhone").value.trim();
  const email = $("cEmail").value.trim();

  if (!full_name) return alert("اكتب اسم العميل");

  await createClient({ full_name, phone: phone || null, email: email || null });

  $("cName").value = "";
  $("cPhone").value = "";
  $("cEmail").value = "";
  await reloadClients();
}

async function onSaveRate() {
  const from_country = $("rFromCountry").value;
  const to_country = $("rToCountry").value;
  const from = countryByValue(from_country);
  const to = countryByValue(to_country);
  const rate = Number($("rRate").value);

  if (!from || !to) return ($("ratesMsg").textContent = "اختار البلدان");
  if (!rate || rate <= 0) return ($("ratesMsg").textContent = "اكتب Rate صحيح");

  try {
    await upsertRate({
      from_country,
      to_country,
      from_currency: from.currency,
      to_currency: to.currency,
      rate,
    });
    $("rRate").value = "";
    $("ratesMsg").textContent = "تم حفظ السعر ✅";
    await reloadRates();
  } catch (e) {
    $("ratesMsg").textContent = e.message || "فشل الحفظ";
  }
}

async function onCreateTransfer() {
  const msgEl = $("newTransferMsg");
  msgEl.textContent = "جارٍ الحفظ...";

  const client_id = $("tClient").value;
  const send_country = $("tSendCountry").value;
  const receive_country = $("tReceiveCountry").value;

  const sendAmount = Number($("tSendAmount").value);
  const receiver_name = $("tReceiverName").value.trim();
  const payment_method = $("tPayMethod").value;

  const rcType = document.querySelector('input[name="rcType"]:checked').value;
  const receiver_phone = $("tReceiverPhone").value.trim();
  const receiver_bank_account = $("tReceiverBank").value.trim();

  const note = $("tNote").value.trim();
  const proofFile = $("tProof").files[0] || null;

  const from = countryByValue(send_country);
  const to = countryByValue(receive_country);

  if (!client_id) return (msgEl.textContent = "اختار العميل");
  if (!from || !to) return (msgEl.textContent = "اختار البلدان");
  if (!sendAmount || sendAmount <= 0) return (msgEl.textContent = "اكتب مبلغ إرسال صحيح");
  if (!receiver_name) return (msgEl.textContent = "اكتب اسم المستلم");

  if (rcType === "phone" && !receiver_phone) return (msgEl.textContent = "اكتب رقم هاتف المستلم");
  if (rcType === "bank" && !receiver_bank_account) return (msgEl.textContent = "اكتب الحساب البنكي");

  let rate = Number($("tRate").value);
  if (!rate || rate <= 0) {
    rate = await getRate({
      from_country: send_country,
      to_country: receive_country,
      from_currency: from.currency,
      to_currency: to.currency,
    });
  }
  if (!rate || rate <= 0) return (msgEl.textContent = "مافي سعر صرف. أدخلو يدوي أو احفظو في صفحة أسعار الصرف.");

  const receive_amount = sendAmount * rate;
  const order_ref = `NTO-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

  try {
    const created = await createTransfer({
      order_ref,
      client_id,
      send_country,
      receive_country,
      send_amount: sendAmount,
      send_currency: from.currency,
      receive_amount,
      receive_currency: to.currency,
      payment_method,
      receiver_name,
      receiver_contact_type: rcType,
      receiver_phone: rcType === "phone" ? receiver_phone : null,
      receiver_bank_account: rcType === "bank" ? receiver_bank_account : null,
      internal_note: note || null,
      status: "Pending",
    });

    if (proofFile) {
      const proof_path = await uploadProof(proofFile, created.id);
      await updateTransfer(created.id, { proof_path });
    }

    $("tSendAmount").value = "";
    $("tRate").value = "";
    $("tReceiverName").value = "";
    $("tReceiverPhone").value = "";
    $("tReceiverBank").value = "";
    $("tNote").value = "";
    $("tProof").value = "";

    msgEl.textContent = `تم حفظ التحويلة ✅ Order: ${order_ref}`;
  } catch (e) {
    msgEl.textContent = e.message || "فشل حفظ التحويلة";
  }
}

async function afterLogin() {
  $("loginCard").style.display = "none";
  $("app").style.display = "block";
  $("btnLogout").style.display = "inline-block";

  const { data } = await supabase.auth.getUser();
  $("whoami").textContent = data?.user?.email || "admin";

  await reloadClients();
  await reloadTransfers();
  await reloadRates();
}

async function init() {
  fillCountrySelect($("tSendCountry"));
  fillCountrySelect($("tReceiveCountry"));
  fillCountrySelect($("rFromCountry"));
  fillCountrySelect($("rToCountry"));

  setupTabs();
  setupReceiverToggle();

  $("btnLogin").addEventListener("click", async () => {
    $("loginMsg").textContent = "";
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    try {
      await signIn(email, password);
      await afterLogin();
    } catch (e) {
      $("loginMsg").textContent = e.message || "Login failed";
    }
  });

  $("btnLogout").addEventListener("click", async () => {
    await signOut();
    location.reload();
  });

  $("btnAddClient").addEventListener("click", () => onAddClient().catch((e) => alert(e.message || "Error")));
  $("btnReloadClients").addEventListener("click", () => reloadClients().catch((e) => alert(e.message || "Error")));
  $("clientSearch").addEventListener("input", () => reloadClients().catch(() => {}));

  $("btnCreateTransfer").addEventListener("click", () => onCreateTransfer().catch((e) => alert(e.message || "Error")));
  $("btnReloadTransfers").addEventListener("click", () => reloadTransfers().catch((e) => alert(e.message || "Error")));
  $("filterStatus").addEventListener("change", () => reloadTransfers().catch(() => {}));

  $("btnSaveRate").addEventListener("click", () => onSaveRate().catch((e) => alert(e.message || "Error")));
  $("btnReloadRates").addEventListener("click", () => reloadRates().catch((e) => alert(e.message || "Error")));

  const session = await getSession();
  if (session) await afterLogin();
}

init().catch((e) => alert(e.message || "Init error"));
