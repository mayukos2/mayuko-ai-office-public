const TASK_STATUSES = ["未着手", "相談中", "素材待ち", "Codex投入待ち", "実務中", "確認待ち", "完了", "保留"];
const ASSET_VERSION = "20260623-public-gas-live1";
const MEMO_STORAGE_KEY = "mayuko-ai-office.public.memo.v1";
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbzpyQd8AlufvsC0zy4E5g8A47dQWYrbqpn8XZyjoAFLxE6Pjz-xY99WOyDOO4SEZjNh/exec";
const GAS_STATUS_ENDPOINT = GAS_ENDPOINT;
const CHARACTER_PLACEHOLDER = "assets/characters/employee-placeholder.png";

const FLOORS = [
  {
    id: "floor-01",
    name: "1F: 受付・案内フロア",
    short: "1F",
    room: "受付・案内",
    background: "assets/office/floor-01-reception.png",
    agentIds: ["ceo-assistant", "emergency-responder"]
  },
  {
    id: "floor-02",
    name: "2F: 制作・開発フロア",
    short: "2F",
    room: "制作・開発",
    background: "assets/office/floor-02-workroom.png",
    agentIds: ["editor-chief", "codex-translator", "world-designer"]
  },
  {
    id: "floor-03",
    name: "3F: 商品・戦略フロア",
    short: "3F",
    room: "商品・戦略",
    background: "assets/office/floor-03-strategy.png",
    agentIds: ["product-planner", "investment-manager"]
  },
  {
    id: "floor-04",
    name: "4F: 整理・回復・内観フロア",
    short: "4F",
    room: "整理・回復・内観",
    background: "assets/office/floor-03-lounge.png",
    agentIds: ["archive-clerk", "energy-care", "inner-guide"]
  }
];

const state = {
  agents: [],
  tasks: [],
  activeAgentId: "",
  activeFloorId: FLOORS[0].id,
  taskFilter: "all"
};

const els = {
  dataSourceNote: document.querySelector("#dataSourceNote"),
  agentCount: document.querySelector("#agentCount"),
  consultingCount: document.querySelector("#consultingCount"),
  codexQueueCount: document.querySelector("#codexQueueCount"),
  doneCount: document.querySelector("#doneCount"),
  floorTabs: document.querySelector("#floorTabs"),
  officeStage: document.querySelector("#officeStage"),
  agentDetail: document.querySelector("#agentDetail"),
  taskList: document.querySelector("#taskList")
};

init();

async function init() {
  const [agents, tasks] = await Promise.all([
    loadJson("data/agents.json", []),
    loadJson("data/tasks.json", [])
  ]);

  const syncedTasks = await loadSyncedTasks(tasks);
  state.agents = agents;
  state.tasks = syncedTasks.tasks;
  state.activeAgentId = state.agents[0]?.id || "";
  state.activeFloorId = getAgentFloorId(state.agents[0]) || FLOORS[0].id;
  els.dataSourceNote.textContent = syncedTasks.source === "gas" ? "スプシ進捗表示中" : "公開用データ表示中";

  setupFilters();
  render();
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(path);
    return await response.json();
  } catch {
    els.dataSourceNote.textContent = "データ読み込みに失敗しました";
    return fallback;
  }
}

async function loadSyncedTasks(fallbackTasks) {
  if (!GAS_STATUS_ENDPOINT) {
    return { source: "json", tasks: fallbackTasks };
  }

  try {
    const rows = await loadStatusRowsByJsonp(GAS_STATUS_ENDPOINT);
    const tasks = rows.map(statusRowToTask).filter(Boolean);
    return { source: tasks.length ? "gas" : "json", tasks: tasks.length ? tasks : fallbackTasks };
  } catch {
    return { source: "json", tasks: fallbackTasks };
  }
}

function loadStatusRowsByJsonp(endpoint) {
  return new Promise((resolve, reject) => {
    const callbackName = `mayukoOfficeStatus_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const separator = endpoint.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("status timeout"));
    }, 8000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(Array.isArray(data?.status) ? data.status : []);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("status load error"));
    };

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    script.src = `${endpoint}${separator}callback=${encodeURIComponent(callbackName)}`;
    document.head.appendChild(script);
  });
}

function statusRowToTask(row) {
  const agentId = row.agentId || findAgentIdByName(row["担当AI"]);
  if (!agentId) return null;
  const status = row["状態"] || "未着手";
  const taskTitle = row["タスク名"] || "進捗確認";
  return {
    id: `office-status-${agentId}`,
    title: taskTitle,
    ownerAgentId: agentId,
    status,
    codexReady: row["Codex投入"] === "必要" || status === "Codex投入待ち",
    summary: row["今どこまで"] || taskTitle,
    waitingFor: row["何待ち"] || "",
    memo: row["私のメモ"] || "",
    nextAction: row["何待ち"] || "進捗を確認する",
    lastUpdated: row["最終更新"] || row["最終メモ日時"] || ""
  };
}

function setupFilters() {
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.taskFilter = button.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach((item) => item.classList.toggle("is-active", item === button));
      renderTasks();
    });
  });
}

function render() {
  renderKpis();
  renderOffice();
  renderDetail();
  renderTasks();
}

function renderKpis() {
  els.agentCount.textContent = state.agents.length;
  els.consultingCount.textContent = state.tasks.filter((task) => task.status === "相談中").length;
  els.codexQueueCount.textContent = state.tasks.filter((task) => task.status === "Codex投入待ち" || task.codexReady).length;
  els.doneCount.textContent = state.tasks.filter((task) => task.status === "完了").length;
}

function renderOffice() {
  const floor = getActiveFloor();
  const agents = floor.agentIds.map((id) => state.agents.find((agent) => agent.id === id)).filter(Boolean);

  els.floorTabs.innerHTML = FLOORS.map((item) => `
    <button class="floor-tab ${item.id === floor.id ? "is-active" : ""}" type="button" data-floor-id="${item.id}">
      <span>${item.short}</span>${escapeHtml(item.room)}
    </button>
  `).join("");

  els.officeStage.innerHTML = `
    <img class="office-bg" src="${versionAsset(floor.background)}" alt="">
    <span class="floor-label">${escapeHtml(floor.name)}</span>
    <div class="agent-layer">
      ${agents.map(renderAgent).join("")}
    </div>
  `;

  els.floorTabs.querySelectorAll(".floor-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeFloorId = button.dataset.floorId;
      const nextFloor = getActiveFloor();
      if (!nextFloor.agentIds.includes(state.activeAgentId)) {
        state.activeAgentId = nextFloor.agentIds[0] || state.activeAgentId;
      }
      renderOffice();
      renderDetail();
    });
  });

  els.officeStage.querySelectorAll(".agent-pin").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeAgentId = button.dataset.agentId;
      state.activeFloorId = getAgentFloorId(getActiveAgent()) || state.activeFloorId;
      renderOffice();
      renderDetail();
    });
  });
}

function renderAgent(agent) {
  const stats = getAgentStats(agent.id);
  const position = getAgentPosition(agent);
  const classes = [
    "agent-pin",
    agent.id === state.activeAgentId ? "is-active" : "",
    stats.consulting ? "is-consulting" : "",
    stats.codex ? "has-codex" : "",
    stats.done ? "has-done" : ""
  ].filter(Boolean).join(" ");
  const image = getAgentImage(agent, stats);
  return `
    <button class="${classes}" type="button" data-agent-id="${agent.id}" style="--x:${position.x}; --y:${position.y}; --size:${position.size}; --label-y:${position.labelY}; --speech-y:${position.speechY}" aria-label="${escapeHtml(agent.name)}を開く">
      ${stats.consulting ? `<span class="speech">相談中</span>` : ""}
      ${stats.codex ? `<span class="badge">${stats.codex}</span>` : ""}
      ${stats.done ? `<span class="done">✓</span>` : ""}
      <img class="agent-image" src="${escapeHtml(versionAsset(image))}" alt="">
      <span class="name-label">${escapeHtml(agent.name)}</span>
    </button>
  `;
}

function renderDetail() {
  const agent = getActiveAgent();
  if (!agent) return;
  const stats = getAgentStats(agent.id);
  const tasks = state.tasks.filter((task) => task.ownerAgentId === agent.id);
  const mainTask = tasks[0];
  const chatLabel = agent.chatUrl ? "チャットを開く" : "チャットURL未設定";

  els.agentDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="eyebrow">${escapeHtml(agent.department)}</p>
        <h2>${escapeHtml(agent.name)}</h2>
      </div>
      <span class="status-chip">${escapeHtml(getMainStatus(tasks))}</span>
    </div>
    <div class="mini-stats">
      <span>相談中 ${stats.consulting}</span>
      <span>Codex待ち ${stats.codex}</span>
      <span>完了 ${stats.done}</span>
    </div>
    <section class="progress-card" aria-label="現在の進捗">
      <div>
        <span>今どこまで</span>
        <strong>${escapeHtml(mainTask?.summary || "今の進捗はまだ登録されていません。")}</strong>
      </div>
      <div>
        <span>何待ち</span>
        <strong>${escapeHtml(getWaitingText(mainTask))}</strong>
      </div>
      <div>
        <span>私のメモ</span>
        <textarea class="memo-input" id="memoInput" rows="3" placeholder="今のメモを書く">${escapeHtml(getSavedMemo(agent.id, mainTask?.memo))}</textarea>
        <button class="memo-button" type="button" id="memoButton">${GAS_ENDPOINT ? "メモを送信" : "メモを保存"}</button>
      </div>
      <div>
        <span>最終更新</span>
        <strong>${escapeHtml(mainTask?.lastUpdated || "未更新")}</strong>
      </div>
    </section>
    ${renderAgentProgressList(tasks)}
    <div class="chat-row">
      <input type="text" readonly value="${escapeHtml(agent.chatUrl || "未設定")}">
      <button type="button" ${agent.chatUrl ? "" : "disabled"} id="openChatButton">${chatLabel}</button>
    </div>
  `;

  const openButton = document.querySelector("#openChatButton");
  if (openButton && agent.chatUrl) {
    openButton.addEventListener("click", () => window.open(agent.chatUrl, "_blank", "noopener"));
  }

  const memoButton = document.querySelector("#memoButton");
  const memoInput = document.querySelector("#memoInput");
  if (memoButton && memoInput) {
    memoButton.addEventListener("click", () => handleMemoSubmit(agent, mainTask, memoInput.value));
  }
}

function renderTasks() {
  const tasks = state.tasks.filter((task) => state.taskFilter === "all" || task.status === state.taskFilter);
  els.taskList.innerHTML = tasks.map((task) => {
    const agent = state.agents.find((item) => item.id === task.ownerAgentId);
    return `
      <article class="task-card status-${statusSlug(task.status)}">
        <div>
          <span class="task-status">${escapeHtml(task.status)}</span>
          <h3>${escapeHtml(task.title)}</h3>
        </div>
        <p>${escapeHtml(task.summary)}</p>
        <small>${escapeHtml(agent?.name || "担当未設定")} / ${escapeHtml(task.nextAction || "次の一手を確認")}</small>
      </article>
    `;
  }).join("") || `<p class="empty">該当する進捗はありません。</p>`;
}

function renderAgentProgressList(tasks) {
  if (tasks.length <= 1) return "";
  return `
    <div class="agent-progress-list">
      ${tasks.map((task) => `
        <article>
          <span>${escapeHtml(task.status)}</span>
          <strong>${escapeHtml(task.title)}</strong>
          <p>${escapeHtml(task.summary)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function getWaitingText(task) {
  if (!task) return "報告待ち";
  if (task.waitingFor) return task.waitingFor;
  if (task.status === "素材待ち") return "素材待ち";
  if (task.status === "Codex投入待ち" || task.codexReady) return "Codex投入待ち";
  if (task.status === "確認待ち") return "確認待ち";
  if (task.status === "未着手") return "着手待ち";
  if (task.status === "相談中") return "相談の続き待ち";
  if (task.status === "実務中") return "作業中";
  if (task.status === "完了") return "完了";
  if (task.status === "保留") return "再開待ち";
  return task.status;
}

function getSavedMemo(agentId, fallback = "") {
  try {
    const data = JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY) || "{}");
    return data[agentId] || fallback || "";
  } catch {
    return fallback || "";
  }
}

function saveMemo(agentId, memo) {
  const data = (() => {
    try {
      return JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  })();
  data[agentId] = memo;
  localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(data));
}

async function handleMemoSubmit(agent, task, memo) {
  saveMemo(agent.id, memo);
  if (!GAS_ENDPOINT) {
    alert("メモをこのスマホに保存しました。スプレッドシート連携はGAS URLを設定したら有効になります。");
    return;
  }

  await fetch(GAS_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      agentId: agent.id,
      agentName: agent.name,
      taskTitle: task?.title || "",
      status: task?.status || "",
      memo,
      sentAt: new Date().toISOString()
    })
  });
  alert("メモを送信しました。");
}

function getActiveFloor() {
  return FLOORS.find((floor) => floor.id === state.activeFloorId) || FLOORS[0];
}

function getActiveAgent() {
  return state.agents.find((agent) => agent.id === state.activeAgentId) || state.agents[0];
}

function findAgentIdByName(name) {
  return state.agents.find((agent) => agent.name === name)?.id || "";
}

function getAgentFloorId(agent) {
  if (!agent) return "";
  return FLOORS.find((floor) => floor.name === agent.floor || floor.agentIds.includes(agent.id))?.id || "";
}

function getAgentPosition(agent) {
  return {
    x: Number(agent.position?.x ?? 50),
    y: Number(agent.position?.y ?? 84),
    size: Number(agent.position?.size ?? 14),
    labelY: Number(agent.position?.labelY ?? 76),
    speechY: Number(agent.position?.speechY ?? 24)
  };
}

function getAgentImage(agent, stats) {
  const stateName = getVisualState(stats);
  return agent.characterImages?.[stateName] || agent.characterImage || CHARACTER_PLACEHOLDER;
}

function getVisualState(stats) {
  if (stats.codex) return "codex";
  if (stats.consulting) return "talking";
  if (stats.working) return "working";
  if (stats.done) return "done";
  return "idle";
}

function getAgentStats(agentId) {
  const tasks = state.tasks.filter((task) => task.ownerAgentId === agentId);
  return {
    consulting: tasks.filter((task) => task.status === "相談中").length,
    codex: tasks.filter((task) => task.status === "Codex投入待ち" || task.codexReady).length,
    working: tasks.filter((task) => ["素材待ち", "実務中", "確認待ち"].includes(task.status)).length,
    done: tasks.filter((task) => task.status === "完了").length
  };
}

function getMainStatus(tasks) {
  if (!tasks.length) return "通常";
  const priority = ["Codex投入待ち", "相談中", "実務中", "確認待ち", "素材待ち", "未着手", "保留", "完了"];
  return priority.find((status) => tasks.some((task) => task.status === status)) || tasks[0].status;
}

function versionAsset(path) {
  if (!path || /^https?:/i.test(path) || path.includes("?")) return path;
  return `${path}?v=${ASSET_VERSION}`;
}

function statusSlug(status) {
  return TASK_STATUSES.indexOf(status) >= 0 ? `s${TASK_STATUSES.indexOf(status)}` : "unknown";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
