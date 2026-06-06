// app.js
// Frontend logic for Toyoko Inn Availability Dashboard

// Global State
const state = {
  config: {
    hotelCode: "00078",
    hotelName: "東橫INN 東京新宿歌舞伎町",
    startDate: "2027-04-08",
    endDate: "2027-07-01",
    roomCount: 1,
    peopleCount: 1,
    lastUpdated: "",
    autoMonitor: false,
    monitorInterval: 30
  },
  hotels: [],         // Full database of Japan hotels
  availability: [],   // Crawled room availability data
  selectedDate: null, // Selected calendar date
  isCrawling: false,  // Crawler running status
  pollingInterval: null,
  filters: {
    roomType: "all",      // "all", "single", "double"
    smoking: "all",       // "all", "non-smoking", "smoking"
    onlyVacant: true,
    maxPrice: 20000       // Max price filter (JPY)
  }
};

// DOM Elements
const el = {
  hotelSearchInput: document.getElementById("hotel-search-input"),
  clearHotelSearch: document.getElementById("clear-hotel-search"),
  hotelDropdownList: document.getElementById("hotel-dropdown-list"),
  selectedHotelDisplay: document.getElementById("selected-hotel-display"),
  startDateInput: document.getElementById("start-date-input"),
  endDateInput: document.getElementById("end-date-input"),
  roomCountSelect: document.getElementById("room-count-select"),
  peopleCountSelect: document.getElementById("people-count-select"),
  saveConfigBtn: document.getElementById("save-config-btn"),
  
  dashboardTitle: document.getElementById("dashboard-title"),
  dateRangeDisplay: document.getElementById("date-range-display"),
  lastUpdatedDisplay: document.getElementById("last-updated-display"),
  
  refreshNowBtn: document.getElementById("refresh-now-btn"),
  stopCrawlBtn: document.getElementById("stop-crawl-btn"),
  progressBarContainer: document.getElementById("crawler-progress-bar-container"),
  progressStatusMessage: document.getElementById("crawler-status-message"),
  progressPercent: document.getElementById("crawler-progress-percent"),
  progressFill: document.getElementById("crawler-progress-fill"),
  
  filterRoomType: document.getElementById("filter-room-type"),
  filterSmoking: document.getElementById("filter-smoking"),
  filterOnlyVacant: document.getElementById("filter-only-vacant"),
  filterPriceRange: document.getElementById("filter-price-range"),
  priceLimitDisplay: document.getElementById("price-limit-display"),
  
  totalAvailableDays: document.getElementById("total-available-days"),
  totalFullDays: document.getElementById("total-full-days"),
  calendarsContainer: document.getElementById("calendars-container"),
  
  detailHeaderEmpty: document.getElementById("detail-header-empty"),
  detailContent: document.getElementById("detail-content"),
  selectedDetailDate: document.getElementById("selected-detail-date"),
  selectedDetailWeekday: document.getElementById("selected-detail-weekday"),
  selectedDetailHotel: document.getElementById("selected-detail-hotel"),
  detailRoomsList: document.getElementById("detail-rooms-list"),
  directBookingLink: document.getElementById("direct-booking-link"),
  
  themeBtnDark: document.getElementById("theme-btn-dark"),
  themeBtnLight: document.getElementById("theme-btn-light"),
  calendarTooltip: document.getElementById("calendar-tooltip"),
  autoMonitorCheckbox: document.getElementById("auto-monitor-checkbox"),
  monitorIntervalGroup: document.getElementById("monitor-interval-group"),
  monitorIntervalSelect: document.getElementById("monitor-interval-select"),
  githubControls: document.getElementById("github-controls"),
  downloadConfigBtn: document.getElementById("download-config-btn"),
  showDeployGuideBtn: document.getElementById("show-deploy-guide-btn"),
  deployModal: document.getElementById("deploy-modal"),
  closeModalBtn: document.getElementById("close-modal-btn")
};

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  setupTheme();
  initFormConstraints();
  await loadConfig();
  await loadHotels();
  await loadAvailability();
  setupEventListeners();
  
  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker registered:', reg.scope))
        .catch(err => console.error('Service Worker registration failed:', err));
    });
  }
  
  const isGitHubPages = window.location.hostname.endsWith('github.io');
  
  if (isGitHubPages) {
    // GitHub Pages cloud mode
    const statusText = document.querySelector(".connection-status .status-text");
    const pingDot = document.querySelector(".connection-status .ping-dot");
    if (statusText && pingDot) {
      statusText.textContent = "GitHub 雲端監測 (24h 自動)";
      pingDot.className = "ping-dot green";
    }
    
    // Hide local-only buttons and settings
    el.refreshNowBtn.style.display = "none";
    el.saveConfigBtn.style.display = "none";
    
    if (el.autoMonitorCheckbox) {
      el.autoMonitorCheckbox.closest('.settings-group').style.display = "none";
      el.monitorIntervalGroup.style.display = "none";
    }
    
    // Show GitHub deployment and config exporter buttons
    if (el.githubControls) {
      el.githubControls.style.display = "flex";
    }
    
    // Enable form inputs so user can configure and export settings
    el.hotelSearchInput.disabled = false;
    el.hotelSearchInput.placeholder = "輸入關鍵字 (如: 新宿, 池袋)...";
    el.startDateInput.disabled = false;
    el.endDateInput.disabled = false;
    el.roomCountSelect.disabled = false;
    el.peopleCountSelect.disabled = false;
    
  } else if (window.location.protocol !== "file:") {
    // Start polling crawler status on load
    startPollingStatus();
  } else {
    // Local File Mode (static fallback)
    const statusText = document.querySelector(".connection-status .status-text");
    const pingDot = document.querySelector(".connection-status .ping-dot");
    if (statusText && pingDot) {
      statusText.textContent = "本機檔案模式 (靜態)";
      pingDot.className = "ping-dot";
      pingDot.style.backgroundColor = "#3b82f6"; // Blue dot
    }
    
    // Disable active refresh in browser
    el.refreshNowBtn.style.display = "none";
    el.saveConfigBtn.disabled = true;
    el.saveConfigBtn.innerHTML = `<i class="fa-solid fa-info-circle"></i><span>請在資料夾中執行 .bat 檔進行更新</span>`;
    el.saveConfigBtn.style.cursor = "not-allowed";
    el.saveConfigBtn.style.opacity = "0.7";
    el.saveConfigBtn.style.background = "var(--color-text-muted)";
    
    // Disable inputs
    el.hotelSearchInput.disabled = true;
    el.hotelSearchInput.placeholder = "本機模式：如需變更分店，請使用伺服器模式";
    el.startDateInput.disabled = true;
    el.endDateInput.disabled = true;
    el.roomCountSelect.disabled = true;
    el.peopleCountSelect.disabled = true;
  }
});

// Theme Management
function setupTheme() {
  const savedTheme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  
  if (savedTheme === "light") {
    el.themeBtnLight.classList.add("active");
    el.themeBtnDark.classList.remove("active");
  } else {
    el.themeBtnDark.classList.add("active");
    el.themeBtnLight.classList.remove("active");
  }
}

function toggleTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  
  if (theme === "light") {
    el.themeBtnLight.classList.add("active");
    el.themeBtnDark.classList.remove("active");
  } else {
    el.themeBtnDark.classList.add("active");
    el.themeBtnLight.classList.remove("active");
  }
}

// Form Initialization
function initFormConstraints() {
  // Set date input minimums to today
  const todayStr = new Date().toISOString().split("T")[0];
  el.startDateInput.min = todayStr;
  el.endDateInput.min = todayStr;
}

// Load Configuration from API or local window global
async function loadConfig() {
  const isGitHubPages = window.location.hostname.endsWith('github.io');
  if (window.location.protocol === "file:" || isGitHubPages) {
    if (window.toyokoConfig) {
      state.config = window.toyokoConfig;
      updateConfigUI();
    }
    return;
  }
  try {
    const response = await fetch("/api/config");
    if (response.ok) {
      state.config = await response.json();
      updateConfigUI();
    }
  } catch (error) {
    console.error("Error loading config:", error);
  }
}

function updateConfigUI() {
  // Update form inputs
  el.startDateInput.value = state.config.startDate;
  el.endDateInput.value = state.config.endDate;
  el.roomCountSelect.value = state.config.roomCount.toString();
  el.peopleCountSelect.value = state.config.peopleCount.toString();
  
  if (el.autoMonitorCheckbox) {
    el.autoMonitorCheckbox.checked = !!state.config.autoMonitor;
    el.monitorIntervalGroup.style.display = state.config.autoMonitor ? "block" : "none";
  }
  if (el.monitorIntervalSelect && state.config.monitorInterval) {
    el.monitorIntervalSelect.value = state.config.monitorInterval.toString();
  }
  
  // Update header text
  el.dashboardTitle.textContent = state.config.hotelName;
  el.dateRangeDisplay.textContent = `${state.config.startDate} 至 ${state.config.endDate}`;
  el.lastUpdatedDisplay.textContent = state.config.lastUpdated || "從未查詢";
  
  // Update selected hotel display box
  el.selectedHotelDisplay.innerHTML = `
    <span class="hotel-name">${state.config.hotelName}</span>
    <span class="hotel-code">代號: ${state.config.hotelCode}</span>
  `;
}

// Load Hotels Database from API or local window global
async function loadHotels() {
  const isGitHubPages = window.location.hostname.endsWith('github.io');
  if (window.location.protocol === "file:" || isGitHubPages) {
    if (window.toyokoHotels) {
      state.hotels = window.toyokoHotels;
      setupAutocomplete();
    }
    return;
  }
  try {
    const response = await fetch("/api/hotels");
    if (response.ok) {
      state.hotels = await response.json();
      setupAutocomplete();
    }
  } catch (error) {
    console.error("Error loading hotels:", error);
  }
}

// Autocomplete Dropdown Setup
function setupAutocomplete() {
  let selectedIndex = -1;
  let matches = [];

  el.hotelSearchInput.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    selectedIndex = -1;
    
    if (query.length === 0) {
      el.clearHotelSearch.style.display = "none";
      el.hotelDropdownList.style.display = "none";
      return;
    }
    
    el.clearHotelSearch.style.display = "block";
    
    // Find matching hotels in our structured fetched_hotels.json
    matches = [];
    state.hotels.forEach(region => {
      region.list.forEach(pref => {
        pref.hotels.forEach(hotel => {
          if (hotel.name.toLowerCase().includes(query) || 
              hotel.hotelCode.includes(query) || 
              (hotel.city && hotel.city.toLowerCase().includes(query)) ||
              (hotel.address && hotel.address.toLowerCase().includes(query))) {
            matches.push(hotel);
          }
        });
      });
    });
    
    // Limit to top 30 matches to keep dropdown performant
    matches = matches.slice(0, 30);
    renderDropdown(matches);
  });

  function renderDropdown(items) {
    if (items.length === 0) {
      el.hotelDropdownList.innerHTML = `<div class="autocomplete-item" style="color: var(--color-text-muted);">無匹配的分店</div>`;
      el.hotelDropdownList.style.display = "block";
      return;
    }

    // Sort matches: Tokyo prefecture (13) first, then others
    items.sort((a, b) => {
      if (a.prefecture === 13 && b.prefecture !== 13) return -1;
      if (a.prefecture !== 13 && b.prefecture === 13) return 1;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

    // Render grouped by prefecture/area
    // For simplicity, let's render a clean list of options
    let html = "";
    items.forEach((item, index) => {
      html += `
        <div class="autocomplete-item" data-index="${index}" data-code="${item.hotelCode}" data-name="${item.name}">
          <span>${item.name}</span>
          <span class="hotel-code-badge">${item.hotelCode}</span>
        </div>
      `;
    });
    
    el.hotelDropdownList.innerHTML = html;
    el.hotelDropdownList.style.display = "block";
    
    // Add click listeners to items
    const elements = el.hotelDropdownList.querySelectorAll(".autocomplete-item");
    elements.forEach(itemEl => {
      itemEl.addEventListener("click", () => {
        selectHotel(itemEl.dataset.code, itemEl.dataset.name);
      });
    });
  }

  function selectHotel(code, name) {
    state.config.hotelCode = code;
    state.config.hotelName = name;
    
    el.selectedHotelDisplay.innerHTML = `
      <span class="hotel-name">${name}</span>
      <span class="hotel-code">代號: ${code}</span>
    `;
    
    el.hotelSearchInput.value = "";
    el.clearHotelSearch.style.display = "none";
    el.hotelDropdownList.style.display = "none";
  }

  // Clear search button
  el.clearHotelSearch.addEventListener("click", () => {
    el.hotelSearchInput.value = "";
    el.clearHotelSearch.style.display = "none";
    el.hotelDropdownList.style.display = "none";
    el.hotelSearchInput.focus();
  });

  // Hide dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!el.hotelSearchInput.contains(e.target) && !el.hotelDropdownList.contains(e.target)) {
      el.hotelDropdownList.style.display = "none";
    }
  });
}

// Load Crawled Data
async function loadAvailability() {
  const isGitHubPages = window.location.hostname.endsWith('github.io');
  if (window.location.protocol === "file:" || isGitHubPages) {
    if (window.toyokoData) {
      state.availability = window.toyokoData;
      renderCalendars();
    }
    return;
  }
  try {
    const response = await fetch("/api/data");
    if (response.ok) {
      state.availability = await response.json();
      renderCalendars();
    }
  } catch (error) {
    console.error("Error loading availability data:", error);
  }
}

// Polling Crawler Status
function startPollingStatus() {
  if (state.pollingInterval) clearInterval(state.pollingInterval);
  
  state.pollingInterval = setInterval(async () => {
    try {
      const response = await fetch("/api/status");
      if (response.ok) {
        const status = await response.json();
        updateCrawlerUI(status);
      }
    } catch (error) {
      console.error("Error polling status:", error);
    }
  }, 1000);
}

function updateCrawlerUI(status) {
  if (status.state === "crawling") {
    state.isCrawling = true;
    el.refreshNowBtn.style.display = "none";
    el.stopCrawlBtn.style.display = "flex";
    el.progressBarContainer.style.display = "block";
    
    el.progressStatusMessage.textContent = status.message || "正在查詢...";
    el.progressPercent.textContent = `${status.progress}%`;
    el.progressFill.style.width = `${status.progress}%`;
    
    // Incrementally reload availability data during crawl so user sees results live!
    if (status.progress > 0 && status.progress % 5 === 0) {
      loadAvailability();
    }
  } else {
    // Idle, completed, stopped, failed
    if (state.isCrawling) {
      // Transition from crawling to idle/finished: reload final data
      state.isCrawling = false;
      loadAvailability().then(() => {
        // Find if there are vacant days
        const vacantDays = state.availability.filter(day => {
          if (!day.rooms) return false;
          return day.rooms.some(r => r.plans.some(p => p.generalVacant > 0 || p.membershipVacant > 0));
        }).length;
        
        if (vacantDays > 0) {
          showBrowserNotification(
            "東橫INN 發現空房！",
            `${state.config.hotelName} 共有 ${vacantDays} 天有空房！快去訂房吧！`
          );
        }
      });
      loadConfig();
    }
    
    el.refreshNowBtn.style.display = "flex";
    el.stopCrawlBtn.style.display = "none";
    el.progressBarContainer.style.display = "none";
  }
}

// Render Heatmap Calendars
function renderCalendars() {
  const start = new Date(state.config.startDate);
  const end = new Date(state.config.endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    el.calendarsContainer.innerHTML = '<div class="skeleton-placeholder"><p>請設定有效的查詢日期。</p></div>';
    return;
  }
  
  el.calendarsContainer.innerHTML = "";
  
  // Calculate months to display
  let currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  
  let totalAvailable = 0;
  let totalFull = 0;
  
  while (currentMonth <= endMonth) {
    const monthHtml = generateMonthHTML(currentMonth.getFullYear(), currentMonth.getMonth());
    el.calendarsContainer.appendChild(monthHtml.element);
    
    totalAvailable += monthHtml.vacantDays;
    totalFull += monthHtml.fullDays;
    
    // Move to next month
    currentMonth.setMonth(currentMonth.getMonth() + 1);
  }
  
  // Update dashboard stats badges
  el.totalAvailableDays.textContent = totalAvailable.toString();
  el.totalFullDays.textContent = totalFull.toString();
  
  // Re-highlight selected date if it is still rendered
  if (state.selectedDate) {
    const dayEl = document.querySelector(`.calendar-day[data-date="${state.selectedDate}"]`);
    if (dayEl) {
      dayEl.classList.add("selected-day");
    } else {
      // If the selected date is no longer in range, hide details
      hideDetailsPanel();
    }
  }
}

function generateMonthHTML(year, month) {
  const monthEl = document.createElement("div");
  monthEl.className = "month-calendar";
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // Headers
  const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  let html = `
    <h4 class="month-title">${year} 年 ${monthNames[month]}</h4>
    <div class="calendar-grid">
      <div class="weekday-header">日</div>
      <div class="weekday-header">一</div>
      <div class="weekday-header">二</div>
      <div class="weekday-header">三</div>
      <div class="weekday-header">四</div>
      <div class="weekday-header">五</div>
      <div class="weekday-header">六</div>
  `;
  
  // Padding cells before the 1st of the month
  const startDayOfWeek = firstDay.getDay(); // 0 is Sunday
  for (let i = 0; i < startDayOfWeek; i++) {
    html += '<div class="calendar-day empty-day"></div>';
  }
  
  let vacantDaysCount = 0;
  let fullDaysCount = 0;
  
  const searchStart = new Date(state.config.startDate);
  const searchEnd = new Date(state.config.endDate);
  
  // Days of the month
  const totalDays = lastDay.getDate();
  for (let day = 1; day <= totalDays; day++) {
    const dateObj = new Date(year, month, day);
    const dateStr = dateObj.getFullYear() + "-" + 
                    String(dateObj.getMonth() + 1).padStart(2, '0') + "-" + 
                    String(dateObj.getDate()).padStart(2, '0');
                    
    const inRange = dateObj >= searchStart && dateObj <= searchEnd;
    
    if (!inRange) {
      // Out of range day
      html += `
        <div class="calendar-day unchecked-day">
          <span class="day-number">${day}</span>
          <span class="day-price"></span>
        </div>
      `;
    } else {
      // Search in availability data
      const dateData = state.availability.find(d => d.date === dateStr);
      let dayClass = "color-unchecked";
      let priceText = "";
      let minPrice = Infinity;
      let isVacant = false;
      let hasCrawlError = false;
      
      if (dateData) {
        hasCrawlError = !!dateData.error;
        
        // Filter room types for availability
        const filteredRooms = filterRoomsList(dateData.rooms);
        
        if (filteredRooms.length > 0) {
          isVacant = true;
          // Find lowest price
          filteredRooms.forEach(room => {
            room.plans.forEach(plan => {
              const price = plan.generalPrice;
              if (price < minPrice) {
                minPrice = price;
              }
            });
          });
        }
        
        if (isVacant && minPrice !== Infinity) {
          dayClass = "day-vacant";
          priceText = `¥${minPrice.toLocaleString()}`;
          vacantDaysCount++;
        } else {
          dayClass = "day-full";
          priceText = hasCrawlError ? "ERR" : "客滿";
          fullDaysCount++;
        }
      }
      
      html += `
        <div class="calendar-day ${dayClass}" data-date="${dateStr}">
          <span class="day-number">${day}</span>
          <span class="day-price">${priceText}</span>
        </div>
      `;
    }
  }
  
  html += `</div>`; // Close grid
  monthEl.innerHTML = html;
  
  // Attach event listeners to calendar days
  const dayCells = monthEl.querySelectorAll(".calendar-day[data-date]");
  dayCells.forEach(cell => {
    cell.addEventListener("click", () => {
      selectDate(cell.dataset.date);
    });
    
    // Hover tooltips
    cell.addEventListener("mouseenter", (e) => {
      showTooltip(e, cell.dataset.date);
    });
    
    cell.addEventListener("mouseleave", () => {
      hideTooltip();
    });
  });
  
  return {
    element: monthEl,
    vacantDays: vacantDaysCount,
    fullDays: fullDaysCount
  };
}

// Filter rooms list based on user selections
function filterRoomsList(rooms) {
  if (!rooms) return [];
  
  return rooms.map(room => {
    // Copy room object and plans array to avoid mutating original state
    const filteredRoom = { ...room, plans: [...(room.plans || [])] };
    
    // Filter room specs: Smoking / Non-smoking
    if (state.filters.smoking === "non-smoking" && room.isSmoking) return null;
    if (state.filters.smoking === "smoking" && !room.isSmoking) return null;
    
    // Filter room type name
    if (state.filters.roomType === "single" && !room.roomTypeName.includes("單人")) return null;
    if (state.filters.roomType === "double" && 
        (room.roomTypeName.includes("單人") || 
         (!room.roomTypeName.includes("雙人") && 
          !room.roomTypeName.includes("雙床") && 
          !room.roomTypeName.includes("大床") && 
          !room.roomTypeName.includes("家庭")))) {
      return null;
    }
    
    // Filter plans based on price and vacancy
    filteredRoom.plans = filteredRoom.plans.filter(plan => {
      const priceVal = plan.generalPrice;
      const priceOk = priceVal <= state.filters.maxPrice;
      
      const vacantOk = !state.filters.onlyVacant || plan.generalVacant > 0 || plan.membershipVacant > 0;
      
      return priceOk && vacantOk;
    });
    
    if (filteredRoom.plans.length === 0) return null;
    
    return filteredRoom;
  }).filter(Boolean);
}

// Select a Date and Update Side Panel Details
function selectDate(dateStr) {
  // Clear previous selected day styling
  const prevSelected = document.querySelector(".calendar-day.selected-day");
  if (prevSelected) prevSelected.classList.remove("selected-day");
  
  state.selectedDate = dateStr;
  
  // Highlight new selected cell
  const dayEl = document.querySelector(`.calendar-day[data-date="${dateStr}"]`);
  if (dayEl) dayEl.classList.add("selected-day");
  
  // Render detail panel
  const dateData = state.availability.find(d => d.date === dateStr);
  
  el.selectedDetailDate.textContent = dateStr;
  
  // Calculate day of the week name
  const dateObj = new Date(dateStr);
  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  el.selectedDetailWeekday.textContent = weekDays[dateObj.getDay()];
  el.selectedDetailHotel.textContent = state.config.hotelName;
  
  // Empty check
  if (!dateData || dateData.error) {
    el.detailRoomsList.innerHTML = `
      <div class="detail-empty-state">
        <i class="fa-solid fa-triangle-exclamation" style="color: var(--color-accent);"></i>
        <h4>查無空房資訊</h4>
        <p>${dateData && dateData.error ? dateData.error : "此日期尚未被爬網頁或查無此房店紀錄。"}</p>
      </div>
    `;
    setupBookingLink(dateStr);
    el.detailHeaderEmpty.style.display = "none";
    el.detailContent.style.display = "flex";
    return;
  }
  
  const filteredRooms = filterRoomsList(dateData.rooms);
  
  if (filteredRooms.length === 0) {
    el.detailRoomsList.innerHTML = `
      <div class="detail-empty-state">
        <i class="fa-solid fa-face-frown" style="color: var(--color-accent);"></i>
        <h4>當天已客滿</h4>
        <p>（或者目前過濾條件將所有房型排除在外）</p>
      </div>
    `;
  } else {
    let roomsHtml = "";
    filteredRooms.forEach(room => {
      // Find vacancy counts
      const maxVacant = Math.max(...room.plans.map(p => Math.max(p.generalVacant, p.membershipVacant)));
      const vacancyClass = maxVacant > 0 ? "available" : "full";
      const vacancyText = maxVacant > 0 ? `剩餘 ${maxVacant} 間` : "已客滿";
      
      let plansHtml = "";
      room.plans.forEach(plan => {
        plansHtml += `
          <div class="plan-item">
            <span class="plan-title">${plan.planName}</span>
            <div class="plan-price-wrap">
              <span class="plan-price-value">¥${plan.generalPrice.toLocaleString()}</span>
              <div class="plan-price-label">會員價: ¥${plan.membershipPrice.toLocaleString()} (餘 ${plan.membershipVacant})</div>
            </div>
          </div>
        `;
      });
      
      roomsHtml += `
        <div class="room-item-card">
          <div class="room-item-header">
            <div class="room-name-wrap">
              <h5>${room.roomTypeName}</h5>
              <div class="room-specs">
                <span class="spec-pill ${room.isSmoking ? 'smoking' : 'non-smoking'}">
                  ${room.isSmoking ? '可吸菸' : '禁菸'}
                </span>
                ${room.roomSize ? `<span class="spec-pill">面積: ${room.roomSize}㎡</span>` : ''}
                ${room.bedWidth ? `<span class="spec-pill">床寬: ${room.bedWidth}cm</span>` : ''}
              </div>
            </div>
            <span class="room-vacancy-badge ${vacancyClass}">${vacancyText}</span>
          </div>
          <div class="room-plans-list">
            ${plansHtml}
          </div>
        </div>
      `;
    });
    el.detailRoomsList.innerHTML = roomsHtml;
  }
  
  setupBookingLink(dateStr);
  
  el.detailHeaderEmpty.style.display = "none";
  el.detailContent.style.display = "flex";
}

function hideDetailsPanel() {
  state.selectedDate = null;
  el.detailHeaderEmpty.style.display = "flex";
  el.detailContent.style.display = "none";
}

function setupBookingLink(dateStr) {
  // Direct booking link format
  // Calculate check out date (+1 day)
  const dateObj = new Date(dateStr);
  const checkoutObj = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() + 1);
  const checkoutStr = checkoutObj.getFullYear() + "-" + 
                      String(checkoutObj.getMonth() + 1).padStart(2, '0') + "-" + 
                      String(checkoutObj.getDate()).padStart(2, '0');
                      
  const bookingUrl = `https://www.toyoko-inn.com/china/search/result/room_plan?hotel=${state.config.hotelCode}&start=${dateStr}&end=${checkoutStr}&room=${state.config.roomCount}&people=${state.config.peopleCount}`;
  
  el.directBookingLink.href = bookingUrl;
}

// Tooltip Management
function showTooltip(event, dateStr) {
  const dateData = state.availability.find(d => d.date === dateStr);
  if (!dateData) return;
  
  const filteredRooms = filterRoomsList(dateData.rooms);
  
  let tooltipHtml = `<strong>${dateStr}</strong><br>`;
  
  if (dateData.error) {
    tooltipHtml += `<span style="color: var(--color-accent);">${dateData.error}</span>`;
  } else if (filteredRooms.length === 0) {
    tooltipHtml += `<span style="color: var(--color-accent);">當天無房或過濾客滿</span>`;
  } else {
    tooltipHtml += `有房種類: ${filteredRooms.length} 種<br>`;
    
    // Find min/max price
    let prices = [];
    filteredRooms.forEach(r => r.plans.forEach(p => prices.push(p.generalPrice)));
    if (prices.length > 0) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (min === max) {
        tooltipHtml += `價格: <strong>¥${min.toLocaleString()}</strong>`;
      } else {
        tooltipHtml += `價格: <strong>¥${min.toLocaleString()}~¥${max.toLocaleString()}</strong>`;
      }
    }
  }
  
  el.calendarTooltip.innerHTML = tooltipHtml;
  el.calendarTooltip.style.display = "block";
  
  // Position tooltip relative to event target
  const rect = event.target.getBoundingClientRect();
  const tooltipRect = el.calendarTooltip.getBoundingClientRect();
  
  let top = rect.top - tooltipRect.height - 8 + window.scrollY;
  let left = rect.left + (rect.width - tooltipRect.width) / 2 + window.scrollX;
  
  // Bounds check
  if (top < 0) top = rect.bottom + 8 + window.scrollY;
  if (left < 0) left = 4;
  
  el.calendarTooltip.style.top = `${top}px`;
  el.calendarTooltip.style.left = `${left}px`;
}

function hideTooltip() {
  el.calendarTooltip.style.display = "none";
}

// Event Listeners Setup
function setupEventListeners() {
  // Save configuration & restart crawl
  el.saveConfigBtn.addEventListener("click", async () => {
    const startVal = el.startDateInput.value;
    const endVal = el.endDateInput.value;
    
    if (!startVal || !endVal) {
      alert("請填寫起始日期與結束日期！");
      return;
    }
    
    const startObj = new Date(startVal);
    const endObj = new Date(endVal);
    
    if (startObj >= endObj) {
      alert("起始日期必須早於結束日期！");
      return;
    }
    
    // Limit range to max 3 months (95 days) to avoid query overflow
    const diffTime = Math.abs(endObj - startObj);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 95) {
      alert("為避免網頁被東橫INN封鎖，查詢日期範圍不可超過 90 天 (目前是 " + diffDays + " 天)。");
      return;
    }
    
    const updatedConfig = {
      hotelCode: state.config.hotelCode,
      hotelName: state.config.hotelName,
      startDate: startVal,
      endDate: endVal,
      roomCount: parseInt(el.roomCountSelect.value),
      peopleCount: parseInt(el.peopleCountSelect.value),
      lastUpdated: state.config.lastUpdated,
      autoMonitor: el.autoMonitorCheckbox ? el.autoMonitorCheckbox.checked : false,
      monitorInterval: el.monitorIntervalSelect ? parseInt(el.monitorIntervalSelect.value) : 30
    };
    
    try {
      el.saveConfigBtn.disabled = true;
      el.saveConfigBtn.querySelector("span").textContent = "正在設定中...";
      
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig)
      });
      
      if (response.ok) {
        state.config = updatedConfig;
        updateConfigUI();
        alert("設定儲存成功！已自動發起背景空房爬網...請查看頂部進度條。");
        // Start polling immediately
        startPollingStatus();
      } else {
        alert("伺服器儲存設定失敗！");
      }
    } catch (e) {
      console.error(e);
      alert("連線伺服器失敗，請確認 Start_Toyoko_App.bat 視窗是否有開啟！");
    } finally {
      el.saveConfigBtn.disabled = false;
      el.saveConfigBtn.querySelector("span").textContent = "儲存並重啟監測";
    }
  });

  // Live Refresh button
  el.refreshNowBtn.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      if (response.ok) {
        startPollingStatus();
      } else {
        alert("發送更新請求失敗！");
      }
    } catch (e) {
      console.error(e);
      alert("無法發起爬網，請檢查本機伺服器連線狀態！");
    }
  });

  // Stop Crawl button
  el.stopCrawlBtn.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/stop", { method: "POST" });
      if (response.ok) {
        el.progressStatusMessage.textContent = "正在發送終止訊號...";
      }
    } catch (e) {
      console.error(e);
    }
  });

  // Filters setup
  el.filterRoomType.addEventListener("change", (e) => {
    state.filters.roomType = e.target.value;
    renderCalendars();
    if (state.selectedDate) selectDate(state.selectedDate);
  });

  el.filterSmoking.addEventListener("change", (e) => {
    state.filters.smoking = e.target.value;
    renderCalendars();
    if (state.selectedDate) selectDate(state.selectedDate);
  });

  el.filterOnlyVacant.addEventListener("change", (e) => {
    state.filters.onlyVacant = e.target.checked;
    renderCalendars();
    if (state.selectedDate) selectDate(state.selectedDate);
  });

  el.filterPriceRange.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    state.filters.maxPrice = val;
    el.priceLimitDisplay.textContent = `${val.toLocaleString()} 日圓`;
    renderCalendars();
    if (state.selectedDate) selectDate(state.selectedDate);
  });

  // Theme switches
  el.themeBtnDark.addEventListener("click", () => toggleTheme("dark"));
  el.themeBtnLight.addEventListener("click", () => toggleTheme("light"));
  
  // Download config.json click listener (GitHub cloud mode)
  if (el.downloadConfigBtn) {
    el.downloadConfigBtn.addEventListener("click", () => {
      const configData = {
        hotelCode: state.config.hotelCode,
        hotelName: state.config.hotelName,
        startDate: el.startDateInput.value,
        endDate: el.endDateInput.value,
        roomCount: parseInt(el.roomCountSelect.value),
        peopleCount: parseInt(el.peopleCountSelect.value),
        lastUpdated: state.config.lastUpdated || "",
        autoMonitor: true, // Always enable on GitHub Action cloud monitor
        monitorInterval: 30 // Runs every 30 minutes
      };
      
      const jsonStr = JSON.stringify(configData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "config.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      alert("已成功下載 config.json！\n請將這個檔案上傳/覆蓋您 GitHub 儲存庫中的 config.json，雲端爬蟲將在下一次執行時自動套用新設定！");
    });
  }

  // Show / Close GitHub Deploy Guide Modal
  if (el.showDeployGuideBtn && el.deployModal) {
    el.showDeployGuideBtn.addEventListener("click", () => {
      el.deployModal.style.display = "flex";
      el.deployModal.style.opacity = "1";
    });
  }
  
  if (el.closeModalBtn && el.deployModal) {
    el.closeModalBtn.addEventListener("click", () => {
      el.deployModal.style.display = "none";
    });
    
    // Hide when clicking outside modal content
    el.deployModal.addEventListener("click", (e) => {
      if (e.target === el.deployModal) {
        el.deployModal.style.display = "none";
      }
    });
  }
  
  // Auto monitor checkbox toggle visibility
  if (el.autoMonitorCheckbox) {
    el.autoMonitorCheckbox.addEventListener("change", (e) => {
      el.monitorIntervalGroup.style.display = e.target.checked ? "block" : "none";
      if (e.target.checked) {
        checkAndRequestNotificationPermission();
      }
    });
  }
}

// Browser Notification Management
function checkAndRequestNotificationPermission() {
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('Notification permission status:', permission);
      });
    }
  }
}

function showBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body,
        icon: './icon-192.png'
      });
    } catch (err) {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body: body,
            icon: './icon-192.png'
          });
        });
      }
    }
  }
}
