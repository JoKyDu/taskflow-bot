// netlify/functions/daily-reminder.js
// Runs every day at 7AM EST (12:00 UTC)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    }),
  });
  return res.json();
}

async function getTasks() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tasks?select=*&order=priority.asc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  return res.json();
}

function getPriorityEmoji(priority) {
  const map = { high: "🔴", medium: "🟡", low: "🟢" };
  return map[priority] || "⚪";
}

function formatTaskList(tasks, label, emoji) {
  if (!tasks.length) return "";
  const lines = tasks
    .map((t) => `  ${getPriorityEmoji(t.priority)} ${t.title}`)
    .join("\n");
  return `\n${emoji} <b>${label}</b>\n${lines}`;
}

function getTodayDow() {
  // Returns 0=Sun, 1=Mon, ... 6=Sat in EST
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return now.getDay();
}

function getMonthName() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return now.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function getDateString() {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const DAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

exports.handler = async function (event, context) {
  try {
    const allTasks = await getTasks();
    const todayDow = getTodayDow();

    // Filter daily tasks (not completed today)
    const dailyTasks = allTasks.filter(
      (t) => t.freq === "daily" && t.repeat && !t.completed
    );

    // Filter weekly tasks for today's day of week
    const weeklyTasks = allTasks.filter((t) => {
      if (t.freq !== "weekly" || !t.repeat || t.completed) return false;
      const days = Array.isArray(t.days) ? t.days : JSON.parse(t.days || "[]");
      return days.includes(todayDow);
    });

    // Filter monthly tasks (show all non-completed monthly tasks)
    const monthlyTasks = allTasks.filter(
      (t) => t.freq === "monthly" && t.repeat && !t.completed
    );

    // Build message
    const dateStr = getDateString();
    const greetings = [
      "Good morning! ☀️",
      "Good morning! 🌸",
      "Rise and shine! 🌅",
    ];
    const greeting = greetings[new Date().getDate() % greetings.length];

    let message = `${greeting}\n<b>${dateStr}</b>\n\n`;
    message += `📋 <b>YOUR TASKS FOR TODAY</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━`;

    const dailySection = formatTaskList(dailyTasks, "DAILY TASKS", "🌤️");
    const weeklySection = formatTaskList(
      weeklyTasks,
      `WEEKLY — ${DAY_FULL[todayDow]}`,
      "📅"
    );
    const monthlySection = formatTaskList(
      monthlyTasks,
      `MONTHLY — ${getMonthName()}`,
      "📆"
    );

    if (!dailySection && !weeklySection && !monthlySection) {
      message += "\n\n✅ No pending tasks for today. Enjoy your day! 🎉";
    } else {
      message += dailySection + weeklySection + monthlySection;
    }

    const totalTasks =
      dailyTasks.length + weeklyTasks.length + monthlyTasks.length;
    message += `\n\n━━━━━━━━━━━━━━━━━━━━`;
    message += `\n📊 <b>${totalTasks} task${totalTasks !== 1 ? "s" : ""}</b> for today. You got this! 💪`;

    const result = await sendTelegram(message);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        tasks_sent: totalTasks,
        telegram_result: result,
      }),
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
