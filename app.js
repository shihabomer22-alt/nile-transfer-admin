(() => {
  if (window.__NILE_ADMIN_INITED__) return;
  window.__NILE_ADMIN_INITED__ = true;

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // --- Countries (USA not America)
  const COUNTRIES = [
    { label: "مصر", value: "Egypt", currency: "EGP" },
    { label: "السودان", value: "Sudan", currency: "SDG" },
    { label: "USA", value: "USA", currency: "USD" },
    { label: "دول الخليج", value: "Gulf", currency: "AED" },
  ];

  const normalizeCountry = (v) => (v === "America" ? "USA" : v);
  const countryByValue = (v) => COUNTRIES.find((c) => c.value === normalizeCountry(v)) || null;

  function fillCountrySelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    for (const c of COUNTRIES) {
      const opt = document.createElement("option");
      opt.value = c.value;
      opt.textContent = c.label;
      selectEl.appendChild(opt);
    }
  }

  // --- Supabase
  if (!window.supabase || !window.supabase.createClient) {
    alert("Supabase library not loaded. Check index.html script order.");
    return;
  }

  const normalizeSupabaseUrl = (url) => {
    let u = String(url || "").trim();

    // If user pasted the URL twice (e.g. https://x.supabase.cohttps://x.supabase.co),
    // keep only the first valid URL.
    const match = u.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
    if (match) u = match[0];

    // Remove trailing slashes
    u = u.replace(/\/+$/, "");
    return u;
  };

  const SUPABASE_URL = normalizeSupabaseUrl(window.__SUPABASE_URL__);
  const SUPABASE_ANON_KEY = String(window.__SUPABASE_ANON_KEY__ || "").trim();

  if (!SUPABASE_URL || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) {
    alert(
      "Supabase URL غلط. لازم يكون بالشكل:\n" +
        "https://YOUR_PROJECT_REF.supabase.co\n\n" +
        "افتح index.html وعدل window.__SUPABASE_URL__"
    );
    console.error("Invalid SUPABASE_URL:", window.__SUPABASE_URL__, "=>", SUPABASE_URL);
    return;
  }

  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.length < 50) {
    alert(
      "Supabase ANON KEY غلط/ناقص.\n" +
        "افتح Supabase -> Settings -> API وخُد anon public key"
    );
    console.error("Invalid SUPABASE_ANON_KEY length:", SUPABASE_ANON_KEY.length);
    return;
  }

  // Create ONE client globally (avoid redeclare issues)
  const supabase =
    window.__SB_CLIENT__ ||
    (window.__SB_CLIENT__ = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    ));

  // --- Auth
  async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // --- Helpers
  function showMsg(el, text) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
  }

  function genClientCode() {
    // Simple unique-ish code without sequences: NTC- + 6 digits from random
    return "NTC-" + String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  }

  function parseProofPaths(proof_path) {
    if (!proof_path) return [];
    const s = String(proof_path);
    if (s.trim().startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    return [s];
  }

  // --- DB: Clients
  async function listClients() {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function saveClient(row) {
    // Upsert by id if exists else insert
    if (row.id) {
      const { data, error } = await supabase
        .from("clients")
        .update(row)
        .eq("id", row.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert([row])
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  // --- DB: Rates
  async function listRates() {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function upsertRate({ from_country, to_country, from_currency, to_currency, rate }) {
    const { error } = await supabase
      .from("exchange_rates")
      .upsert([{ from_country, to_country, from_currency, to_currency, rate, active: true }], {
        onConflict: "from_country,to_country,from_currency,to_currency",
      });
    if (error) throw error;
  }

  async function getRate({ from_country, to_country, from_currency, to_currency }) {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("rate")
      .eq("from_country", normalizeCountry(from_country))
      .eq("to_country", normalizeCountry(to_country))
      .eq("from_currency", from_currency)
      .eq("to_currency", to_currency)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    return data?.rate ?? null;
  }

  // --- DB: Transfers
  async function createTransfer(row) {
    row.send_country = normalizeCountry(row.send_country);
    row.receive_country = normalizeCountry(row.receive_country);

    const { data, error } = await supabase.from("transfers").insert([row]).select().single();
    if (error) throw error;
    return data;
  }

  async function updateTransfer(id, patch) {
    const { error } = await supabase.from("transfers").update(patch).eq("id", id);
    if (error) throw error;
  }

  async function listTransfers({ status = "", limit = 200 } = {}) {
    let q = supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,receive_amount,receive_currency,payment_method,receiver_name,receiver_contact_type,receiver_phone,receiver_bank_account,internal_note,proof_path,created_at, clients(id,full_name,client_code,email,phone)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function listTransfersByClient(clientId) {
    const { data, error } = await supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,receive_amount,receive_currency,payment_method,receiver_name,receiver_contact_type,receiver_phone,receiver_bank_account,internal_note,proof_path,created_at"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // --- Storage: proofs (multiple)
  async function uploadProof(file, transferId) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${transferId}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const { error } = await supabase.storage.from("proofs").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }

  async function uploadProofs(files, transferId) {
    const paths = [];
    for (const f of files) paths.push(await uploadProof(f, transferId));
    return paths;
  }

  async function getSignedProofUrl(path) {
    const { data, error } = await supabase.storage.from("proofs").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // --- Tabs
  function setupTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const tab = btn.dataset.tab;
        const tabs = ["dashboard", "clients", "newTransfer", "transfers", "rates"];
        tabs.forEach((t) => {
          const el = $("tab-" + t);
          if (el) el.style.display = t === tab ? "block" : "none";
        });

        if (tab === "dashboard") reloadDashboard();
        if (tab === "clients") reloadClientsUI();
        if (tab === "transfers") reloadTransfersUI();
        if (tab === "rates") reloadRatesUI();
      });
    });
  }

  function setupReceiverToggle() {
    const phoneBox = $("rcPhoneBox");
    const bankBox = $("rcBankBox");

    document.querySelectorAll('input[name="rcType"]').forEach((r) => {
      r.addEventListener("change", () => {
        const v = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
        if (phoneBox) phoneBox.style.display = v === "phone" ? "block" : "none";
        if (bankBox) bankBox.style.display = v === "bank" ? "block" : "none";
      });
    });
  }

  // --- Client autocomplete (New Transfer)
  let CLIENTS_CACHE = [];

  function attachClientAutocomplete() {
    const box = $("clientAutoBox");
    const input = $("tClientSearch");
    const hidden = $("tClient");
    const sug = $("clientSuggestions");
    const badge = $("selectedClientBadge");

    if (!input || !hidden || !sug || !box) return;

    const getCode = (c) => c.client_code || c.code || c.reference_code || c.customer_code || c.id;

    const render = (items) => {
      sug.innerHTML = "";
      if (!items.length) {
        sug.style.display = "none";
        return;
      }
      for (const c of items.slice(0, 8)) {
        const code = getCode(c);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `
          <div><strong>${escapeHtml(c.full_name || "")}</strong></div>
          <span class="small">
            ${escapeHtml(c.email || "")}${c.email ? " • " : ""}
            ${escapeHtml(c.phone || "")}${c.phone ? " • " : ""}
            Code: ${escapeHtml(code)}
          </span>
        `;
        btn.addEventListener("click", () => {
          hidden.value = c.id;
          input.value = `${c.full_name || ""} (${code})`;
          sug.style.display = "none";
          sug.innerHTML = "";

          if (badge) {
            badge.style.display = "inline-block";
            badge.textContent = `Selected: ${c.full_name || ""} — ${code}`;
          }
        });
        sug.appendChild(btn);
      }
      sug.style.display = "block";
    };

    const filterClients = (q) => {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      return CLIENTS_CACHE.filter((c) => {
        const code = String(getCode(c) || "").toLowerCase();
        return (
          String(c.full_name || "").toLowerCase().includes(s) ||
          String(c.email || "").toLowerCase().includes(s) ||
          String(c.phone || "").toLowerCase().includes(s) ||
          code.includes(s)
        );
      });
    };

    input.addEventListener("input", () => {
      hidden.value = "";
      if (badge) badge.style.display = "none";
      render(filterClients(input.value));
    });

    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) sug.style.display = "none";
    });
  }

  // --- Clients UI
  function clearClientForm() {
    $("cId").value = "";
    $("cName").value = "";
    $("cEmail").value = "";
    $("cPhone").value = "";
    $("cCode").value = "";
    $("cAddr1").value = "";
    $("cAddr2").value = "";
    $("cCity").value = "";
    $("cState").value = "";
    $("cZip").value = "";
    $("cCountry").value = "";
    $("cNotes").value = "";
  }

  function fillClientForm(c) {
    $("cId").value = c.id || "";
    $("cName").value = c.full_name || "";
    $("cEmail").value = c.email || "";
    $("cPhone").value = c.phone || "";
    $("cCode").value = c.client_code || "";
    $("cAddr1").value = c.address_line1 || "";
    $("cAddr2").value = c.address_line2 || "";
    $("cCity").value = c.city || "";
    $("cState").value = c.state || "";
    $("cZip").value = c.postal_code || "";
    $("cCountry").value = c.country || "";
    $("cNotes").value = c.notes || "";
  }

  async function reloadClientsUI() {
    CLIENTS_CACHE = await listClients();

    // KPI update
    $("kpiClients").textContent = String(CLIENTS_CACHE.length);

    // table
    const tbody = $("clientsTbody");
    const q = ($("clientSearch")?.value || "").trim().toLowerCase();

    const filtered = !q
      ? CLIENTS_CACHE
      : CLIENTS_CACHE.filter((c) => {
          const code = String(c.client_code || "").toLowerCase();
          return (
            String(c.full_name || "").toLowerCase().includes(q) ||
            String(c.email || "").toLowerCase().includes(q) ||
            String(c.phone || "").toLowerCase().includes(q) ||
            code.includes(q)
          );
        });

    tbody.innerHTML = filtered
      .map((c) => {
        const code = c.client_code || "";
        return `
          <tr>
            <td>${escapeHtml(c.full_name || "")}</td>
            <td>${escapeHtml(c.phone || "")}</td>
            <td>${escapeHtml(c.email || "")}</td>
            <td>${escapeHtml(code)}</td>
            <td>
              <button class="btn" data-open-client="${c.id}">Open</button>
              <button class="btn" data-edit-client="${c.id}">Edit</button>
            </td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("button[data-edit-client]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-edit-client");
        const c = CLIENTS_CACHE.find((x) => x.id === id);
        if (!c) return;
        fillClientForm(c);
        showMsg($("clientMsg"), "Loaded for edit ✅");
      });
    });

    document.querySelectorAll("button[data-open-client]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-open-client");
        const c = CLIENTS_CACHE.find((x) => x.id === id);
        if (!c) return;
        await openClientFile(id, c);
      });
    });

    attachClientAutocomplete();
  }

  async function openClientFile(clientId, clientRow) {
    const box = $("clientFile");
    box.style.display = "block";
    $("clientFileTitle").textContent = `${clientRow.full_name || ""} — Customer file`;

    // show full client details
    const info = $("clientFileInfo");
    info.innerHTML = `
      <div class="field third"><label>Code</label><input disabled value="${escapeHtml(clientRow.client_code || "")}"/></div>
      <div class="field third"><label>Email</label><input disabled value="${escapeHtml(clientRow.email || "")}"/></div>
      <div class="field third"><label>Phone</label><input disabled value="${escapeHtml(clientRow.phone || "")}"/></div>

      <div class="field full"><label>Address</label>
        <textarea disabled>${escapeHtml(
          `${clientRow.address_line1 || ""}\n${clientRow.address_line2 || ""}\n${clientRow.city || ""} ${clientRow.state || ""}\n${clientRow.postal_code || ""}\n${clientRow.country || ""}`.trim()
        )}</textarea>
      </div>

      <div class="field full"><label>Notes</label><textarea disabled>${escapeHtml(clientRow.notes || "")}</textarea></div>

      <div class="field full">
        <button class="btn primary" id="btnEditFromFile">Edit this client</button>
      </div>
    `;

    $("btnEditFromFile").addEventListener("click", () => {
      fillClientForm(clientRow);
      showMsg($("clientMsg"), "Loaded for edit ✅");
      // jump user to clients tab visually
      document.querySelector('.tab[data-tab="clients"]').click();
      // keep client file open (optional)
    });

    // transfers
    const rows = await listTransfersByClient(clientId);
    $("clientTransfersTbody").innerHTML = rows
      .map((r) => {
        const proofs = parseProofPaths(r.proof_path);
        const proofBtns = proofs
          .map((p, i) => `<button class="btn" data-proof="${escapeHtml(p)}">Proof ${i + 1}</button>`)
          .join(" ");
        return `
          <tr>
            <td>${escapeHtml(r.order_ref)}</td>
            <td>${escapeHtml(normalizeCountry(r.send_country))} → ${escapeHtml(normalizeCountry(r.receive_country))}</td>
            <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
            <td><span class="status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
            <td>${proofBtns || ""}</td>
            <td><button class="btn" data-details="${r.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#clientTransfersTbody button[data-proof]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-proof");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      });
    });

    document.querySelectorAll("#clientTransfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, clientRow);
      });
    });
  }

  // --- Transfer details modal
  function openTransferDetails(t, clientRowMaybe) {
    $("detailsModal").style.display = "flex";
    $("detailsTitle").textContent = `Transfer: ${t.order_ref || ""}`;

    const body = $("detailsBody");
    const clientName = clientRowMaybe?.full_name || t.clients?.full_name || "";
    const clientCode = clientRowMaybe?.client_code || t.clients?.client_code || "";

    body.innerHTML = `
      <div class="field third"><label>Order</label><input disabled value="${escapeHtml(t.order_ref || "")}"/></div>
      <div class="field third"><label>Status</label><input disabled value="${escapeHtml(t.status || "")}"/></div>
      <div class="field third"><label>Payment</label><input disabled value="${escapeHtml(t.payment_method || "")}"/></div>

      <div class="field full"><label>Client</label>
        <input disabled value="${escapeHtml(clientName)} ${clientCode ? "(" + escapeHtml(clientCode) + ")" : ""}"/>
      </div>

      <div class="field third"><label>Send</label><input disabled value="${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}"/></div>
      <div class="field third"><label>Receive</label><input disabled value="${Number(t.receive_amount || 0).toFixed(2)} ${escapeHtml(t.receive_currency || "")}"/></div>
      <div class="field third"><label>Route</label><input disabled value="${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}"/></div>

      <div class="field full"><label>Recipient</label>
        <input disabled value="${escapeHtml(t.receiver_name || "")}"/>
      </div>

      <div class="field full"><label>Recipient contact</label>
        <input disabled value="${escapeHtml(t.receiver_contact_type || "")} ${
          t.receiver_contact_type === "phone" ? escapeHtml(t.receiver_phone || "") : escapeHtml(t.receiver_bank_account || "")
        }"/>
      </div>

      <div class="field full"><label>Internal note</label>
        <textarea disabled>${escapeHtml(t.internal_note || "")}</textarea>
      </div>
    `;

    // proofs
    const proofs = parseProofPaths(t.proof_path);
    const proofBox = $("detailsProofs");
    proofBox.innerHTML = proofs.length
      ? proofs
          .map(
            (p, i) =>
              `<button class="btn" data-proof-open="${escapeHtml(p)}">Open proof ${i + 1}</button>`
          )
          .join("")
      : `<span class="badge">No proofs</span>`;

    document.querySelectorAll("button[data-proof-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-proof-open");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      });
    });
  }

  function closeTransferDetails() {
    $("detailsModal").style.display = "none";
    $("detailsBody").innerHTML = "";
    $("detailsProofs").innerHTML = "";
  }

  // --- Transfers UI
  async function reloadTransfersUI() {
    const status = $("filterStatus")?.value || "";
    const rows = await listTransfers({ status, limit: 300 });

    // KPI
    $("kpiTransfers").textContent = String(rows.length);
    $("kpiPending").textContent = String(rows.filter((x) => x.status === "Pending").length);

    const tbody = $("transfersTbody");
    tbody.innerHTML = rows
      .map((t) => {
        const proofs = parseProofPaths(t.proof_path);
        const proofCount = proofs.length ? `${proofs.length} file(s)` : "—";
        return `
          <tr>
            <td>${escapeHtml(t.order_ref || "")}</td>
            <td>${escapeHtml(t.clients?.full_name || "")}</td>
            <td>${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}</td>
            <td>${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}</td>
            <td><span class="status ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td>${escapeHtml(proofCount)}</td>
            <td><button class="btn" data-details="${t.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#transfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, null);
      });
    });
  }

  // --- Dashboard
  async function reloadDashboard() {
    const rows = await listTransfers({ status: "", limit: 20 });
    $("dashTransfersTbody").innerHTML = rows
      .slice(0, 8)
      .map((t) => {
        return `
          <tr>
            <td>${escapeHtml(t.order_ref || "")}</td>
            <td>${escapeHtml(t.clients?.full_name || "")}</td>
            <td>${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}</td>
            <td>${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}</td>
            <td><span class="status ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td><button class="btn" data-details="${t.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#dashTransfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, null);
      });
    });

    // update KPIs from caches if available
    $("kpiClients").textContent = String(CLIENTS_CACHE.length || 0);
    $("kpiTransfers").textContent = String(rows.length || 0);
    $("kpiPending").textContent = String(rows.filter((x) => x.status === "Pending").length);
  }

  // --- Rates UI
  async function reloadRatesUI() {
    const rows = await listRates();
    $("ratesTbody").innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(normalizeCountry(r.from_country))}</td>
          <td>${escapeHtml(normalizeCountry(r.to_country))}</td>
          <td>${escapeHtml(r.from_currency)} → ${escapeHtml(r.to_currency)}</td>
          <td>${Number(r.rate).toFixed(4)}</td>
        </tr>`
      )
      .join("");
  }

  // --- Auto calc receive preview
  async function updateReceivePreview() {
    const send_country = $("tSendCountry")?.value;
    const receive_country = $("tReceiveCountry")?.value;
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    const sendAmount = Number($("tSendAmount")?.value || 0);
    const manualRateRaw = ($("tRate")?.value || "").trim();

    if (!from || !to || !sendAmount || sendAmount <= 0) {
      $("tReceivePreview").value = "";
      showMsg($("newTransferMsg"), "");
      return;
    }

    let rate = manualRateRaw ? Number(manualRateRaw) : null;
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }

    if (!rate || rate <= 0) {
      $("tReceivePreview").value = "";
      showMsg($("newTransferMsg"), "مافي سعر صرف محفوظ. أدخلو يدوي أو احفظو في Exchange Rates.");
      return;
    }

    const receive = sendAmount * rate;
    $("tReceivePreview").value = `${receive.toFixed(2)} ${to.currency}`;
    showMsg($("newTransferMsg"), `تحويل تلقائي: ${sendAmount} ${from.currency} × ${rate} = ${receive.toFixed(2)} ${to.currency}`);
  }

  // --- Actions: Save client
  async function onSaveClient() {
    const msg = $("clientMsg");
    showMsg(msg, "");

    const id = ($("cId").value || "").trim() || null;
    let client_code = ($("cCode").value || "").trim();
    if (!client_code) client_code = genClientCode();

    const row = {
      id: id || undefined,
      full_name: ($("cName").value || "").trim(),
      email: ($("cEmail").value || "").trim() || null,
      phone: ($("cPhone").value || "").trim() || null,
      client_code,
      address_line1: ($("cAddr1").value || "").trim() || null,
      address_line2: ($("cAddr2").value || "").trim() || null,
      city: ($("cCity").value || "").trim() || null,
      state: ($("cState").value || "").trim() || null,
      postal_code: ($("cZip").value || "").trim() || null,
      country: ($("cCountry").value || "").trim() || null,
      notes: ($("cNotes").value || "").trim() || null,
    };

    if (!row.full_name) return showMsg(msg, "اكتب اسم العميل");

    try {
      const saved = await saveClient(row);
      $("cCode").value = saved.client_code || client_code;
      $("cId").value = saved.id;
      showMsg(msg, "تم حفظ العميل ✅");
      await reloadClientsUI();
    } catch (e) {
      showMsg(msg, e.message || "فشل حفظ العميل");
    }
  }

  // --- Actions: Save rate
  async function onSaveRate() {
    const msg = $("ratesMsg");
    showMsg(msg, "");

    const from_country = $("rFromCountry").value;
    const to_country = $("rToCountry").value;
    const from = countryByValue(from_country);
    const to = countryByValue(to_country);
    const rate = Number($("rRate").value);

    if (!from || !to) return showMsg(msg, "اختار البلدان");
    if (!rate || rate <= 0) return showMsg(msg, "اكتب Rate صحيح");

    try {
      await upsertRate({
        from_country: normalizeCountry(from_country),
        to_country: normalizeCountry(to_country),
        from_currency: from.currency,
        to_currency: to.currency,
        rate,
      });
      $("rRate").value = "";
      showMsg(msg, "تم حفظ السعر ✅");
      await reloadRatesUI();
    } catch (e) {
      showMsg(msg, e.message || "فشل الحفظ");
    }
  }

  // --- Actions: Create transfer (proof optional + multiple)
  async function onCreateTransfer() {
    const msg = $("newTransferMsg");
    showMsg(msg, "");

    const client_id = ($("tClient").value || "").trim();
    if (!client_id) return showMsg(msg, "اختار العميل من الاقتراحات أولاً");

    const send_country = $("tSendCountry").value;
    const receive_country = $("tReceiveCountry").value;
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    const sendAmount = Number($("tSendAmount").value || 0);
    if (!sendAmount || sendAmount <= 0) return showMsg(msg, "اكتب مبلغ إرسال صحيح");

    const receiver_name = ($("tReceiverName").value || "").trim();
    if (!receiver_name) return showMsg(msg, "اكتب اسم المستلم");

    const payment_method = $("tPayMethod").value;

    const rcType = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
    const receiver_phone = ($("tReceiverPhone").value || "").trim();
    const receiver_bank_account = ($("tReceiverBank").value || "").trim();

    if (rcType === "phone" && !receiver_phone) return showMsg(msg, "اكتب رقم هاتف المستلم");
    if (rcType === "bank" && !receiver_bank_account) return showMsg(msg, "اكتب الحساب البنكي");

    const note = ($("tNote").value || "").trim();

    // rate manual optional
    let rate = Number(($("tRate").value || "").trim());
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }
    if (!rate || rate <= 0) return showMsg(msg, "مافي سعر صرف. أدخلو يدوي أو احفظو في Exchange Rates.");

    const receive_amount = sendAmount * rate;

    const order_ref = `NTO-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    showMsg(msg, "جارٍ الحفظ...");

    try {
      const created = await createTransfer({
        order_ref,
        client_id,
        send_country: normalizeCountry(send_country),
        receive_country: normalizeCountry(receive_country),
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

      // ✅ proof optional + multiple
      const proofFiles = Array.from($("tProof").files || []);
      if (proofFiles.length) {
        const paths = await uploadProofs(proofFiles, created.id);
        await updateTransfer(created.id, { proof_path: JSON.stringify(paths) });
      }

      // reset
      $("tClientSearch").value = "";
      $("tClient").value = "";
      $("selectedClientBadge").style.display = "none";
      $("tSendAmount").value = "";
      $("tRate").value = "";
      $("tReceivePreview").value = "";
      $("tReceiverName").value = "";
      $("tReceiverPhone").value = "";
      $("tReceiverBank").value = "";
      $("tNote").value = "";
      $("tProof").value = "";

      showMsg(msg, `تم حفظ التحويلة ✅ Order: ${order_ref}`);

      await reloadTransfersUI();
      await reloadDashboard();
    } catch (e) {
      showMsg(msg, e.message || "فشل حفظ التحويلة");
    }
  }

  // --- Init
  async function afterLogin() {
    $("loginCard").style.display = "none";
    $("app").style.display = "block";
    $("btnLogout").style.display = "inline-block";
    $("whoami").style.display = "inline-block";

    const { data } = await supabase.auth.getUser();
    $("whoami").textContent = data?.user?.email || "admin";

    CLIENTS_CACHE = await listClients();
    await reloadDashboard();
    await reloadClientsUI();
    await reloadTransfersUI();
    await reloadRatesUI();
  }

  async function init() {
    fillCountrySelect($("tSendCountry"));
    fillCountrySelect($("tReceiveCountry"));
    fillCountrySelect($("rFromCountry"));
    fillCountrySelect($("rToCountry"));

    setupTabs();
    setupReceiverToggle();
    attachClientAutocomplete();

    // login
    $("btnLogin").addEventListener("click", async () => {
      showMsg($("loginMsg"), "");
      const email = ($("loginEmail").value || "").trim();
      const password = $("loginPassword").value || "";
      try {
        await signIn(email, password);
        await afterLogin();
      } catch (e) {
        showMsg($("loginMsg"), e.message || "Login failed");
      }
    });

    // logout
    $("btnLogout").addEventListener("click", async () => {
      await signOut();
      location.reload();
    });

    // close client file
    $("btnCloseClientFile").addEventListener("click", () => {
      $("clientFile").style.display = "none";
    });

    // client search
    $("clientSearch").addEventListener("input", () => reloadClientsUI().catch(() => {}));
    $("btnReloadClients").addEventListener("click", () => reloadClientsUI().catch((e) => alert(e.message)));

    // save/new client
    $("btnSaveClient").addEventListener("click", () => onSaveClient().catch((e) => alert(e.message)));
    $("btnNewClient").addEventListener("click", () => {
      clearClientForm();
      showMsg($("clientMsg"), "");
    });

    // create transfer
    $("btnCreateTransfer").addEventListener("click", () => onCreateTransfer().catch((e) => alert(e.message)));

    // auto preview
    $("tSendAmount").addEventListener("input", () => updateReceivePreview().catch(() => {}));
    $("tRate").addEventListener("input", () => updateReceivePreview().catch(() => {}));
    $("tSendCountry").addEventListener("change", () => updateReceivePreview().catch(() => {}));
    $("tReceiveCountry").addEventListener("change", () => updateReceivePreview().catch(() => {}));

    // transfers filter
    $("filterStatus").addEventListener("change", () => reloadTransfersUI().catch(() => {}));
    $("btnReloadTransfers").addEventListener("click", () => reloadTransfersUI().catch((e) => alert(e.message)));

    // rates
    $("btnSaveRate").addEventListener("click", () => onSaveRate().catch((e) => alert(e.message)));
    $("btnReloadRates").addEventListener("click", () => reloadRatesUI().catch((e) => alert(e.message)));

    // modal
    $("btnCloseDetails").addEventListener("click", closeTransferDetails);
    $("detailsModal").addEventListener("click", (e) => {
      if (e.target.id === "detailsModal") closeTransferDetails();
    });

    // session
    const session = await getSession();
    if (session) await afterLogin();
  }

  init().catch((e) => alert(e.message || "Init error"));
})();
(() => {
  if (window.__NILE_ADMIN_INITED__) return;
  window.__NILE_ADMIN_INITED__ = true;

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // --- Countries (USA not America)
  const COUNTRIES = [
    { label: "مصر", value: "Egypt", currency: "EGP" },
    { label: "السودان", value: "Sudan", currency: "SDG" },
    { label: "USA", value: "USA", currency: "USD" },
    { label: "دول الخليج", value: "Gulf", currency: "AED" },
  ];

  const normalizeCountry = (v) => (v === "America" ? "USA" : v);
  const countryByValue = (v) => COUNTRIES.find((c) => c.value === normalizeCountry(v)) || null;

  function fillCountrySelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    for (const c of COUNTRIES) {
      const opt = document.createElement("option");
      opt.value = c.value;
      opt.textContent = c.label;
      selectEl.appendChild(opt);
    }
  }

  // --- Supabase
  if (!window.supabase || !window.supabase.createClient) {
    alert("Supabase library not loaded. Check index.html script order.");
    return;
  }

  const normalizeSupabaseUrl = (url) => {
    let u = String(url || "").trim();

    // If user pasted the URL twice (e.g. https://x.supabase.cohttps://x.supabase.co),
    // keep only the first valid URL.
    const match = u.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
    if (match) u = match[0];

    // Remove trailing slashes
    u = u.replace(/\/+$/, "");
    return u;
  };

  const SUPABASE_URL = normalizeSupabaseUrl(window.__SUPABASE_URL__);
  const SUPABASE_ANON_KEY = String(window.__SUPABASE_ANON_KEY__ || "").trim();

  if (!SUPABASE_URL || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) {
    alert(
      "Supabase URL غلط. لازم يكون بالشكل:\n" +
        "https://YOUR_PROJECT_REF.supabase.co\n\n" +
        "افتح index.html وعدل window.__SUPABASE_URL__"
    );
    console.error("Invalid SUPABASE_URL:", window.__SUPABASE_URL__, "=>", SUPABASE_URL);
    return;
  }

  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.length < 50) {
    alert(
      "Supabase ANON KEY غلط/ناقص.\n" +
        "افتح Supabase -> Settings -> API وخُد anon public key"
    );
    console.error("Invalid SUPABASE_ANON_KEY length:", SUPABASE_ANON_KEY.length);
    return;
  }

  // Create ONE client globally (avoid redeclare issues)
  const supabase =
    window.__SB_CLIENT__ ||
    (window.__SB_CLIENT__ = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    ));

  // --- Auth
  async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // --- Helpers
  function showMsg(el, text) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
  }

  function genClientCode() {
    // Simple unique-ish code without sequences: NTC- + 6 digits from random
    return "NTC-" + String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  }

  function parseProofPaths(proof_path) {
    if (!proof_path) return [];
    const s = String(proof_path);
    if (s.trim().startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    return [s];
  }

  // --- DB: Clients
  async function listClients() {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function saveClient(row) {
    // Upsert by id if exists else insert
    if (row.id) {
      const { data, error } = await supabase
        .from("clients")
        .update(row)
        .eq("id", row.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert([row])
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  // --- DB: Rates
  async function listRates() {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function upsertRate({ from_country, to_country, from_currency, to_currency, rate }) {
    const { error } = await supabase
      .from("exchange_rates")
      .upsert([{ from_country, to_country, from_currency, to_currency, rate, active: true }], {
        onConflict: "from_country,to_country,from_currency,to_currency",
      });
    if (error) throw error;
  }

  async function getRate({ from_country, to_country, from_currency, to_currency }) {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("rate")
      .eq("from_country", normalizeCountry(from_country))
      .eq("to_country", normalizeCountry(to_country))
      .eq("from_currency", from_currency)
      .eq("to_currency", to_currency)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    return data?.rate ?? null;
  }

  // --- DB: Transfers
  async function createTransfer(row) {
    row.send_country = normalizeCountry(row.send_country);
    row.receive_country = normalizeCountry(row.receive_country);

    const { data, error } = await supabase.from("transfers").insert([row]).select().single();
    if (error) throw error;
    return data;
  }

  async function updateTransfer(id, patch) {
    const { error } = await supabase.from("transfers").update(patch).eq("id", id);
    if (error) throw error;
  }

  async function listTransfers({ status = "", limit = 200 } = {}) {
    let q = supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,receive_amount,receive_currency,payment_method,receiver_name,receiver_contact_type,receiver_phone,receiver_bank_account,internal_note,proof_path,created_at, clients(id,full_name,client_code,email,phone)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function listTransfersByClient(clientId) {
    const { data, error } = await supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,receive_amount,receive_currency,payment_method,receiver_name,receiver_contact_type,receiver_phone,receiver_bank_account,internal_note,proof_path,created_at"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // --- Storage: proofs (multiple)
  async function uploadProof(file, transferId) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${transferId}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const { error } = await supabase.storage.from("proofs").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }

  async function uploadProofs(files, transferId) {
    const paths = [];
    for (const f of files) paths.push(await uploadProof(f, transferId));
    return paths;
  }

  async function getSignedProofUrl(path) {
    const { data, error } = await supabase.storage.from("proofs").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // --- Tabs
  function setupTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const tab = btn.dataset.tab;
        const tabs = ["dashboard", "clients", "newTransfer", "transfers", "rates"];
        tabs.forEach((t) => {
          const el = $("tab-" + t);
          if (el) el.style.display = t === tab ? "block" : "none";
        });

        if (tab === "dashboard") reloadDashboard();
        if (tab === "clients") reloadClientsUI();
        if (tab === "transfers") reloadTransfersUI();
        if (tab === "rates") reloadRatesUI();
      });
    });
  }

  function setupReceiverToggle() {
    const phoneBox = $("rcPhoneBox");
    const bankBox = $("rcBankBox");

    document.querySelectorAll('input[name="rcType"]').forEach((r) => {
      r.addEventListener("change", () => {
        const v = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
        if (phoneBox) phoneBox.style.display = v === "phone" ? "block" : "none";
        if (bankBox) bankBox.style.display = v === "bank" ? "block" : "none";
      });
    });
  }

  // --- Client autocomplete (New Transfer)
  let CLIENTS_CACHE = [];

  function attachClientAutocomplete() {
    const box = $("clientAutoBox");
    const input = $("tClientSearch");
    const hidden = $("tClient");
    const sug = $("clientSuggestions");
    const badge = $("selectedClientBadge");

    if (!input || !hidden || !sug || !box) return;

    const getCode = (c) => c.client_code || c.code || c.reference_code || c.customer_code || c.id;

    const render = (items) => {
      sug.innerHTML = "";
      if (!items.length) {
        sug.style.display = "none";
        return;
      }
      for (const c of items.slice(0, 8)) {
        const code = getCode(c);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `
          <div><strong>${escapeHtml(c.full_name || "")}</strong></div>
          <span class="small">
            ${escapeHtml(c.email || "")}${c.email ? " • " : ""}
            ${escapeHtml(c.phone || "")}${c.phone ? " • " : ""}
            Code: ${escapeHtml(code)}
          </span>
        `;
        btn.addEventListener("click", () => {
          hidden.value = c.id;
          input.value = `${c.full_name || ""} (${code})`;
          sug.style.display = "none";
          sug.innerHTML = "";

          if (badge) {
            badge.style.display = "inline-block";
            badge.textContent = `Selected: ${c.full_name || ""} — ${code}`;
          }
        });
        sug.appendChild(btn);
      }
      sug.style.display = "block";
    };

    const filterClients = (q) => {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      return CLIENTS_CACHE.filter((c) => {
        const code = String(getCode(c) || "").toLowerCase();
        return (
          String(c.full_name || "").toLowerCase().includes(s) ||
          String(c.email || "").toLowerCase().includes(s) ||
          String(c.phone || "").toLowerCase().includes(s) ||
          code.includes(s)
        );
      });
    };

    input.addEventListener("input", () => {
      hidden.value = "";
      if (badge) badge.style.display = "none";
      render(filterClients(input.value));
    });

    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) sug.style.display = "none";
    });
  }

  // --- Clients UI
  function clearClientForm() {
    $("cId").value = "";
    $("cName").value = "";
    $("cEmail").value = "";
    $("cPhone").value = "";
    $("cCode").value = "";
    $("cAddr1").value = "";
    $("cAddr2").value = "";
    $("cCity").value = "";
    $("cState").value = "";
    $("cZip").value = "";
    $("cCountry").value = "";
    $("cNotes").value = "";
  }

  function fillClientForm(c) {
    $("cId").value = c.id || "";
    $("cName").value = c.full_name || "";
    $("cEmail").value = c.email || "";
    $("cPhone").value = c.phone || "";
    $("cCode").value = c.client_code || "";
    $("cAddr1").value = c.address_line1 || "";
    $("cAddr2").value = c.address_line2 || "";
    $("cCity").value = c.city || "";
    $("cState").value = c.state || "";
    $("cZip").value = c.postal_code || "";
    $("cCountry").value = c.country || "";
    $("cNotes").value = c.notes || "";
  }

  async function reloadClientsUI() {
    CLIENTS_CACHE = await listClients();

    // KPI update
    $("kpiClients").textContent = String(CLIENTS_CACHE.length);

    // table
    const tbody = $("clientsTbody");
    const q = ($("clientSearch")?.value || "").trim().toLowerCase();

    const filtered = !q
      ? CLIENTS_CACHE
      : CLIENTS_CACHE.filter((c) => {
          const code = String(c.client_code || "").toLowerCase();
          return (
            String(c.full_name || "").toLowerCase().includes(q) ||
            String(c.email || "").toLowerCase().includes(q) ||
            String(c.phone || "").toLowerCase().includes(q) ||
            code.includes(q)
          );
        });

    tbody.innerHTML = filtered
      .map((c) => {
        const code = c.client_code || "";
        return `
          <tr>
            <td>${escapeHtml(c.full_name || "")}</td>
            <td>${escapeHtml(c.phone || "")}</td>
            <td>${escapeHtml(c.email || "")}</td>
            <td>${escapeHtml(code)}</td>
            <td>
              <button class="btn" data-open-client="${c.id}">Open</button>
              <button class="btn" data-edit-client="${c.id}">Edit</button>
            </td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("button[data-edit-client]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-edit-client");
        const c = CLIENTS_CACHE.find((x) => x.id === id);
        if (!c) return;
        fillClientForm(c);
        showMsg($("clientMsg"), "Loaded for edit ✅");
      });
    });

    document.querySelectorAll("button[data-open-client]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-open-client");
        const c = CLIENTS_CACHE.find((x) => x.id === id);
        if (!c) return;
        await openClientFile(id, c);
      });
    });

    attachClientAutocomplete();
  }

  async function openClientFile(clientId, clientRow) {
    const box = $("clientFile");
    box.style.display = "block";
    $("clientFileTitle").textContent = `${clientRow.full_name || ""} — Customer file`;

    // show full client details
    const info = $("clientFileInfo");
    info.innerHTML = `
      <div class="field third"><label>Code</label><input disabled value="${escapeHtml(clientRow.client_code || "")}"/></div>
      <div class="field third"><label>Email</label><input disabled value="${escapeHtml(clientRow.email || "")}"/></div>
      <div class="field third"><label>Phone</label><input disabled value="${escapeHtml(clientRow.phone || "")}"/></div>

      <div class="field full"><label>Address</label>
        <textarea disabled>${escapeHtml(
          `${clientRow.address_line1 || ""}\n${clientRow.address_line2 || ""}\n${clientRow.city || ""} ${clientRow.state || ""}\n${clientRow.postal_code || ""}\n${clientRow.country || ""}`.trim()
        )}</textarea>
      </div>

      <div class="field full"><label>Notes</label><textarea disabled>${escapeHtml(clientRow.notes || "")}</textarea></div>

      <div class="field full">
        <button class="btn primary" id="btnEditFromFile">Edit this client</button>
      </div>
    `;

    $("btnEditFromFile").addEventListener("click", () => {
      fillClientForm(clientRow);
      showMsg($("clientMsg"), "Loaded for edit ✅");
      // jump user to clients tab visually
      document.querySelector('.tab[data-tab="clients"]').click();
      // keep client file open (optional)
    });

    // transfers
    const rows = await listTransfersByClient(clientId);
    $("clientTransfersTbody").innerHTML = rows
      .map((r) => {
        const proofs = parseProofPaths(r.proof_path);
        const proofBtns = proofs
          .map((p, i) => `<button class="btn" data-proof="${escapeHtml(p)}">Proof ${i + 1}</button>`)
          .join(" ");
        return `
          <tr>
            <td>${escapeHtml(r.order_ref)}</td>
            <td>${escapeHtml(normalizeCountry(r.send_country))} → ${escapeHtml(normalizeCountry(r.receive_country))}</td>
            <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
            <td><span class="status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
            <td>${proofBtns || ""}</td>
            <td><button class="btn" data-details="${r.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#clientTransfersTbody button[data-proof]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-proof");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      });
    });

    document.querySelectorAll("#clientTransfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, clientRow);
      });
    });
  }

  // --- Transfer details modal
  function openTransferDetails(t, clientRowMaybe) {
    $("detailsModal").style.display = "flex";
    $("detailsTitle").textContent = `Transfer: ${t.order_ref || ""}`;

    const body = $("detailsBody");
    const clientName = clientRowMaybe?.full_name || t.clients?.full_name || "";
    const clientCode = clientRowMaybe?.client_code || t.clients?.client_code || "";

    body.innerHTML = `
      <div class="field third"><label>Order</label><input disabled value="${escapeHtml(t.order_ref || "")}"/></div>
      <div class="field third"><label>Status</label><input disabled value="${escapeHtml(t.status || "")}"/></div>
      <div class="field third"><label>Payment</label><input disabled value="${escapeHtml(t.payment_method || "")}"/></div>

      <div class="field full"><label>Client</label>
        <input disabled value="${escapeHtml(clientName)} ${clientCode ? "(" + escapeHtml(clientCode) + ")" : ""}"/>
      </div>

      <div class="field third"><label>Send</label><input disabled value="${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}"/></div>
      <div class="field third"><label>Receive</label><input disabled value="${Number(t.receive_amount || 0).toFixed(2)} ${escapeHtml(t.receive_currency || "")}"/></div>
      <div class="field third"><label>Route</label><input disabled value="${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}"/></div>

      <div class="field full"><label>Recipient</label>
        <input disabled value="${escapeHtml(t.receiver_name || "")}"/>
      </div>

      <div class="field full"><label>Recipient contact</label>
        <input disabled value="${escapeHtml(t.receiver_contact_type || "")} ${
          t.receiver_contact_type === "phone" ? escapeHtml(t.receiver_phone || "") : escapeHtml(t.receiver_bank_account || "")
        }"/>
      </div>

      <div class="field full"><label>Internal note</label>
        <textarea disabled>${escapeHtml(t.internal_note || "")}</textarea>
      </div>
    `;

    // proofs
    const proofs = parseProofPaths(t.proof_path);
    const proofBox = $("detailsProofs");
    proofBox.innerHTML = proofs.length
      ? proofs
          .map(
            (p, i) =>
              `<button class="btn" data-proof-open="${escapeHtml(p)}">Open proof ${i + 1}</button>`
          )
          .join("")
      : `<span class="badge">No proofs</span>`;

    document.querySelectorAll("button[data-proof-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-proof-open");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      });
    });
  }

  function closeTransferDetails() {
    $("detailsModal").style.display = "none";
    $("detailsBody").innerHTML = "";
    $("detailsProofs").innerHTML = "";
  }

  // --- Transfers UI
  async function reloadTransfersUI() {
    const status = $("filterStatus")?.value || "";
    const rows = await listTransfers({ status, limit: 300 });

    // KPI
    $("kpiTransfers").textContent = String(rows.length);
    $("kpiPending").textContent = String(rows.filter((x) => x.status === "Pending").length);

    const tbody = $("transfersTbody");
    tbody.innerHTML = rows
      .map((t) => {
        const proofs = parseProofPaths(t.proof_path);
        const proofCount = proofs.length ? `${proofs.length} file(s)` : "—";
        return `
          <tr>
            <td>${escapeHtml(t.order_ref || "")}</td>
            <td>${escapeHtml(t.clients?.full_name || "")}</td>
            <td>${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}</td>
            <td>${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}</td>
            <td><span class="status ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td>${escapeHtml(proofCount)}</td>
            <td><button class="btn" data-details="${t.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#transfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, null);
      });
    });
  }

  // --- Dashboard
  async function reloadDashboard() {
    const rows = await listTransfers({ status: "", limit: 20 });
    $("dashTransfersTbody").innerHTML = rows
      .slice(0, 8)
      .map((t) => {
        return `
          <tr>
            <td>${escapeHtml(t.order_ref || "")}</td>
            <td>${escapeHtml(t.clients?.full_name || "")}</td>
            <td>${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}</td>
            <td>${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}</td>
            <td><span class="status ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td><button class="btn" data-details="${t.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#dashTransfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, null);
      });
    });

    // update KPIs from caches if available
    $("kpiClients").textContent = String(CLIENTS_CACHE.length || 0);
    $("kpiTransfers").textContent = String(rows.length || 0);
    $("kpiPending").textContent = String(rows.filter((x) => x.status === "Pending").length);
  }

  // --- Rates UI
  async function reloadRatesUI() {
    const rows = await listRates();
    $("ratesTbody").innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(normalizeCountry(r.from_country))}</td>
          <td>${escapeHtml(normalizeCountry(r.to_country))}</td>
          <td>${escapeHtml(r.from_currency)} → ${escapeHtml(r.to_currency)}</td>
          <td>${Number(r.rate).toFixed(4)}</td>
        </tr>`
      )
      .join("");
  }

  // --- Auto calc receive preview
  async function updateReceivePreview() {
    const send_country = $("tSendCountry")?.value;
    const receive_country = $("tReceiveCountry")?.value;
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    const sendAmount = Number($("tSendAmount")?.value || 0);
    const manualRateRaw = ($("tRate")?.value || "").trim();

    if (!from || !to || !sendAmount || sendAmount <= 0) {
      $("tReceivePreview").value = "";
      showMsg($("newTransferMsg"), "");
      return;
    }

    let rate = manualRateRaw ? Number(manualRateRaw) : null;
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }

    if (!rate || rate <= 0) {
      $("tReceivePreview").value = "";
      showMsg($("newTransferMsg"), "مافي سعر صرف محفوظ. أدخلو يدوي أو احفظو في Exchange Rates.");
      return;
    }

    const receive = sendAmount * rate;
    $("tReceivePreview").value = `${receive.toFixed(2)} ${to.currency}`;
    showMsg($("newTransferMsg"), `تحويل تلقائي: ${sendAmount} ${from.currency} × ${rate} = ${receive.toFixed(2)} ${to.currency}`);
  }

  // --- Actions: Save client
  async function onSaveClient() {
    const msg = $("clientMsg");
    showMsg(msg, "");

    const id = ($("cId").value || "").trim() || null;
    let client_code = ($("cCode").value || "").trim();
    if (!client_code) client_code = genClientCode();

    const row = {
      id: id || undefined,
      full_name: ($("cName").value || "").trim(),
      email: ($("cEmail").value || "").trim() || null,
      phone: ($("cPhone").value || "").trim() || null,
      client_code,
      address_line1: ($("cAddr1").value || "").trim() || null,
      address_line2: ($("cAddr2").value || "").trim() || null,
      city: ($("cCity").value || "").trim() || null,
      state: ($("cState").value || "").trim() || null,
      postal_code: ($("cZip").value || "").trim() || null,
      country: ($("cCountry").value || "").trim() || null,
      notes: ($("cNotes").value || "").trim() || null,
    };

    if (!row.full_name) return showMsg(msg, "اكتب اسم العميل");

    try {
      const saved = await saveClient(row);
      $("cCode").value = saved.client_code || client_code;
      $("cId").value = saved.id;
      showMsg(msg, "تم حفظ العميل ✅");
      await reloadClientsUI();
    } catch (e) {
      showMsg(msg, e.message || "فشل حفظ العميل");
    }
  }

  // --- Actions: Save rate
  async function onSaveRate() {
    const msg = $("ratesMsg");
    showMsg(msg, "");

    const from_country = $("rFromCountry").value;
    const to_country = $("rToCountry").value;
    const from = countryByValue(from_country);
    const to = countryByValue(to_country);
    const rate = Number($("rRate").value);

    if (!from || !to) return showMsg(msg, "اختار البلدان");
    if (!rate || rate <= 0) return showMsg(msg, "اكتب Rate صحيح");

    try {
      await upsertRate({
        from_country: normalizeCountry(from_country),
        to_country: normalizeCountry(to_country),
        from_currency: from.currency,
        to_currency: to.currency,
        rate,
      });
      $("rRate").value = "";
      showMsg(msg, "تم حفظ السعر ✅");
      await reloadRatesUI();
    } catch (e) {
      showMsg(msg, e.message || "فشل الحفظ");
    }
  }

  // --- Actions: Create transfer (proof optional + multiple)
  async function onCreateTransfer() {
    const msg = $("newTransferMsg");
    showMsg(msg, "");

    const client_id = ($("tClient").value || "").trim();
    if (!client_id) return showMsg(msg, "اختار العميل من الاقتراحات أولاً");

    const send_country = $("tSendCountry").value;
    const receive_country = $("tReceiveCountry").value;
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    const sendAmount = Number($("tSendAmount").value || 0);
    if (!sendAmount || sendAmount <= 0) return showMsg(msg, "اكتب مبلغ إرسال صحيح");

    const receiver_name = ($("tReceiverName").value || "").trim();
    if (!receiver_name) return showMsg(msg, "اكتب اسم المستلم");

    const payment_method = $("tPayMethod").value;

    const rcType = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
    const receiver_phone = ($("tReceiverPhone").value || "").trim();
    const receiver_bank_account = ($("tReceiverBank").value || "").trim();

    if (rcType === "phone" && !receiver_phone) return showMsg(msg, "اكتب رقم هاتف المستلم");
    if (rcType === "bank" && !receiver_bank_account) return showMsg(msg, "اكتب الحساب البنكي");

    const note = ($("tNote").value || "").trim();

    // rate manual optional
    let rate = Number(($("tRate").value || "").trim());
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }
    if (!rate || rate <= 0) return showMsg(msg, "مافي سعر صرف. أدخلو يدوي أو احفظو في Exchange Rates.");

    const receive_amount = sendAmount * rate;

    const order_ref = `NTO-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    showMsg(msg, "جارٍ الحفظ...");

    try {
      const created = await createTransfer({
        order_ref,
        client_id,
        send_country: normalizeCountry(send_country),
        receive_country: normalizeCountry(receive_country),
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

      // ✅ proof optional + multiple
      const proofFiles = Array.from($("tProof").files || []);
      if (proofFiles.length) {
        const paths = await uploadProofs(proofFiles, created.id);
        await updateTransfer(created.id, { proof_path: JSON.stringify(paths) });
      }

      // reset
      $("tClientSearch").value = "";
      $("tClient").value = "";
      $("selectedClientBadge").style.display = "none";
      $("tSendAmount").value = "";
      $("tRate").value = "";
      $("tReceivePreview").value = "";
      $("tReceiverName").value = "";
      $("tReceiverPhone").value = "";
      $("tReceiverBank").value = "";
      $("tNote").value = "";
      $("tProof").value = "";

      showMsg(msg, `تم حفظ التحويلة ✅ Order: ${order_ref}`);

      await reloadTransfersUI();
      await reloadDashboard();
    } catch (e) {
      showMsg(msg, e.message || "فشل حفظ التحويلة");
    }
  }

  // --- Init
  async function afterLogin() {
    $("loginCard").style.display = "none";
    $("app").style.display = "block";
    $("btnLogout").style.display = "inline-block";
    $("whoami").style.display = "inline-block";

    const { data } = await supabase.auth.getUser();
    $("whoami").textContent = data?.user?.email || "admin";

    CLIENTS_CACHE = await listClients();
    await reloadDashboard();
    await reloadClientsUI();
    await reloadTransfersUI();
    await reloadRatesUI();
  }

  async function init() {
    fillCountrySelect($("tSendCountry"));
    fillCountrySelect($("tReceiveCountry"));
    fillCountrySelect($("rFromCountry"));
    fillCountrySelect($("rToCountry"));

    setupTabs();
    setupReceiverToggle();
    attachClientAutocomplete();

    // login
    $("btnLogin").addEventListener("click", async () => {
      showMsg($("loginMsg"), "");
      const email = ($("loginEmail").value || "").trim();
      const password = $("loginPassword").value || "";
      try {
        await signIn(email, password);
        await afterLogin();
      } catch (e) {
        showMsg($("loginMsg"), e.message || "Login failed");
      }
    });

    // logout
    $("btnLogout").addEventListener("click", async () => {
      await signOut();
      location.reload();
    });

    // close client file
    $("btnCloseClientFile").addEventListener("click", () => {
      $("clientFile").style.display = "none";
    });

    // client search
    $("clientSearch").addEventListener("input", () => reloadClientsUI().catch(() => {}));
    $("btnReloadClients").addEventListener("click", () => reloadClientsUI().catch((e) => alert(e.message)));

    // save/new client
    $("btnSaveClient").addEventListener("click", () => onSaveClient().catch((e) => alert(e.message)));
    $("btnNewClient").addEventListener("click", () => {
      clearClientForm();
      showMsg($("clientMsg"), "");
    });

    // create transfer
    $("btnCreateTransfer").addEventListener("click", () => onCreateTransfer().catch((e) => alert(e.message)));

    // auto preview
    $("tSendAmount").addEventListener("input", () => updateReceivePreview().catch(() => {}));
    $("tRate").addEventListener("input", () => updateReceivePreview().catch(() => {}));
    $("tSendCountry").addEventListener("change", () => updateReceivePreview().catch(() => {}));
    $("tReceiveCountry").addEventListener("change", () => updateReceivePreview().catch(() => {}));

    // transfers filter
    $("filterStatus").addEventListener("change", () => reloadTransfersUI().catch(() => {}));
    $("btnReloadTransfers").addEventListener("click", () => reloadTransfersUI().catch((e) => alert(e.message)));

    // rates
    $("btnSaveRate").addEventListener("click", () => onSaveRate().catch((e) => alert(e.message)));
    $("btnReloadRates").addEventListener("click", () => reloadRatesUI().catch((e) => alert(e.message)));

    // modal
    $("btnCloseDetails").addEventListener("click", closeTransferDetails);
    $("detailsModal").addEventListener("click", (e) => {
      if (e.target.id === "detailsModal") closeTransferDetails();
    });

    // session
    const session = await getSession();
    if (session) await afterLogin();
  }

  init().catch((e) => alert(e.message || "Init error"));
})();
(() => {
  if (window.__NILE_ADMIN_INITED__) return;
  window.__NILE_ADMIN_INITED__ = true;

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // --- Countries (USA not America)
  const COUNTRIES = [
    { label: "مصر", value: "Egypt", currency: "EGP" },
    { label: "السودان", value: "Sudan", currency: "SDG" },
    { label: "USA", value: "USA", currency: "USD" },
    { label: "دول الخليج", value: "Gulf", currency: "AED" },
  ];

  const normalizeCountry = (v) => (v === "America" ? "USA" : v);
  const countryByValue = (v) => COUNTRIES.find((c) => c.value === normalizeCountry(v)) || null;

  function fillCountrySelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    for (const c of COUNTRIES) {
      const opt = document.createElement("option");
      opt.value = c.value;
      opt.textContent = c.label;
      selectEl.appendChild(opt);
    }
  }

  // --- Supabase
  if (!window.supabase) {
    alert("Supabase library not loaded. Check index.html script order.");
    return;
  }
  if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) {
    alert("Missing SUPABASE_URL / ANON_KEY in index.html");
    return;
  }

  const supabase =
    window.__SB_CLIENT__ ||
    (window.__SB_CLIENT__ = window.supabase.createClient(
      window.__SUPABASE_URL__,
      window.__SUPABASE_ANON_KEY__
    ));

  // --- Auth
  async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  // --- Helpers
  function showMsg(el, text) {
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
  }

  function genClientCode() {
    // Simple unique-ish code without sequences: NTC- + 6 digits from random
    return "NTC-" + String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  }

  function parseProofPaths(proof_path) {
    if (!proof_path) return [];
    const s = String(proof_path);
    if (s.trim().startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    return [s];
  }

  // --- DB: Clients
  async function listClients() {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function saveClient(row) {
    // Upsert by id if exists else insert
    if (row.id) {
      const { data, error } = await supabase
        .from("clients")
        .update(row)
        .eq("id", row.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert([row])
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  // --- DB: Rates
  async function listRates() {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function upsertRate({ from_country, to_country, from_currency, to_currency, rate }) {
    const { error } = await supabase
      .from("exchange_rates")
      .upsert([{ from_country, to_country, from_currency, to_currency, rate, active: true }], {
        onConflict: "from_country,to_country,from_currency,to_currency",
      });
    if (error) throw error;
  }

  async function getRate({ from_country, to_country, from_currency, to_currency }) {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("rate")
      .eq("from_country", normalizeCountry(from_country))
      .eq("to_country", normalizeCountry(to_country))
      .eq("from_currency", from_currency)
      .eq("to_currency", to_currency)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    return data?.rate ?? null;
  }

  // --- DB: Transfers
  async function createTransfer(row) {
    row.send_country = normalizeCountry(row.send_country);
    row.receive_country = normalizeCountry(row.receive_country);

    const { data, error } = await supabase.from("transfers").insert([row]).select().single();
    if (error) throw error;
    return data;
  }

  async function updateTransfer(id, patch) {
    const { error } = await supabase.from("transfers").update(patch).eq("id", id);
    if (error) throw error;
  }

  async function listTransfers({ status = "", limit = 200 } = {}) {
    let q = supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,receive_amount,receive_currency,payment_method,receiver_name,receiver_contact_type,receiver_phone,receiver_bank_account,internal_note,proof_path,created_at, clients(id,full_name,client_code,email,phone)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function listTransfersByClient(clientId) {
    const { data, error } = await supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,receive_amount,receive_currency,payment_method,receiver_name,receiver_contact_type,receiver_phone,receiver_bank_account,internal_note,proof_path,created_at"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // --- Storage: proofs (multiple)
  async function uploadProof(file, transferId) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${transferId}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const { error } = await supabase.storage.from("proofs").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }

  async function uploadProofs(files, transferId) {
    const paths = [];
    for (const f of files) paths.push(await uploadProof(f, transferId));
    return paths;
  }

  async function getSignedProofUrl(path) {
    const { data, error } = await supabase.storage.from("proofs").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // --- Tabs
  function setupTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const tab = btn.dataset.tab;
        const tabs = ["dashboard", "clients", "newTransfer", "transfers", "rates"];
        tabs.forEach((t) => {
          const el = $("tab-" + t);
          if (el) el.style.display = t === tab ? "block" : "none";
        });

        if (tab === "dashboard") reloadDashboard();
        if (tab === "clients") reloadClientsUI();
        if (tab === "transfers") reloadTransfersUI();
        if (tab === "rates") reloadRatesUI();
      });
    });
  }

  function setupReceiverToggle() {
    const phoneBox = $("rcPhoneBox");
    const bankBox = $("rcBankBox");

    document.querySelectorAll('input[name="rcType"]').forEach((r) => {
      r.addEventListener("change", () => {
        const v = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
        if (phoneBox) phoneBox.style.display = v === "phone" ? "block" : "none";
        if (bankBox) bankBox.style.display = v === "bank" ? "block" : "none";
      });
    });
  }

  // --- Client autocomplete (New Transfer)
  let CLIENTS_CACHE = [];

  function attachClientAutocomplete() {
    const box = $("clientAutoBox");
    const input = $("tClientSearch");
    const hidden = $("tClient");
    const sug = $("clientSuggestions");
    const badge = $("selectedClientBadge");

    if (!input || !hidden || !sug || !box) return;

    const getCode = (c) => c.client_code || c.code || c.reference_code || c.customer_code || c.id;

    const render = (items) => {
      sug.innerHTML = "";
      if (!items.length) {
        sug.style.display = "none";
        return;
      }
      for (const c of items.slice(0, 8)) {
        const code = getCode(c);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = `
          <div><strong>${escapeHtml(c.full_name || "")}</strong></div>
          <span class="small">
            ${escapeHtml(c.email || "")}${c.email ? " • " : ""}
            ${escapeHtml(c.phone || "")}${c.phone ? " • " : ""}
            Code: ${escapeHtml(code)}
          </span>
        `;
        btn.addEventListener("click", () => {
          hidden.value = c.id;
          input.value = `${c.full_name || ""} (${code})`;
          sug.style.display = "none";
          sug.innerHTML = "";

          if (badge) {
            badge.style.display = "inline-block";
            badge.textContent = `Selected: ${c.full_name || ""} — ${code}`;
          }
        });
        sug.appendChild(btn);
      }
      sug.style.display = "block";
    };

    const filterClients = (q) => {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      return CLIENTS_CACHE.filter((c) => {
        const code = String(getCode(c) || "").toLowerCase();
        return (
          String(c.full_name || "").toLowerCase().includes(s) ||
          String(c.email || "").toLowerCase().includes(s) ||
          String(c.phone || "").toLowerCase().includes(s) ||
          code.includes(s)
        );
      });
    };

    input.addEventListener("input", () => {
      hidden.value = "";
      if (badge) badge.style.display = "none";
      render(filterClients(input.value));
    });

    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) sug.style.display = "none";
    });
  }

  // --- Clients UI
  function clearClientForm() {
    $("cId").value = "";
    $("cName").value = "";
    $("cEmail").value = "";
    $("cPhone").value = "";
    $("cCode").value = "";
    $("cAddr1").value = "";
    $("cAddr2").value = "";
    $("cCity").value = "";
    $("cState").value = "";
    $("cZip").value = "";
    $("cCountry").value = "";
    $("cNotes").value = "";
  }

  function fillClientForm(c) {
    $("cId").value = c.id || "";
    $("cName").value = c.full_name || "";
    $("cEmail").value = c.email || "";
    $("cPhone").value = c.phone || "";
    $("cCode").value = c.client_code || "";
    $("cAddr1").value = c.address_line1 || "";
    $("cAddr2").value = c.address_line2 || "";
    $("cCity").value = c.city || "";
    $("cState").value = c.state || "";
    $("cZip").value = c.postal_code || "";
    $("cCountry").value = c.country || "";
    $("cNotes").value = c.notes || "";
  }

  async function reloadClientsUI() {
    CLIENTS_CACHE = await listClients();

    // KPI update
    $("kpiClients").textContent = String(CLIENTS_CACHE.length);

    // table
    const tbody = $("clientsTbody");
    const q = ($("clientSearch")?.value || "").trim().toLowerCase();

    const filtered = !q
      ? CLIENTS_CACHE
      : CLIENTS_CACHE.filter((c) => {
          const code = String(c.client_code || "").toLowerCase();
          return (
            String(c.full_name || "").toLowerCase().includes(q) ||
            String(c.email || "").toLowerCase().includes(q) ||
            String(c.phone || "").toLowerCase().includes(q) ||
            code.includes(q)
          );
        });

    tbody.innerHTML = filtered
      .map((c) => {
        const code = c.client_code || "";
        return `
          <tr>
            <td>${escapeHtml(c.full_name || "")}</td>
            <td>${escapeHtml(c.phone || "")}</td>
            <td>${escapeHtml(c.email || "")}</td>
            <td>${escapeHtml(code)}</td>
            <td>
              <button class="btn" data-open-client="${c.id}">Open</button>
              <button class="btn" data-edit-client="${c.id}">Edit</button>
            </td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("button[data-edit-client]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-edit-client");
        const c = CLIENTS_CACHE.find((x) => x.id === id);
        if (!c) return;
        fillClientForm(c);
        showMsg($("clientMsg"), "Loaded for edit ✅");
      });
    });

    document.querySelectorAll("button[data-open-client]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-open-client");
        const c = CLIENTS_CACHE.find((x) => x.id === id);
        if (!c) return;
        await openClientFile(id, c);
      });
    });

    attachClientAutocomplete();
  }

  async function openClientFile(clientId, clientRow) {
    const box = $("clientFile");
    box.style.display = "block";
    $("clientFileTitle").textContent = `${clientRow.full_name || ""} — Customer file`;

    // show full client details
    const info = $("clientFileInfo");
    info.innerHTML = `
      <div class="field third"><label>Code</label><input disabled value="${escapeHtml(clientRow.client_code || "")}"/></div>
      <div class="field third"><label>Email</label><input disabled value="${escapeHtml(clientRow.email || "")}"/></div>
      <div class="field third"><label>Phone</label><input disabled value="${escapeHtml(clientRow.phone || "")}"/></div>

      <div class="field full"><label>Address</label>
        <textarea disabled>${escapeHtml(
          `${clientRow.address_line1 || ""}\n${clientRow.address_line2 || ""}\n${clientRow.city || ""} ${clientRow.state || ""}\n${clientRow.postal_code || ""}\n${clientRow.country || ""}`.trim()
        )}</textarea>
      </div>

      <div class="field full"><label>Notes</label><textarea disabled>${escapeHtml(clientRow.notes || "")}</textarea></div>

      <div class="field full">
        <button class="btn primary" id="btnEditFromFile">Edit this client</button>
      </div>
    `;

    $("btnEditFromFile").addEventListener("click", () => {
      fillClientForm(clientRow);
      showMsg($("clientMsg"), "Loaded for edit ✅");
      // jump user to clients tab visually
      document.querySelector('.tab[data-tab="clients"]').click();
      // keep client file open (optional)
    });

    // transfers
    const rows = await listTransfersByClient(clientId);
    $("clientTransfersTbody").innerHTML = rows
      .map((r) => {
        const proofs = parseProofPaths(r.proof_path);
        const proofBtns = proofs
          .map((p, i) => `<button class="btn" data-proof="${escapeHtml(p)}">Proof ${i + 1}</button>`)
          .join(" ");
        return `
          <tr>
            <td>${escapeHtml(r.order_ref)}</td>
            <td>${escapeHtml(normalizeCountry(r.send_country))} → ${escapeHtml(normalizeCountry(r.receive_country))}</td>
            <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
            <td><span class="status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
            <td>${proofBtns || ""}</td>
            <td><button class="btn" data-details="${r.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#clientTransfersTbody button[data-proof]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-proof");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      });
    });

    document.querySelectorAll("#clientTransfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, clientRow);
      });
    });
  }

  // --- Transfer details modal
  function openTransferDetails(t, clientRowMaybe) {
    $("detailsModal").style.display = "flex";
    $("detailsTitle").textContent = `Transfer: ${t.order_ref || ""}`;

    const body = $("detailsBody");
    const clientName = clientRowMaybe?.full_name || t.clients?.full_name || "";
    const clientCode = clientRowMaybe?.client_code || t.clients?.client_code || "";

    body.innerHTML = `
      <div class="field third"><label>Order</label><input disabled value="${escapeHtml(t.order_ref || "")}"/></div>
      <div class="field third"><label>Status</label><input disabled value="${escapeHtml(t.status || "")}"/></div>
      <div class="field third"><label>Payment</label><input disabled value="${escapeHtml(t.payment_method || "")}"/></div>

      <div class="field full"><label>Client</label>
        <input disabled value="${escapeHtml(clientName)} ${clientCode ? "(" + escapeHtml(clientCode) + ")" : ""}"/>
      </div>

      <div class="field third"><label>Send</label><input disabled value="${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}"/></div>
      <div class="field third"><label>Receive</label><input disabled value="${Number(t.receive_amount || 0).toFixed(2)} ${escapeHtml(t.receive_currency || "")}"/></div>
      <div class="field third"><label>Route</label><input disabled value="${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}"/></div>

      <div class="field full"><label>Recipient</label>
        <input disabled value="${escapeHtml(t.receiver_name || "")}"/>
      </div>

      <div class="field full"><label>Recipient contact</label>
        <input disabled value="${escapeHtml(t.receiver_contact_type || "")} ${
          t.receiver_contact_type === "phone" ? escapeHtml(t.receiver_phone || "") : escapeHtml(t.receiver_bank_account || "")
        }"/>
      </div>

      <div class="field full"><label>Internal note</label>
        <textarea disabled>${escapeHtml(t.internal_note || "")}</textarea>
      </div>
    `;

    // proofs
    const proofs = parseProofPaths(t.proof_path);
    const proofBox = $("detailsProofs");
    proofBox.innerHTML = proofs.length
      ? proofs
          .map(
            (p, i) =>
              `<button class="btn" data-proof-open="${escapeHtml(p)}">Open proof ${i + 1}</button>`
          )
          .join("")
      : `<span class="badge">No proofs</span>`;

    document.querySelectorAll("button[data-proof-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.getAttribute("data-proof-open");
        const url = await getSignedProofUrl(path);
        window.open(url, "_blank");
      });
    });
  }

  function closeTransferDetails() {
    $("detailsModal").style.display = "none";
    $("detailsBody").innerHTML = "";
    $("detailsProofs").innerHTML = "";
  }

  // --- Transfers UI
  async function reloadTransfersUI() {
    const status = $("filterStatus")?.value || "";
    const rows = await listTransfers({ status, limit: 300 });

    // KPI
    $("kpiTransfers").textContent = String(rows.length);
    $("kpiPending").textContent = String(rows.filter((x) => x.status === "Pending").length);

    const tbody = $("transfersTbody");
    tbody.innerHTML = rows
      .map((t) => {
        const proofs = parseProofPaths(t.proof_path);
        const proofCount = proofs.length ? `${proofs.length} file(s)` : "—";
        return `
          <tr>
            <td>${escapeHtml(t.order_ref || "")}</td>
            <td>${escapeHtml(t.clients?.full_name || "")}</td>
            <td>${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}</td>
            <td>${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}</td>
            <td><span class="status ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td>${escapeHtml(proofCount)}</td>
            <td><button class="btn" data-details="${t.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#transfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, null);
      });
    });
  }

  // --- Dashboard
  async function reloadDashboard() {
    const rows = await listTransfers({ status: "", limit: 20 });
    $("dashTransfersTbody").innerHTML = rows
      .slice(0, 8)
      .map((t) => {
        return `
          <tr>
            <td>${escapeHtml(t.order_ref || "")}</td>
            <td>${escapeHtml(t.clients?.full_name || "")}</td>
            <td>${escapeHtml(normalizeCountry(t.send_country))} → ${escapeHtml(normalizeCountry(t.receive_country))}</td>
            <td>${Number(t.send_amount || 0).toFixed(2)} ${escapeHtml(t.send_currency || "")}</td>
            <td><span class="status ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td>
            <td><button class="btn" data-details="${t.id}">Details</button></td>
          </tr>`;
      })
      .join("");

    document.querySelectorAll("#dashTransfersTbody button[data-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-details");
        const t = rows.find((x) => x.id === id);
        if (t) openTransferDetails(t, null);
      });
    });

    // update KPIs from caches if available
    $("kpiClients").textContent = String(CLIENTS_CACHE.length || 0);
    $("kpiTransfers").textContent = String(rows.length || 0);
    $("kpiPending").textContent = String(rows.filter((x) => x.status === "Pending").length);
  }

  // --- Rates UI
  async function reloadRatesUI() {
    const rows = await listRates();
    $("ratesTbody").innerHTML = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(normalizeCountry(r.from_country))}</td>
          <td>${escapeHtml(normalizeCountry(r.to_country))}</td>
          <td>${escapeHtml(r.from_currency)} → ${escapeHtml(r.to_currency)}</td>
          <td>${Number(r.rate).toFixed(4)}</td>
        </tr>`
      )
      .join("");
  }

  // --- Auto calc receive preview
  async function updateReceivePreview() {
    const send_country = $("tSendCountry")?.value;
    const receive_country = $("tReceiveCountry")?.value;
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    const sendAmount = Number($("tSendAmount")?.value || 0);
    const manualRateRaw = ($("tRate")?.value || "").trim();

    if (!from || !to || !sendAmount || sendAmount <= 0) {
      $("tReceivePreview").value = "";
      showMsg($("newTransferMsg"), "");
      return;
    }

    let rate = manualRateRaw ? Number(manualRateRaw) : null;
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }

    if (!rate || rate <= 0) {
      $("tReceivePreview").value = "";
      showMsg($("newTransferMsg"), "مافي سعر صرف محفوظ. أدخلو يدوي أو احفظو في Exchange Rates.");
      return;
    }

    const receive = sendAmount * rate;
    $("tReceivePreview").value = `${receive.toFixed(2)} ${to.currency}`;
    showMsg($("newTransferMsg"), `تحويل تلقائي: ${sendAmount} ${from.currency} × ${rate} = ${receive.toFixed(2)} ${to.currency}`);
  }

  // --- Actions: Save client
  async function onSaveClient() {
    const msg = $("clientMsg");
    showMsg(msg, "");

    const id = ($("cId").value || "").trim() || null;
    let client_code = ($("cCode").value || "").trim();
    if (!client_code) client_code = genClientCode();

    const row = {
      id: id || undefined,
      full_name: ($("cName").value || "").trim(),
      email: ($("cEmail").value || "").trim() || null,
      phone: ($("cPhone").value || "").trim() || null,
      client_code,
      address_line1: ($("cAddr1").value || "").trim() || null,
      address_line2: ($("cAddr2").value || "").trim() || null,
      city: ($("cCity").value || "").trim() || null,
      state: ($("cState").value || "").trim() || null,
      postal_code: ($("cZip").value || "").trim() || null,
      country: ($("cCountry").value || "").trim() || null,
      notes: ($("cNotes").value || "").trim() || null,
    };

    if (!row.full_name) return showMsg(msg, "اكتب اسم العميل");

    try {
      const saved = await saveClient(row);
      $("cCode").value = saved.client_code || client_code;
      $("cId").value = saved.id;
      showMsg(msg, "تم حفظ العميل ✅");
      await reloadClientsUI();
    } catch (e) {
      showMsg(msg, e.message || "فشل حفظ العميل");
    }
  }

  // --- Actions: Save rate
  async function onSaveRate() {
    const msg = $("ratesMsg");
    showMsg(msg, "");

    const from_country = $("rFromCountry").value;
    const to_country = $("rToCountry").value;
    const from = countryByValue(from_country);
    const to = countryByValue(to_country);
    const rate = Number($("rRate").value);

    if (!from || !to) return showMsg(msg, "اختار البلدان");
    if (!rate || rate <= 0) return showMsg(msg, "اكتب Rate صحيح");

    try {
      await upsertRate({
        from_country: normalizeCountry(from_country),
        to_country: normalizeCountry(to_country),
        from_currency: from.currency,
        to_currency: to.currency,
        rate,
      });
      $("rRate").value = "";
      showMsg(msg, "تم حفظ السعر ✅");
      await reloadRatesUI();
    } catch (e) {
      showMsg(msg, e.message || "فشل الحفظ");
    }
  }

  // --- Actions: Create transfer (proof optional + multiple)
  async function onCreateTransfer() {
    const msg = $("newTransferMsg");
    showMsg(msg, "");

    const client_id = ($("tClient").value || "").trim();
    if (!client_id) return showMsg(msg, "اختار العميل من الاقتراحات أولاً");

    const send_country = $("tSendCountry").value;
    const receive_country = $("tReceiveCountry").value;
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    const sendAmount = Number($("tSendAmount").value || 0);
    if (!sendAmount || sendAmount <= 0) return showMsg(msg, "اكتب مبلغ إرسال صحيح");

    const receiver_name = ($("tReceiverName").value || "").trim();
    if (!receiver_name) return showMsg(msg, "اكتب اسم المستلم");

    const payment_method = $("tPayMethod").value;

    const rcType = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
    const receiver_phone = ($("tReceiverPhone").value || "").trim();
    const receiver_bank_account = ($("tReceiverBank").value || "").trim();

    if (rcType === "phone" && !receiver_phone) return showMsg(msg, "اكتب رقم هاتف المستلم");
    if (rcType === "bank" && !receiver_bank_account) return showMsg(msg, "اكتب الحساب البنكي");

    const note = ($("tNote").value || "").trim();

    // rate manual optional
    let rate = Number(($("tRate").value || "").trim());
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }
    if (!rate || rate <= 0) return showMsg(msg, "مافي سعر صرف. أدخلو يدوي أو احفظو في Exchange Rates.");

    const receive_amount = sendAmount * rate;

    const order_ref = `NTO-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    showMsg(msg, "جارٍ الحفظ...");

    try {
      const created = await createTransfer({
        order_ref,
        client_id,
        send_country: normalizeCountry(send_country),
        receive_country: normalizeCountry(receive_country),
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

      // ✅ proof optional + multiple
      const proofFiles = Array.from($("tProof").files || []);
      if (proofFiles.length) {
        const paths = await uploadProofs(proofFiles, created.id);
        await updateTransfer(created.id, { proof_path: JSON.stringify(paths) });
      }

      // reset
      $("tClientSearch").value = "";
      $("tClient").value = "";
      $("selectedClientBadge").style.display = "none";
      $("tSendAmount").value = "";
      $("tRate").value = "";
      $("tReceivePreview").value = "";
      $("tReceiverName").value = "";
      $("tReceiverPhone").value = "";
      $("tReceiverBank").value = "";
      $("tNote").value = "";
      $("tProof").value = "";

      showMsg(msg, `تم حفظ التحويلة ✅ Order: ${order_ref}`);

      await reloadTransfersUI();
      await reloadDashboard();
    } catch (e) {
      showMsg(msg, e.message || "فشل حفظ التحويلة");
    }
  }

  // --- Init
  async function afterLogin() {
    $("loginCard").style.display = "none";
    $("app").style.display = "block";
    $("btnLogout").style.display = "inline-block";
    $("whoami").style.display = "inline-block";

    const { data } = await supabase.auth.getUser();
    $("whoami").textContent = data?.user?.email || "admin";

    CLIENTS_CACHE = await listClients();
    await reloadDashboard();
    await reloadClientsUI();
    await reloadTransfersUI();
    await reloadRatesUI();
  }

  async function init() {
    fillCountrySelect($("tSendCountry"));
    fillCountrySelect($("tReceiveCountry"));
    fillCountrySelect($("rFromCountry"));
    fillCountrySelect($("rToCountry"));

    setupTabs();
    setupReceiverToggle();
    attachClientAutocomplete();

    // login
    $("btnLogin").addEventListener("click", async () => {
      showMsg($("loginMsg"), "");
      const email = ($("loginEmail").value || "").trim();
      const password = $("loginPassword").value || "";
      try {
        await signIn(email, password);
        await afterLogin();
      } catch (e) {
        showMsg($("loginMsg"), e.message || "Login failed");
      }
    });

    // logout
    $("btnLogout").addEventListener("click", async () => {
      await signOut();
      location.reload();
    });

    // close client file
    $("btnCloseClientFile").addEventListener("click", () => {
      $("clientFile").style.display = "none";
    });

    // client search
    $("clientSearch").addEventListener("input", () => reloadClientsUI().catch(() => {}));
    $("btnReloadClients").addEventListener("click", () => reloadClientsUI().catch((e) => alert(e.message)));

    // save/new client
    $("btnSaveClient").addEventListener("click", () => onSaveClient().catch((e) => alert(e.message)));
    $("btnNewClient").addEventListener("click", () => {
      clearClientForm();
      showMsg($("clientMsg"), "");
    });

    // create transfer
    $("btnCreateTransfer").addEventListener("click", () => onCreateTransfer().catch((e) => alert(e.message)));

    // auto preview
    $("tSendAmount").addEventListener("input", () => updateReceivePreview().catch(() => {}));
    $("tRate").addEventListener("input", () => updateReceivePreview().catch(() => {}));
    $("tSendCountry").addEventListener("change", () => updateReceivePreview().catch(() => {}));
    $("tReceiveCountry").addEventListener("change", () => updateReceivePreview().catch(() => {}));

    // transfers filter
    $("filterStatus").addEventListener("change", () => reloadTransfersUI().catch(() => {}));
    $("btnReloadTransfers").addEventListener("click", () => reloadTransfersUI().catch((e) => alert(e.message)));

    // rates
    $("btnSaveRate").addEventListener("click", () => onSaveRate().catch((e) => alert(e.message)));
    $("btnReloadRates").addEventListener("click", () => reloadRatesUI().catch((e) => alert(e.message)));

    // modal
    $("btnCloseDetails").addEventListener("click", closeTransferDetails);
    $("detailsModal").addEventListener("click", (e) => {
      if (e.target.id === "detailsModal") closeTransferDetails();
    });

    // session
    const session = await getSession();
    if (session) await afterLogin();
  }

  init().catch((e) => alert(e.message || "Init error"));
})();
