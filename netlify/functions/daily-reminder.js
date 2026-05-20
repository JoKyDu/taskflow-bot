// netlify/functions/daily-reminder.js
// Runs every day at 7AM EST (12:00 UTC)

const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_CLIENT_ID    = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

// ── Get Google Access Token ────────────────────────────────────────────────────
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token;
}

// ── Get Google Tasks ───────────────────────────────────────────────────────────
async function getGoogleTasks(accessToken) {
  // Get all task lists
  const listsRes = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listsData = await listsRes.json();
  const lists = listsData.items || [];

  let allTasks = [];
  for (const list of lists) {
    const tasksRes = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const tasksData = await tasksRes.json();
    const tasks = (tasksData.items || []).map(t => ({
      ...t,
      listName: list.title,
    }));
    allTasks = allTasks.concat(tasks);
  }
  return allTasks;
}

// ── Get Google Calendar Events for Today ──────────────────────────────────────
async function getCalendarEvents(accessToken) {
  const now = new Date();
  const estOffset = -5 * 60; // EST = UTC-5
  const estNow = new Date(now.getTime() + (estOffset + now.getTimezoneOffset()) * 60000);
  
  const startOfDay = new Date(estNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(estNow);
  endOfDay.setHours(23, 59, 59, 999);

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${startOfDay.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  return data.items || [];
}

// ── Send Telegram Message ──────────────────────────────────────────────────────
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    }),
  });
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getDateString() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatTime(dateTimeStr) {
  if (!dateTimeStr) return '';
  const d = new Date(dateTimeStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
}

// ── Main Handler ───────────────────────────────────────────────────────────────
exports.handler = async function (event, context) {
  try {
    const accessToken = await getAccessToken();
    const [googleTasks, calendarEvents] = await Promise.all([
      getGoogleTasks(accessToken),
      getCalendarEvents(accessToken),
    ]);

    const dateStr = getDateString();
    const greetings = ['Good morning! ☀️', 'Good morning! 🌸', 'Rise and shine! 🌅'];
    const greeting = greetings[new Date().getDate() % greetings.length];

    let message = `${greeting}\n<b>${dateStr}</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;

    // Google Calendar Events
    if (calendarEvents.length > 0) {
      message += `\n📅 <b>TODAY'S SCHEDULE</b>\n`;
      calendarEvents.forEach(event => {
        const time = event.start?.dateTime
          ? formatTime(event.start.dateTime)
          : 'All day';
        message += `  🕐 ${time} — ${event.summary}\n`;
      });
    }

    // Google Tasks
    if (googleTasks.length > 0) {
      message += `\n✅ <b>YOUR TASKS</b>\n`;
      googleTasks.forEach(task => {
        const due = task.due
          ? ` <i>(due ${new Date(task.due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})</i>`
          : '';
        message += `  📌 ${task.title}${due}\n`;
        if (task.notes) message += `     <i>${task.notes}</i>\n`;
      });
    }

    if (calendarEvents.length === 0 && googleTasks.length === 0) {
      message += `\n✅ No tasks or events for today. Enjoy your day! 🎉`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━`;
    message += `\n📊 <b>${googleTasks.length} task${googleTasks.length !== 1 ? 's' : ''}</b> · <b>${calendarEvents.length} event${calendarEvents.length !== 1 ? 's' : ''}</b> today. You got this! 💪`;

    const result = await sendTelegram(message);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        tasks: googleTasks.length,
        events: calendarEvents.length,
        telegram: result,
      }),
    };
  } catch (err) {
    console.error('Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
