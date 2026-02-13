(() => {
  // Prevent double init
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

  // ---- Countries (Fix America -> USA) ----
  const COUNTRIES = [
    { label: "مصر", value: "Egypt", currency: "EGP" },
    { label: "السودان", value: "Sudan", currency: "SDG" },
    { label: "USA", value: "USA", currency: "USD" },         // ✅ changed
    { label: "دول الخليج", value: "Gulf", currency: "AED" },
  ];

  // For old data compatibility: convert "America" to "USA"
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

  // ---- Supabase client ----
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

  // ---- Auth ----
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

  // ---- DB ----
  async function listClients() {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
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
    const { data, error } = await supabase
      .from("exchange_rates")
      .upsert([{ from_country, to_country, from_currency, to_currency, rate, active: true }], {
        onConflict: "from_country,to_country,from_currency,to_currency",
      })
      .select();
    if (error) throw error;
    return data;
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

  async function createTransfer(row) {
    // normalize old America value
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

  async function listTransfers({ status = "" } = {}) {
    let q = supabase
      .from("transfers")
      .select(
        "id,order_ref,status,send_country,receive_country,send_amount,send_currency,proof_path,created_at, clients(full_name)"
      )
      .order("created_at", { ascending: false });

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function listTransfersByClient(clientId) {
    const { data, error } = await supabase
      .from("transfers")
      .select("id,order_ref,status,send_country,receive_country,send_amount,send_currency,proof_path,created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ---- Proof upload (multiple) ----
  async function uploadProof(file, transferId) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${transferId}/${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const { error } = await supabase.storage.from("proofs").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }

  async function uploadProofs(files, transferId) {
    const paths = [];
    for (const f of files) {
      const p = await uploadProof(f, transferId);
      paths.push(p);
    }
    return paths;
  }

  async function getSignedProofUrl(path) {
    const { data, error } = await supabase.storage.from("proofs").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  function parseProofPaths(proof_path) {
    if (!proof_path) return [];
    // support old single path OR JSON array string
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

  // ---- Tabs ----
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
        const v = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
        if (phoneBox) phoneBox.style.display = v === "phone" ? "block" : "none";
        if (bankBox) bankBox.style.display = v === "bank" ? "block" : "none";
      });
    });
  }

  // ---- Client autocomplete (search + suggestions) ----
  let CLIENTS_CACHE = [];

  function getClientCode(row) {
    // try common fields; if none exist, fall back to id
    return row.client_code || row.reference_code || row.code || row.customer_code || row.id;
  }

  function attachClientAutocomplete() {
    const box = $("clientAutoBox");
    const input = $("tClientSearch");
    const hidden = $("tClient"); // hidden holds client_id
    const sug = $("clientSuggestions");

    if (!input || !hidden || !sug) return;

    const render = (items) => {
      sug.innerHTML = "";
      if (!items.length) {
        sug.style.display = "none";
        return;
      }
      for (const c of items.slice(0, 8)) {
        const code = getClientCode(c);
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
        });
        sug.appendChild(btn);
      }
      sug.style.display = "block";
    };

    const filterClients = (q) => {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      return CLIENTS_CACHE.filter((c) => {
        const code = String(getClientCode(c) || "").toLowerCase();
        return (
          String(c.full_name || "").toLowerCase().includes(s) ||
          String(c.email || "").toLowerCase().includes(s) ||
          String(c.phone || "").toLowerCase().includes(s) ||
          code.includes(s)
        );
      });
    };

    input.addEventListener("input", () => {
      // if user starts typing, clear old selected id until they choose
      hidden.value = "";
      render(filterClients(input.value));
    });

    // hide suggestions when clicking outside
    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) {
        sug.style.display = "none";
      }
    });
  }

  // ---- UI reloads ----
  async function reloadClients() {
    CLIENTS_CACHE = await listClients();

    // clients table list (optional)
    const tbody = $("clientsTbody");
    if (tbody) {
      const search = ($("clientSearch")?.value || "").trim().toLowerCase();
      const filtered = !search
        ? CLIENTS_CACHE
        : CLIENTS_CACHE.filter((r) => {
            const code = String(getClientCode(r) || "").toLowerCase();
            return (
              (r.full_name || "").toLowerCase().includes(search) ||
              (r.phone || "").toLowerCase().includes(search) ||
              (r.email || "").toLowerCase().includes(search) ||
              code.includes(search)
            );
          });

      tbody.innerHTML = filtered
        .map((r) => {
          const code = getClientCode(r);
          return `
          <tr>
            <td>${escapeHtml(r.full_name)}</td>
            <td>${escapeHtml(r.phone || "")}</td>
            <td>${escapeHtml(r.email || "")}</td>
            <td>${escapeHtml(code)}</td>
            <td><button class="btn" data-open-client="${r.id}">فتح</button></td>
          </tr>`;
        })
        .join("");

      document.querySelectorAll("button[data-open-client]").forEach((b) => {
        b.addEventListener("click", async () => {
          const id = b.getAttribute("data-open-client");
          await openClientFile(id, CLIENTS_CACHE.find((x) => x.id === id));
        });
      });
    }

    // refresh autocomplete suggestions source
    attachClientAutocomplete();
  }

  async function openClientFile(clientId, clientRow) {
    const fileBox = $("clientFile");
    const title = $("clientFileTitle");
    if (fileBox) fileBox.style.display = "block";
    if (title) title.textContent = `${clientRow?.full_name || ""} — معاملات العميل`;

    const rows = await listTransfersByClient(clientId);
    const tbody = $("clientTransfersTbody");
    if (!tbody) return;

    tbody.innerHTML = rows
      .map((r) => {
        const proofs = parseProofPaths(r.proof_path);
        const proofBtns = proofs
          .map((p, i) => `<button class="btn" data-proof="${escapeHtml(p)}">إثبات ${i + 1}</button>`)
          .join(" ");
        return `
        <tr>
          <td>${escapeHtml(r.order_ref)}</td>
          <td>${escapeHtml(normalizeCountry(r.send_country))} → ${escapeHtml(normalizeCountry(r.receive_country))}</td>
          <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
          <td>${escapeHtml(r.status)}</td>
          <td>${proofBtns}</td>
        </tr>`;
      })
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
    const status = $("filterStatus")?.value || "";
    const rows = await listTransfers({ status });

    const tbody = $("transfersTbody");
    if (!tbody) return;

    tbody.innerHTML = rows
      .map((r) => {
        const proofs = parseProofPaths(r.proof_path);
        const proofBtns = proofs
          .map((p, i) => `<button class="btn" data-proof="${escapeHtml(p)}">إثبات ${i + 1}</button>`)
          .join(" ");

        return `
        <tr>
          <td>${escapeHtml(r.order_ref)}</td>
          <td>${escapeHtml(r.clients?.full_name || "")}</td>
          <td>${escapeHtml(normalizeCountry(r.send_country))} → ${escapeHtml(normalizeCountry(r.receive_country))}</td>
          <td>${Number(r.send_amount).toFixed(2)} ${escapeHtml(r.send_currency)}</td>
          <td>
            <select data-status-id="${r.id}">
              ${["Pending","Processing","Completed","Cancelled"].map((s) => `<option value="${s}" ${s===r.status?"selected":""}>${s}</option>`).join("")}
            </select>
          </td>
          <td>${proofBtns}</td>
        </tr>`;
      })
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
    const tbody = $("ratesTbody");
    if (!tbody) return;

    tbody.innerHTML = rows
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

  // ---- Auto calculation (preview) ----
  async function updateAutoPreview() {
    const msg = $("newTransferMsg");
    const send_country = $("tSendCountry")?.value;
    const receive_country = $("tReceiveCountry")?.value;

    const sendAmount = Number($("tSendAmount")?.value || 0);
    const manualRateRaw = ($("tRate")?.value || "").trim();
    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    if (!msg) return;

    if (!from || !to || !sendAmount || sendAmount <= 0) {
      msg.textContent = "";
      return;
    }

    let rate = manualRateRaw ? Number(manualRateRaw) : null;
    if (!rate || rate <= 0) {
      // try fetch from saved rates
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }

    if (!rate || rate <= 0) {
      msg.textContent = "اكتب Rate يدوي أو احفظو في Exchange Rates.";
      return;
    }

    const receive = sendAmount * rate;
    msg.textContent = `تحويل تلقائي: ${sendAmount} ${from.currency} × ${rate} = ${receive.toFixed(2)} ${to.currency}`;
  }

  // ---- Actions ----
  async function onAddClient() {
    const full_name = ($("cName")?.value || "").trim();
    const phone = ($("cPhone")?.value || "").trim();
    const email = ($("cEmail")?.value || "").trim();

    if (!full_name) return alert("اكتب اسم العميل");

    await createClient({ full_name, phone: phone || null, email: email || null });

    if ($("cName")) $("cName").value = "";
    if ($("cPhone")) $("cPhone").value = "";
    if ($("cEmail")) $("cEmail").value = "";

    await reloadClients();
  }

  async function onSaveRate() {
    const from_country = $("rFromCountry")?.value;
    const to_country = $("rToCountry")?.value;
    const from = countryByValue(from_country);
    const to = countryByValue(to_country);
    const rate = Number($("rRate")?.value);

    const msg = $("ratesMsg");
    if (!from || !to) return msg && (msg.textContent = "اختار البلدان");
    if (!rate || rate <= 0) return msg && (msg.textContent = "اكتب Rate صحيح");

    try {
      await upsertRate({
        from_country: normalizeCountry(from_country),
        to_country: normalizeCountry(to_country),
        from_currency: from.currency,
        to_currency: to.currency,
        rate,
      });

      if ($("rRate")) $("rRate").value = "";
      if (msg) msg.textContent = "تم حفظ السعر ✅";
      await reloadRates();
    } catch (e) {
      if (msg) msg.textContent = e.message || "فشل الحفظ";
    }
  }

  async function onCreateTransfer() {
    const msgEl = $("newTransferMsg");
    if (msgEl) msgEl.textContent = "جارٍ الحفظ...";

    const client_id = ($("tClient")?.value || "").trim(); // hidden id
    const send_country = $("tSendCountry")?.value;
    const receive_country = $("tReceiveCountry")?.value;

    const sendAmount = Number($("tSendAmount")?.value);
    const receiver_name = ($("tReceiverName")?.value || "").trim();
    const payment_method = $("tPayMethod")?.value;

    const rcType = document.querySelector('input[name="rcType"]:checked')?.value || "phone";
    const receiver_phone = ($("tReceiverPhone")?.value || "").trim();
    const receiver_bank_account = ($("tReceiverBank")?.value || "").trim();

    const note = ($("tNote")?.value || "").trim();
    const proofFiles = Array.from($("tProof")?.files || []); // ✅ multiple

    const from = countryByValue(send_country);
    const to = countryByValue(receive_country);

    if (!client_id) return msgEl && (msgEl.textContent = "اكتب العميل واختره من الاقتراحات");
    if (!from || !to) return msgEl && (msgEl.textContent = "اختار البلدان");
    if (!sendAmount || sendAmount <= 0) return msgEl && (msgEl.textContent = "اكتب مبلغ إرسال صحيح");
    if (!receiver_name) return msgEl && (msgEl.textContent = "اكتب اسم المستلم");
    if (rcType === "phone" && !receiver_phone) return msgEl && (msgEl.textContent = "اكتب رقم هاتف المستلم");
    if (rcType === "bank" && !receiver_bank_account) return msgEl && (msgEl.textContent = "اكتب الحساب البنكي");

    let rate = Number(($("tRate")?.value || "").trim());
    if (!rate || rate <= 0) {
      rate = await getRate({
        from_country: send_country,
        to_country: receive_country,
        from_currency: from.currency,
        to_currency: to.currency,
      });
    }
    if (!rate || rate <= 0) return msgEl && (msgEl.textContent = "مافي سعر صرف. أدخلو يدوي أو احفظو في Exchange Rates.");

    const receive_amount = sendAmount * rate;
    const order_ref = `NTO-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

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

      if (proofFiles.length) {
        const paths = await uploadProofs(proofFiles, created.id);
        // store as JSON array string in proof_path (no DB changes needed)
        await updateTransfer(created.id, { proof_path: JSON.stringify(paths) });
      }

      // reset
      if ($("tSendAmount")) $("tSendAmount").value = "";
      if ($("tRate")) $("tRate").value = "";
      if ($("tReceiverName")) $("tReceiverName").value = "";
      if ($("tReceiverPhone")) $("tReceiverPhone").value = "";
      if ($("tReceiverBank")) $("tReceiverBank").value = "";
      if ($("tNote")) $("tNote").value = "";
      if ($("tProof")) $("tProof").value = "";
      if ($("tClientSearch")) $("tClientSearch").value = "";
      if ($("tClient")) $("tClient").value = "";

      if (msgEl) msgEl.textContent = `تم حفظ التحويلة ✅ Order: ${order_ref}`;
      await reloadTransfers();
      await reloadClients();
    } catch (e) {
      if (msgEl) msgEl.textContent = e.message || "فشل حفظ التحويلة";
    }
  }

  async function afterLogin() {
    if ($("loginCard")) $("loginCard").style.display = "none";
    if ($("app")) $("app").style.display = "block";
    if ($("btnLogout")) $("btnLogout").style.display = "inline-block";

    const { data } = await supabase.auth.getUser();
    if ($("whoami")) $("whoami").textContent = data?.user?.email || "admin";

    await reloadClients();
    await reloadTransfers();
    await reloadRates();
  }

  async function init() {
    // countries
    fillCountrySelect($("tSendCountry"));
    fillCountrySelect($("tReceiveCountry"));
    fillCountrySelect($("rFromCountry"));
    fillCountrySelect($("rToCountry"));

    setupTabs();
    setupReceiverToggle();

    // login
    $("btnLogin")?.addEventListener("click", async () => {
      if ($("loginMsg")) $("loginMsg").textContent = "";
      const email = ($("loginEmail")?.value || "").trim();
      const password = $("loginPassword")?.value || "";
      try {
        await signIn(email, password);
        await afterLogin();
      } catch (e) {
        if ($("loginMsg")) $("loginMsg").textContent = e.message || "Login failed";
      }
    });

    $("btnLogout")?.addEventListener("click", async () => {
      await signOut();
      location.reload();
    });

    // client add
    $("btnAddClient")?.addEventListener("click", () => onAddClient().catch((e) => alert(e.message || "Error")));
    $("btnReloadClients")?.addEventListener("click", () => reloadClients().catch((e) => alert(e.message || "Error")));
    $("clientSearch")?.addEventListener("input", () => reloadClients().catch(() => {}));

    // new transfer
    $("btnCreateTransfer")?.addEventListener("click", () => onCreateTransfer().catch((e) => alert(e.message || "Error")));
    $("btnReloadTransfers")?.addEventListener("click", () => reloadTransfers().catch((e) => alert(e.message || "Error")));
    $("filterStatus")?.addEventListener("change", () => reloadTransfers().catch(() => {}));

    // auto calc listeners ✅
    $("tSendAmount")?.addEventListener("input", () => updateAutoPreview().catch(() => {}));
    $("tRate")?.addEventListener("input", () => updateAutoPreview().catch(() => {}));
    $("tSendCountry")?.addEventListener("change", () => updateAutoPreview().catch(() => {}));
    $("tReceiveCountry")?.addEventListener("change", () => updateAutoPreview().catch(() => {}));

    // rates
    $("btnSaveRate")?.addEventListener("click", () => onSaveRate().catch((e) => alert(e.message || "Error")));
    $("btnReloadRates")?.addEventListener("click", () => reloadRates().catch((e) => alert(e.message || "Error")));

    // session
    const session = await getSession();
    if (session) await afterLogin();
  }

  init().catch((e) => alert(e.message || "Init error"));
})();
