const COUNTRIES = [
  { name: "USA", currency: "USD" },
  { name: "Egypt", currency: "EGP" },
  { name: "Sudan", currency: "SDG" },
  { name: "Canada", currency: "CAD" },
  { name: "Gulf", currency: "AED" }
];

const STORAGE_KEYS = {
  clients: "nile.clients",
  transfers: "nile.transfers"
};

const state = {
  clients: load(STORAGE_KEYS.clients, []),
  transfers: load(STORAGE_KEYS.transfers, [])
};

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

const clientForm = document.getElementById("clientForm");
const orderForm = document.getElementById("orderForm");

const clientsBody = document.getElementById("clientsBody");
const transfersBody = document.getElementById("transfersBody");
const historyBody = document.getElementById("historyBody");

const clientSelect = document.getElementById("clientSelect");
const sendCountry = document.getElementById("sendCountry");
const receiveCountry = document.getElementById("receiveCountry");
const receiverContactType = document.getElementById("receiverContactType");
const receiverPhoneField = document.getElementById("receiverPhoneField");
const receiverBankField = document.getElementById("receiverBankField");
const ratePreview = document.getElementById("ratePreview");
const selectedClientInfo = document.getElementById("selectedClientInfo");

const profileDialog = document.getElementById("profileDialog");
const profileName = document.getElementById("profileName");
const profileMeta = document.getElementById("profileMeta");
const closeDialog = document.getElementById("closeDialog");
const clientSearch = document.getElementById("clientSearch");

const statClients = document.getElementById("statClients");
const statTransfers = document.getElementById("statTransfers");
const statPending = document.getElementById("statPending");

initialize();

function initialize() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  setupCountryOptions(sendCountry);
  setupCountryOptions(receiveCountry);

  clientForm.addEventListener("submit", onSaveClient);
  orderForm.addEventListener("submit", onSubmitOrder);
  closeDialog.addEventListener("click", () => profileDialog.close());
  clientSearch.addEventListener("input", renderClients);

  clientSelect.addEventListener("change", updateSelectedClient);
  receiverContactType.addEventListener("change", updateReceiverContactFields);
  [sendCountry, receiveCountry, orderForm.sendAmount, orderForm.manualRate].forEach((el) => {
    el.addEventListener("input", previewRate);
  });

  updateReceiverContactFields();
  renderAll();
}

function switchTab(tabId) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabId));
  panels.forEach((panel) => panel.classList.toggle("active", panel.id === tabId));
}

function setupCountryOptions(selectEl) {
  selectEl.innerHTML = '<option value="">Select country</option>';
  COUNTRIES.forEach((country) => {
    const option = document.createElement("option");
    option.value = country.name;
    option.textContent = `${country.name} (${country.currency})`;
    selectEl.append(option);
  });
}

function onSaveClient(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const client = {
    id: crypto.randomUUID(),
    ref: nextClientRef(),
    fullName: form.get("fullName").trim(),
    address: form.get("address").trim(),
    email: form.get("email").trim(),
    phone: form.get("phone").trim(),
    createdAt: new Date().toISOString()
  };

  state.clients.unshift(client);
  persist(STORAGE_KEYS.clients, state.clients);
  event.target.reset();
  renderAll();
  alert(`Client saved with reference: ${client.ref}`);
}

async function onSubmitOrder(event) {
  event.preventDefault();
  const form = new FormData(event.target);

  const clientId = form.get("clientId");
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) {
    alert("Please choose a valid client.");
    return;
  }

  const send = form.get("sendCountry");
  const receive = form.get("receiveCountry");
  if (send === receive) {
    alert("Send and receive countries must be different.");
    return;
  }

  const sendAmount = Number(form.get("sendAmount"));
  const manualRate = Number(form.get("manualRate"));
  const sendCurrency = findCurrency(send);
  const receiveCurrency = findCurrency(receive);
  if (!manualRate || manualRate <= 0) {
    alert("Please enter a valid manual exchange rate.");
    return;
  }

  const proofFile = orderForm.proof.files?.[0];
  if (!proofFile) {
    alert("Please upload proof of payment image.");
    return;
  }

  const proofDataUrl = await fileToDataUrl(proofFile);

  const selectedContactType = form.get("receiverContactType");
  const receiverPhone = form.get("receiverPhone").trim();
  const receiverBankAccount = form.get("receiverBankAccount").trim();
  if (selectedContactType === "phone" && !receiverPhone) {
    alert("Please enter the receiver phone number.");
    return;
  }
  if (selectedContactType === "bank" && !receiverBankAccount) {
    alert("Please enter the receiver bank account.");
    return;
  }

  const receiveAmount = sendAmount * manualRate;
  const transfer = {
    id: crypto.randomUUID(),
    orderRef: nextOrderRef(),
    clientId,
    sendCountry: send,
    receiveCountry: receive,
    sendCurrency,
    receiveCurrency,
    sendAmount,
    receiveAmount,
    rate: manualRate,
    paymentMethod: form.get("paymentMethod"),
    proofImageName: proofFile.name,
    proofImageDataUrl: proofDataUrl,
    receiverContactType: selectedContactType,
    receiverName: form.get("receiverName").trim(),
    receiverPhone,
    receiverBankAccount,
    note: form.get("note").trim(),
    status: "Pending",
    createdAt: new Date().toISOString()
  };

  state.transfers.unshift(transfer);
  persist(STORAGE_KEYS.transfers, state.transfers);
  event.target.reset();
  selectedClientInfo.textContent = "Select a client to load details.";
  ratePreview.textContent = "Set countries and amount to preview conversion.";
  updateReceiverContactFields();
  renderAll();
  switchTab("dashboard");
}

function renderAll() {
  renderClients();
  renderClientSelect();
  renderTransfers();
  renderStats();
}

function renderClients() {
  const query = clientSearch.value.trim().toLowerCase();
  const clients = state.clients.filter((client) => {
    if (!query) return true;
    return [client.ref, client.fullName, client.email, client.phone].join(" ").toLowerCase().includes(query);
  });

  if (!clients.length) {
    clientsBody.innerHTML = '<tr><td colspan="5" class="muted">No clients found.</td></tr>';
    return;
  }

  clientsBody.innerHTML = clients
    .map(
      (client) => `
      <tr>
        <td>${client.ref}</td>
        <td>${client.fullName}</td>
        <td>${client.email}</td>
        <td>${client.phone}</td>
        <td><button data-profile="${client.id}">Profile</button></td>
      </tr>`
    )
    .join("");

  clientsBody.querySelectorAll("button[data-profile]").forEach((btn) => {
    btn.addEventListener("click", () => openProfile(btn.dataset.profile));
  });
}

function renderClientSelect() {
  clientSelect.innerHTML = '<option value="">Choose client</option>';
  state.clients.forEach((client) => {
    const option = document.createElement("option");
    option.value = client.id;
    option.textContent = `${client.ref} — ${client.fullName}`;
    clientSelect.append(option);
  });
}

function renderTransfers() {
  if (!state.transfers.length) {
    transfersBody.innerHTML = '<tr><td colspan="7" class="muted">No transfers yet.</td></tr>';
    return;
  }

  transfersBody.innerHTML = state.transfers
    .map((transfer) => {
      const client = state.clients.find((c) => c.id === transfer.clientId);
      return `
      <tr>
        <td>${transfer.orderRef}</td>
        <td>${client ? client.fullName : "Client deleted"}</td>
        <td>${transfer.sendCountry} → ${transfer.receiveCountry}</td>
        <td>${money(transfer.sendAmount, transfer.sendCurrency)} → ${money(transfer.receiveAmount, transfer.receiveCurrency)}</td>
        <td>${transfer.paymentMethod}</td>
        <td>
          <span class="status ${transfer.status}">${transfer.status}</span><br />
          <small class="muted">Rate: ${transfer.rate} | Proof: ${transfer.proofImageName || "Image"}</small><br />
          <small class="muted">Receiver: ${transfer.receiverName}</small><br />
          <small class="muted">${formatReceiverContact(transfer)}</small>
          ${
            transfer.proofImageDataUrl
              ? `<br /><a href="${transfer.proofImageDataUrl}" target="_blank" rel="noopener">View proof image</a>`
              : ""
          }
        </td>
        <td>
          <select data-status="${transfer.id}">
            ${["Pending", "Processing", "Completed", "Cancelled"]
              .map((status) => `<option ${status === transfer.status ? "selected" : ""}>${status}</option>`)
              .join("")}
          </select>
        </td>
      </tr>`;
    })
    .join("");

  transfersBody.querySelectorAll("select[data-status]").forEach((selectEl) => {
    selectEl.addEventListener("change", () => {
      const transfer = state.transfers.find((item) => item.id === selectEl.dataset.status);
      transfer.status = selectEl.value;
      persist(STORAGE_KEYS.transfers, state.transfers);
      renderTransfers();
      renderStats();
    });
  });
}

function renderStats() {
  statClients.textContent = state.clients.length;
  statTransfers.textContent = state.transfers.length;
  statPending.textContent = state.transfers.filter((t) => ["Pending", "Processing"].includes(t.status)).length;
}

function updateSelectedClient() {
  const client = state.clients.find((c) => c.id === clientSelect.value);
  if (!client) {
    selectedClientInfo.textContent = "Select a client to load details.";
    return;
  }
  selectedClientInfo.textContent = `${client.ref} | ${client.fullName} | ${client.email} | ${client.phone}`;
}

function previewRate() {
  const send = sendCountry.value;
  const receive = receiveCountry.value;
  const amount = Number(orderForm.sendAmount.value || 0);
  const rate = Number(orderForm.manualRate.value || 0);
  if (!send || !receive || !amount || !rate) {
    ratePreview.textContent = "Set countries and amount to preview conversion.";
    return;
  }
  if (send === receive) {
    ratePreview.textContent = "Send and receive countries cannot be the same.";
    return;
  }

  const sendCurrency = findCurrency(send);
  const receiveCurrency = findCurrency(receive);
  const receiveAmount = amount * rate;
  ratePreview.textContent = `Rate: 1 ${sendCurrency} = ${rate} ${receiveCurrency} | Estimated receive: ${money(
    receiveAmount,
    receiveCurrency
  )}`;
}

function openProfile(clientId) {
  const client = state.clients.find((c) => c.id === clientId);
  if (!client) return;

  profileName.textContent = `${client.fullName} (${client.ref})`;
  profileMeta.textContent = `${client.email} | ${client.phone} | ${client.address}`;

  const history = state.transfers.filter((transfer) => transfer.clientId === clientId);
  if (!history.length) {
    historyBody.innerHTML = '<tr><td colspan="5" class="muted">No transactions for this client.</td></tr>';
  } else {
    historyBody.innerHTML = history
      .map(
        (transfer) => `
      <tr>
        <td>${transfer.orderRef}</td>
        <td>${transfer.sendCountry} → ${transfer.receiveCountry}</td>
        <td>${money(transfer.sendAmount, transfer.sendCurrency)} → ${money(transfer.receiveAmount, transfer.receiveCurrency)}</td>
        <td><span class="status ${transfer.status}">${transfer.status}</span></td>
        <td>${new Date(transfer.createdAt).toLocaleString()}</td>
      </tr>`
      )
      .join("");
  }

  profileDialog.showModal();
}

function nextClientRef() {
  const max = state.clients
    .map((c) => Number((c.ref || "").split("-")[1]))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `NTC-${String(max + 1).padStart(4, "0")}`;
}

function nextOrderRef() {
  const max = state.transfers
    .map((t) => Number((t.orderRef || "").split("-")[1]))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `NTO-${String(max + 1).padStart(5, "0")}`;
}

function findCurrency(countryName) {
  return COUNTRIES.find((country) => country.name === countryName)?.currency || "";
}

function money(value, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function updateReceiverContactFields() {
  const selected = receiverContactType.value;
  const phoneInput = orderForm.receiverPhone;
  const bankInput = orderForm.receiverBankAccount;

  receiverPhoneField.classList.toggle("hidden", selected !== "phone");
  receiverBankField.classList.toggle("hidden", selected !== "bank");

  phoneInput.required = selected === "phone";
  bankInput.required = selected === "bank";

  if (selected !== "phone") phoneInput.value = "";
  if (selected !== "bank") bankInput.value = "";
}

function formatReceiverContact(transfer) {
  if (transfer.receiverContactType === "bank") {
    return `Bank: ${transfer.receiverBankAccount}`;
  }
  return `Phone: ${transfer.receiverPhone}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
