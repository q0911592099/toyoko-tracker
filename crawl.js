// crawl.js
// Node.js Room Availability Crawler & LINE Notify Sender for Toyoko Tracker
// Runs locally or inside GitHub Actions (Node.js 18+)

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const configJsPath = path.join(__dirname, 'config.js');
const availabilityPath = path.join(__dirname, 'availability.json');
const dataJsPath = path.join(__dirname, 'data.js');

// Helper to pause execution (rate limiting)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Send notification to Telegram Bot
async function sendTelegramNotification(token, chatId, message) {
  if (!token || !chatId) {
    console.log('[Notification] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID. Skipping push notification.');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log('[Notification] Telegram push notification sent successfully!');
    } else {
      const errText = await response.text();
      console.error('[Notification] Telegram API error response:', errText);
    }
  } catch (error) {
    console.error('[Notification] Failed to send Telegram notification:', error);
  }
}

// Main crawling process
async function run() {
  console.log('============================================================');
  console.log('Toyoko Inn Cloud Crawler (Node.js)');
  console.log('============================================================');

  // Load configuration
  if (!fs.existsSync(configPath)) {
    console.error('Error: config.json not found!');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const startDate = new Date(config.startDate);
  const endDate = new Date(config.endDate);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate >= endDate) {
    console.error('Error: Invalid date range in configuration!');
    process.exit(1);
  }

  // Generate date list
  const dates = [];
  let current = new Date(startDate);
  while (current < endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  console.log(`Hotel: ${config.hotelName} (${config.hotelCode})`);
  console.log(`Dates: ${config.startDate} to ${config.endDate} (${dates.length} nights)`);
  console.log(`Rooms: ${config.roomCount} room(s), ${config.peopleCount} guest(s)/room`);
  console.log('============================================================');

  // Load old vacant dates for comparison
  const oldVacantDates = [];
  if (fs.existsSync(availabilityPath)) {
    try {
      const oldData = JSON.parse(fs.readFileSync(availabilityPath, 'utf8'));
      oldData.forEach(day => {
        const hasVacancy = day.rooms && day.rooms.some(room => 
          room.plans && room.plans.some(plan => plan.generalVacant > 0 || plan.membershipVacant > 0)
        );
        if (hasVacancy) {
          oldVacantDates.push(day.date);
        }
      });
    } catch (e) {
      console.warn('Could not parse old availability.json, starting with fresh notifications.');
    }
  }

  const crawledData = [];
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const checkOutObj = new Date(date);
    checkOutObj.setDate(checkOutObj.getDate() + 1);
    const checkOutDate = checkOutObj.toISOString().split('T')[0];

    const progress = Math.round((i / dates.length) * 100);
    console.log(`[${progress}%] (${i + 1}/${dates.length}) Downloading date ${date}...`);

    const url = `https://www.toyoko-inn.com/china/search/result/room_plan?hotel=${config.hotelCode}&start=${date}&end=${checkOutDate}&room=${config.roomCount}&people=${config.peopleCount}`;

    let success = false;
    let html = '';

    // Retry logic (up to 3 times)
    for (let retry = 1; retry <= 3; retry++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': userAgent },
          signal: AbortSignal.timeout(10000) // 10s timeout
        });
        if (res.ok) {
          html = await res.text();
          success = true;
          break;
        }
      } catch (err) {
        console.log(`   Retry ${retry}/3 failed due to error: ${err.message}`);
        await sleep(300);
      }
    }

    if (!success) {
      console.warn(`[WARN] Failed to fetch date ${date}. Skipping.`);
      crawledData.push({
        date: date,
        hotelName: config.hotelName,
        canReservation: false,
        rooms: [],
        error: 'Network error or timeout'
      });
      continue;
    }

    // Extract __NEXT_DATA__
    const startTag = '<script id="__NEXT_DATA__" type="application/json">';
    const endTag = '</script>';
    const startIdx = html.indexOf(startTag);

    if (startIdx === -1) {
      crawledData.push({
        date: date,
        hotelName: config.hotelName,
        canReservation: false,
        rooms: [],
        error: 'Could not parse HTML response structure'
      });
    } else {
      const contentStart = startIdx + startTag.length;
      const endIdx = html.indexOf(endTag, contentStart);
      const jsonStr = html.substring(contentStart, endIdx);

      try {
        const nextData = JSON.parse(jsonStr);
        const planResponse = nextData.props.pageProps.planResponse;

        const rooms = [];
        if (planResponse && planResponse.roomTypeList) {
          planResponse.roomTypeList.forEach(r => {
            const plans = [];
            if (r.plans) {
              r.plans.forEach(p => {
                plans.push({
                  planCode: p.planCode,
                  planName: p.planName,
                  generalPrice: p.price.generalPrice,
                  membershipPrice: p.price.membershipPrice,
                  generalVacant: p.vacant.generalVacantRoom,
                  membershipVacant: p.vacant.membershipVacantRoom
                });
              });
            }

            rooms.push({
              roomTypeId: r.roomTypeId,
              roomTypeName: r.roomTypeName,
              roomTypeDescription: r.roomTypeDescription,
              isSmoking: r.specs.isSmoking,
              roomSize: r.specs.roomSize,
              bedWidth: r.specs.widthOfBedA,
              bedCount: r.specs.numberOfBedA,
              imageUrls: r.imageUrls,
              plans: plans
            });
          });
        }

        crawledData.push({
          date: date,
          hotelName: planResponse.hotelTitle,
          canReservation: planResponse.canReservation,
          rooms: rooms
        });
      } catch (err) {
        crawledData.push({
          date: date,
          hotelName: config.hotelName,
          canReservation: false,
          rooms: [],
          error: 'JSON parse error'
        });
      }
    }

    // Rate limiting delay
    await sleep(250);
  }

  // 100% progress
  console.log('[100%] Crawling finished successfully!');

  // Analyze new vacancies
  const newVacantDates = [];
  let minPrice = Infinity;
  
  crawledData.forEach(day => {
    let hasVacancy = false;
    if (day.rooms) {
      day.rooms.forEach(room => {
        if (room.plans) {
          room.plans.forEach(plan => {
            if (plan.generalVacant > 0 || plan.membershipVacant > 0) {
              hasVacancy = true;
              if (plan.generalPrice < minPrice) {
                minPrice = plan.generalPrice;
              }
            }
          });
        }
      });
    }
    if (hasVacancy) {
      newVacantDates.push(day.date);
    }
  });

  // Compare vacancy list and notify if new dates are found
  const addedDates = newVacantDates.filter(d => !oldVacantDates.includes(d));
  if (addedDates.length > 0) {
    const minPriceText = minPrice !== Infinity ? `，最便宜價格 <b>¥${minPrice.toLocaleString()}</b> 日圓起。` : '';
    const dateListStr = addedDates.join(', ');
    
    const message = `<b>🔔 東橫INN 發現空房！</b>\n\n` +
                    `<b>飯店：</b>${config.hotelName}\n` +
                    `<b>新增空房：</b>${addedDates.length} 天\n` +
                    `<b>新增日期：</b><code>${dateListStr}</code>${minPriceText}\n\n` +
                    `<a href="https://www.toyoko-inn.com/china/search/result/room_plan?hotel=${config.hotelCode}&start=${addedDates[0]}">立即前往訂房 ↗</a>`;
    
    // Telegram credentials from Environment Variables (GitHub Secrets)
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgChatId = process.env.TELEGRAM_CHAT_ID;
    await sendTelegramNotification(tgToken, tgChatId, message);
  } else {
    console.log('[Notification] No new vacant dates detected. Notification omitted.');
  }

  // Save outputs
  const crawledJson = JSON.stringify(crawledData, null, 2);
  fs.writeFileSync(availabilityPath, crawledJson, 'utf8');
  fs.writeFileSync(dataJsPath, `window.toyokoData = ${crawledJson};`, 'utf8');

  // Update lastUpdated timestamp
  const now = new Date();
  const formatTime = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  config.lastUpdated = formatTime(now);

  const configJson = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, configJson, 'utf8');
  fs.writeFileSync(configJsPath, `window.toyokoConfig = ${configJson};`, 'utf8');

  console.log('============================================================');
  console.log(`Outputs updated successfully! Last Updated: ${config.lastUpdated}`);
  console.log('============================================================');
}

run();
