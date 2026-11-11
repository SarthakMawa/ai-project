"use strict";

(() => {
  const directions = ["north", "east", "south", "west"];
  const stages = [["north", "south"], ["east", "west"]];
  const amberSeconds = 3;
  const allRedSeconds = 1;
  const inputs = new Map(
    directions.map((direction) => [direction, document.querySelector(`[data-direction="${direction}"]`)])
  );
  const activeIntersection = { lat: 28.6139, lon: 77.2090 };
  const timeProfiles = [
    { id: "night", label: "Night low-flow", start: 0, end: 6, cycle: 80, minimum: 20, split: 0.5, demand: 0.35 },
    { id: "morning", label: "Morning peak", start: 6, end: 10, cycle: 120, minimum: 28, split: 0.58, demand: 1.25 },
    { id: "midday", label: "Midday", start: 10, end: 17, cycle: 100, minimum: 24, split: 0.52, demand: 0.78 },
    { id: "evening", label: "Evening peak", start: 17, end: 22, cycle: 130, minimum: 30, split: 0.57, demand: 1.3 },
    { id: "late", label: "Late evening", start: 22, end: 24, cycle: 90, minimum: 22, split: 0.5, demand: 0.48 }
  ];
  let running = true;
  let mode = "fixed";
  let activeProfile = null;
  let phaseIndex = 0;
  let phaseSecondsLeft = 0;
  let signalState = "green";
  let phaseDurations = { north: 32, south: 32, east: 40, west: 40 };
  let toastTimer;
  const scene = document.querySelector(".intersection-scene");

  function getIndiaTime() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  }

  function isIndiaWeekend() {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "short"
    }).format(new Date());
    return weekday === "Sun" || weekday === "Sat";
  }

  function getProfile() {
    const { hour } = getIndiaTime();
    return timeProfiles.find((profile) => hour >= profile.start && hour < profile.end) || timeProfiles[0];
  }

  function getCycleLength() {
    return activeProfile ? activeProfile.cycle : 100;
  }

  function getGreenBudget() {
    return getCycleLength() - stages.length * (amberSeconds + allRedSeconds);
  }

  function getCounts() {
    return Object.fromEntries(directions.map((direction) => {
      const value = Number(inputs.get(direction).value);
      return [direction, Number.isFinite(value) ? Math.min(999, Math.max(0, value)) : 0];
    }));
  }

  function distributeGreenTimes(phaseWeights) {
    const profile = activeProfile || getProfile();
    const greenBudget = getGreenBudget();
    const minimumGreen = profile.minimum;
    const maximumGreen = greenBudget - minimumGreen;
    const totalWeight = phaseWeights[0] + phaseWeights[1];
    const split = totalWeight > 0
      ? phaseWeights[0] / totalWeight
      : profile.split;
    const northSouth = Math.round(Math.max(minimumGreen, Math.min(maximumGreen, greenBudget * split)));
    const eastWest = greenBudget - northSouth;
    return { north: northSouth, south: northSouth, east: eastWest, west: eastWest };
  }

  function allocateGreenTimes(counts) {
    const profile = activeProfile || getProfile();
    if (mode === "fixed") {
      return distributeGreenTimes([profile.split, 1 - profile.split]);
    }
    return distributeGreenTimes([
      counts.north + counts.south,
      counts.east + counts.west
    ]);
  }

  function updateOptimizer() {
    const counts = getCounts();
    const recommendations = allocateGreenTimes(counts);
    const largest = Math.max(1, ...Object.values(counts));
    directions.forEach((direction) => {
      const safeCount = Math.min(999, Math.max(0, Math.round(counts[direction])));
      document.getElementById(`count-${direction}`).textContent = String(safeCount);
      document.getElementById(`time-${direction}`).textContent = `${recommendations[direction]}s`;
      document.getElementById(`bar-${direction}`).style.width = `${Math.max(3, (counts[direction] / largest) * 100)}%`;
    });
    document.getElementById("cycle-total").textContent = `${getCycleLength()}s`;
    document.getElementById("cycle-note").textContent =
      `2 opposing stages · ${amberSeconds}s amber + ${allRedSeconds}s all-red per change`;
    return recommendations;
  }

  function setSignalState(state) {
    signalState = state;
    const allowedDirections = state === "all-red" ? [] : stages[phaseIndex];
    directions.forEach((item) => {
      const wrapper = document.querySelector(`.light-${item}`);
      const green = document.getElementById(`light-${item}`);
      const red = wrapper.querySelector(".lamp-red");
      const amber = wrapper.querySelector(".lamp-yellow");
      const isInActiveStage = allowedDirections.includes(item);
      green.classList.toggle("active", state === "green" && isInActiveStage);
      amber.classList.toggle("active", state === "amber" && isInActiveStage);
      red.classList.toggle("active", state === "all-red" || !isInActiveStage);
    });
    const stageLabel = phaseIndex === 0 ? "NORTH + SOUTH" : "EAST + WEST";
    const stateLabel = state === "all-red" ? "ALL-RED CLEARANCE" : state.toUpperCase();
    document.getElementById("scene-status").textContent = `${stageLabel} · ${stateLabel}`;
    document.getElementById("signal-stage").textContent = `${stageLabel} · ${stateLabel}`;
  }

  function formatCountdown(seconds) {
    const safeSeconds = Math.max(0, seconds);
    return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
  }

  function updateCountdown() {
    document.getElementById("countdown").textContent =
      mode === "manual" && signalState === "green" ? "HOLD" : formatCountdown(phaseSecondsLeft);
  }

  function updateCountsFromSimulation() {
    const profile = activeProfile || getProfile();
    const weekendFactor = isIndiaWeekend() ? 0.78 : 1;
    directions.forEach((direction) => {
      const baseline = Math.round((direction === "north" || direction === "south" ? 37 : 27) * profile.demand * weekendFactor);
      const fluctuation = Math.round(Math.random() * 8) - 3;
      inputs.get(direction).value = String(Math.max(0, Math.min(180, baseline + fluctuation)));
    });
    updateOptimizer();
    const total = directions.reduce((sum, direction) => sum + Number(inputs.get(direction).value), 0);
    document.getElementById("vehicle-total").textContent = (total * 3 + 106).toLocaleString();
    document.getElementById("wait-time").textContent = String(Math.max(9, Math.min(39, Math.round(25 - total / 24))));
    document.getElementById("fuel-saved").textContent = String(Math.round(116 + profile.demand * 24));
    document.getElementById("co2-saved").textContent = String(Math.round(30 + profile.demand * 6));
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function applyPlan() {
    phaseDurations = updateOptimizer();
    if (signalState === "green") {
      phaseSecondsLeft = phaseDurations[stages[phaseIndex][0]];
      updateCountdown();
    }
    showToast(`${getCycleLength()}-second ${mode} plan applied for ${activeProfile.label.toLowerCase()}.`);
  }

  function toggleSimulation() {
    running = !running;
    document.getElementById("simulation-toggle-label").textContent = running ? "Pause simulation" : "Resume simulation";
    document.querySelector(".button-play").textContent = running ? "Ⅱ" : "▶";
    scene.classList.toggle("paused", !running);
    document.querySelector(".live-clock .pulse-dot").style.background = running ? "" : "#c99b54";
    if (running) showToast("Traffic simulation resumed.");
    else showToast("Traffic simulation paused.");
  }

  function updateClock() {
    const now = new Date();
    document.getElementById("clock").textContent = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
    const nextProfile = getProfile();
    if (!activeProfile || activeProfile.id !== nextProfile.id) {
      activeProfile = nextProfile;
      document.getElementById("time-profile").textContent = `${activeProfile.label} · IST`;
      document.getElementById("period-description").textContent =
        `${String(activeProfile.start).padStart(2, "0")}:00–${String(activeProfile.end % 24).padStart(2, "0")}:00 IST · ${activeProfile.cycle}s example cycle`;
      document.getElementById("period-badge").textContent = activeProfile.label.toUpperCase();
      phaseDurations = updateOptimizer();
      if (mode !== "manual") phaseSecondsLeft = phaseDurations[stages[phaseIndex][0]];
      if (signalState === "green") updateCountdown();
    }
    document.getElementById("clock-zone").textContent = now.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "2-digit",
      month: "short"
    });
  }

  function setFeedStatus(source, detail, isLive) {
    document.getElementById("feed-status").textContent = source;
    document.getElementById("feed-detail").textContent = detail;
    document.getElementById("confidence-value").textContent = isLive ? "LIVE" : "96%";
    document.getElementById("confidence-bar-fill").style.width = isLive ? "100%" : "96%";
    document.getElementById("api-connection-status").textContent = isLive
      ? "Connected · live road speeds"
      : "Not connected · simulation available";
  }

  async function connectTrafficFeed() {
    const status = document.getElementById("api-connection-status");
    status.textContent = "Connecting to traffic feed…";
    try {
      const params = new URLSearchParams({
        lat: String(activeIntersection.lat),
        lon: String(activeIntersection.lon)
      });
      const response = await fetch(`/api/traffic?${params}`, { headers: { Accept: "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Traffic service returned HTTP ${response.status}.`);
      const currentSpeed = Number(result.currentSpeed);
      const freeFlowSpeed = Number(result.freeFlowSpeed);
      const roadName = typeof result.roadName === "string" && result.roadName ? result.roadName : "Connected road";
      if (!Number.isFinite(currentSpeed) || !Number.isFinite(freeFlowSpeed)) {
        throw new Error("Traffic service returned an invalid speed reading.");
      }
      const congestion = freeFlowSpeed > 0 ? Math.max(0, Math.round((1 - currentSpeed / freeFlowSpeed) * 100)) : 0;
      setFeedStatus("TomTom live traffic", `${roadName} · ${currentSpeed} km/h · ${congestion}% below free flow`, true);
      status.textContent = `Connected · ${currentSpeed} km/h current speed`;
      showToast(`Live road speeds received for ${roadName}. Vehicle counts remain simulated.`);
    } catch (error) {
      setFeedStatus("Simulation data", "Synthetic queue counts · refreshes every 3s", false);
      status.textContent = error instanceof Error ? error.message : "Unable to connect to the traffic feed.";
      showToast("Live traffic isn’t connected. The simulation is still running.");
    }
  }

  function updateSignalPhase() {
    if (!running || (mode === "manual" && signalState === "green")) return;
    phaseSecondsLeft -= 1;
    if (phaseSecondsLeft <= 0) {
      if (signalState === "green") {
        signalState = "amber";
        phaseSecondsLeft = amberSeconds;
        setSignalState(signalState);
      } else if (signalState === "amber") {
        signalState = "all-red";
        phaseSecondsLeft = allRedSeconds;
        setSignalState(signalState);
      } else {
        phaseIndex = (phaseIndex + 1) % stages.length;
        phaseDurations = allocateGreenTimes(getCounts());
        signalState = "green";
        phaseSecondsLeft = phaseDurations[stages[phaseIndex][0]];
        setSignalState(signalState);
      }
      updateManualButton();
    }
    updateCountdown();
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.getElementById("mode-status").textContent = {
      fixed: "Fixed-time schedule",
      actuated: "Traffic-actuated · queue weighted",
      manual: "Manual operator control"
    }[mode];
    document.getElementById("manual-advance").hidden = mode !== "manual";
    phaseDurations = updateOptimizer();
    if (mode !== "manual" && signalState === "green") {
      phaseSecondsLeft = phaseDurations[stages[phaseIndex][0]];
      setSignalState(signalState);
    }
    updateCountdown();
    updateManualButton();
    showToast(`${mode === "fixed" ? "Time-of-day fixed plan" : mode === "actuated" ? "Demand-responsive actuated mode" : "Manual control"} selected.`);
  }

  function updateManualButton() {
    const button = document.getElementById("manual-advance");
    button.disabled = mode !== "manual" || signalState !== "green";
    button.textContent = signalState === "green" ? "Request next stage" : "Clearance in progress…";
  }

  function advanceManualStage() {
    if (mode !== "manual" || signalState !== "green") return;
    signalState = "amber";
    phaseSecondsLeft = amberSeconds;
    setSignalState(signalState);
    updateManualButton();
    updateCountdown();
  }

  inputs.forEach((input) => {
    input.addEventListener("input", updateOptimizer);
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) input.value = "0";
      input.value = String(Math.max(0, Math.min(999, Math.round(Number(input.value)))));
      updateOptimizer();
    });
  });

  document.getElementById("apply-plan").addEventListener("click", applyPlan);
  document.getElementById("signal-mode").addEventListener("change", (event) => setMode(event.target.value));
  document.getElementById("manual-advance").addEventListener("click", advanceManualStage);
  document.getElementById("simulation-toggle").addEventListener("click", toggleSimulation);
  document.getElementById("randomize-counts").addEventListener("click", () => {
    directions.forEach((direction) => {
      inputs.get(direction).value = String(Math.floor(8 + Math.random() * 82));
    });
    updateOptimizer();
    showToast("New approach counts generated. Select actuated mode to allocate by queue demand.");
  });
  document.getElementById("refresh-feed").addEventListener("click", connectTrafficFeed);
  document.getElementById("connect-feed").addEventListener("click", connectTrafficFeed);
  document.getElementById("connect-feed-secondary").addEventListener("click", connectTrafficFeed);
  document.getElementById("intersection-select").addEventListener("click", () => {
    showToast("Connaught Place · CP-01 selected. Configure the location and feeds for your city.");
  });

  activeProfile = getProfile();
  document.getElementById("time-profile").textContent = `${activeProfile.label} · IST`;
  inputs.get("north").value = "42";
  inputs.get("south").value = "36";
  inputs.get("east").value = "28";
  inputs.get("west").value = "24";
  updateClock();
  updateOptimizer();
  phaseDurations = allocateGreenTimes(getCounts());
  phaseSecondsLeft = phaseDurations[stages[phaseIndex][0]];
  setSignalState(signalState);
  updateCountdown();
  updateManualButton();
  window.setInterval(updateClock, 1000);
  window.setInterval(updateSignalPhase, 1000);
  window.setInterval(() => { if (running) updateCountsFromSimulation(); }, 2800);
  connectTrafficFeed();
})();
