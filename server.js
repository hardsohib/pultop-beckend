const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json());
// Serve your frontend HTML files (index.html, app.html, admin.html) if placed in a 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 1. ADMIN CREDENTIALS & CONSTANTS
// =========================================================================
const ADMIN_PHONE = "949903424";
const ADMIN_PASS = "Soha1212";
const REFERRAL_FIRST_TASK_BONUS = 5000;
const REFERRAL_COMMISSION_RATE = 0.10;

// =========================================================================
// 2. DATABASE INITIALIZATION (database.json)
// =========================================================================
const defaultData = {
    users: [],
    tasks: [
        {
            id: "T-1001",
            platform: "Telegram",
            type: "Obuna",
            title: "Toshkent Bozor rasmiy kanaliga obuna bo'ling",
            link: "https://t.me/telegram",
            reward: 100,
            doneCount: 0,
            totalCount: 100,
            ownerId: "ADMIN",
            ownerPhone: "+998 94 990 34 24",
            status: "active",
            completedBy: [],
            createdAt: new Date().toISOString().slice(0, 10)
        }
    ],
    minPrices: {
        Telegram:  { Obuna: 100, Layk: 50, Izoh: 50 },
        Instagram: { Obuna: 100, Layk: 50, Izoh: 50 },
        YouTube:   { Obuna: 100, Layk: 50, Izoh: 50 }
    },
    withdrawRequests: []
};

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// =========================================================================
// 3. AUTHENTICATION ROUTES (LOGIN & REGISTER)
// =========================================================================

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
    const { phone, password } = req.body;
    const cleanDigits = String(phone || '').replace(/\D/g, '').slice(-9);

    if (cleanDigits.length !== 9) {
        return res.status(400).json({ message: "9 xonali telefon raqamni to'liq kiriting!" });
    }

    // Check Admin Login (949903424 / Soha1212)
    if (cleanDigits === ADMIN_PHONE) {
        if (password === ADMIN_PASS) {
            return res.json({
                role: 'admin',
                user: { id: 'ADMIN-1', phone: '+998 94 990 34 24', role: 'admin' }
            });
        } else {
            return res.status(401).json({ message: "Admin paroli noto'g'ri!" });
        }
    }

    // Check Regular User
    const db = readDB();
    const user = db.users.find(u => u.cleanPhone === cleanDigits);

    if (!user) {
        return res.status(404).json({ message: "Bu raqam ro'yxatdan o'tmagan! Avval ro'yxatdan o'ting." });
    }
    if (user.password !== password) {
        return res.status(401).json({ message: "Parol noto'g'ri!" });
    }
    if (user.active === false) {
        return res.status(403).json({ message: "Sizning hisobingiz Admin tomonidan bloklangan!" });
    }

    res.json({ role: 'user', user });
});

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
    const { phone, password, refCode } = req.body;
    const cleanDigits = String(phone || '').replace(/\D/g, '').slice(-9);

    if (cleanDigits.length !== 9) {
        return res.status(400).json({ message: "9 xonali telefon raqamni to'liq kiriting!" });
    }
    if (cleanDigits === ADMIN_PHONE) {
        return res.status(400).json({ message: "Bu raqam Admin uchun band qilingan!" });
    }

    const db = readDB();
    if (db.users.some(u => u.cleanPhone === cleanDigits)) {
        return res.status(400).json({ message: "Bu telefon raqami allaqachon ro'yxatdan o'tgan!" });
    }

    let validReferrerId = null;
    if (refCode) {
        const inviter = db.users.find(u => u.id.toLowerCase() === String(refCode).trim().toLowerCase());
        if (inviter) validReferrerId = inviter.id;
    }

    const formattedPhone = `+998 ${cleanDigits.slice(0,2)} ${cleanDigits.slice(2,5)} ${cleanDigits.slice(5,7)} ${cleanDigits.slice(7,9)}`;
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const newUser = {
        id: "U-" + Math.floor(1000 + Math.random() * 9000),
        cleanPhone: cleanDigits,
        phone: formattedPhone,
        password: password,
        balance: 0,
        active: true,
        joinedAt: now,
        referredBy: validReferrerId,
        firstTaskBonusPaid: false,
        contributedToReferrer: 0,
        referral5000BonusEarned: 0,
        referral10PercentEarned: 0,
        completedTasks: []
    };

    db.users.unshift(newUser);
    writeDB(db);

    res.json({ role: 'user', user: newUser });
});

// =========================================================================
// 4. USER & TASKS ROUTES (EARN, CREATE, REFUND, REFERRALS)
// =========================================================================

// GET /api/bootstrap/:userId -> Get fresh user data, tasks, minPrices, referrals
app.get('/api/bootstrap/:userId', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.params.userId);
    if (!user || user.active === false) {
        return res.status(401).json({ message: "Foydalanuvchi topilmadi yoki bloklangan" });
    }
    const referrals = db.users.filter(u => u.referredBy === user.id).map(r => ({
        id: r.id,
        phone: r.phone,
        joinedAt: r.joinedAt,
        tasksDone: (r.completedTasks || []).length,
        firstTaskBonusPaid: r.firstTaskBonusPaid,
        contributedToReferrer: r.contributedToReferrer || 0
    }));

    res.json({
        user,
        tasks: db.tasks,
        minPrices: db.minPrices,
        referrals
    });
});

// POST /api/tasks/complete -> Complete a task & trigger 10% + 5000 so'm referral bonus
app.post('/api/tasks/complete', (req, res) => {
    const { userId, taskId } = req.body;
    const db = readDB();

    const userIdx = db.users.findIndex(u => u.id === userId);
    const taskIdx = db.tasks.findIndex(t => t.id === taskId);

    if (userIdx === -1 || taskIdx === -1) {
        return res.status(404).json({ message: "Vazifa yoki foydalanuvchi topilmadi!" });
    }

    const user = db.users[userIdx];
    const task = db.tasks[taskIdx];

    if (task.status === 'finished' || task.doneCount >= task.totalCount) {
        return res.status(400).json({ message: "Bu vazifa allaqachon yakunlangan!" });
    }
    if ((task.completedBy || []).includes(user.id)) {
        return res.status(400).json({ message: "Siz bu vazifani allaqachon bajargansiz!" });
    }

    // 1. Update Task
    task.doneCount += 1;
    if (!task.completedBy) task.completedBy = [];
    task.completedBy.push(user.id);
    if (task.doneCount >= task.totalCount) task.status = 'finished';

    // 2. Credit User
    const reward = Number(task.reward);
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    user.balance = Number(user.balance) + reward;
    user.completedTasks.push({
        taskId: task.id,
        title: `[${task.platform} ${task.type}] ${task.title}`,
        reward,
        time: now
    });

    // 3. Referral Payout (10% always + 5000 so'm on 1st completed task)
    if (user.referredBy) {
        const inviter = db.users.find(u => u.id === user.referredBy);
        if (inviter) {
            const commission = Math.round(reward * REFERRAL_COMMISSION_RATE);
            inviter.balance = Number(inviter.balance) + commission;
            inviter.referral10PercentEarned = Number(inviter.referral10PercentEarned || 0) + commission;
            user.contributedToReferrer = Number(user.contributedToReferrer || 0) + commission;

            if (!user.firstTaskBonusPaid && user.completedTasks.length >= 1) {
                user.firstTaskBonusPaid = true;
                inviter.balance += REFERRAL_FIRST_TASK_BONUS;
                inviter.referral5000BonusEarned = Number(inviter.referral5000BonusEarned || 0) + REFERRAL_FIRST_TASK_BONUS;
            }
        }
    }

    writeDB(db);
    res.json({ message: `+${reward} so'm qo'shildi!`, user, tasks: db.tasks });
});

// POST /api/tasks/create -> User creates a task
app.post('/api/tasks/create', (req, res) => {
    const { userId, platform, type, title, link, reward, count } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });

    const minAllowed = Number(db.minPrices[platform]?.[type] || 50);
    if (Number(reward) < minAllowed) {
        return res.status(400).json({ message: `${platform} ${type} uchun minimal narx ${minAllowed} so'm!` });
    }

    const totalCost = Number(reward) * Number(count);
    if (user.balance < totalCost) {
        return res.status(400).json({ message: "Balansingizda yetarli mablag' yo'q!" });
    }

    user.balance -= totalCost;

    const newTask = {
        id: "T-" + Math.floor(1000 + Math.random() * 9000),
        platform,
        type,
        title,
        link,
        reward: Number(reward),
        doneCount: 0,
        totalCount: Number(count),
        ownerId: user.id,
        ownerPhone: user.phone,
        status: "active",
        completedBy: [],
        createdAt: new Date().toISOString().slice(0, 10)
    };

    db.tasks.unshift(newTask);
    writeDB(db);
    res.json({ message: "Vazifa joylandi!", user, tasks: db.tasks });
});

// POST /api/tasks/refund -> Finish user's task & refund remaining balance
app.post('/api/tasks/refund', (req, res) => {
    const { userId, taskId } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.id === userId);
    const task = db.tasks.find(t => t.id === taskId && t.ownerId === userId);

    if (!user || !task || task.status === 'finished') {
        return res.status(400).json({ message: "Vazifa topilmadi yoki allaqachon yakunlangan!" });
    }

    const remaining = Math.max(0, task.totalCount - task.doneCount);
    const refundAmount = remaining * task.reward;

    task.status = 'finished';
    task.totalCount = task.doneCount;
    user.balance = Number(user.balance) + refundAmount;

    writeDB(db);
    res.json({ message: `${refundAmount} so'm qaytarildi!`, user, tasks: db.tasks });
});

// =========================================================================
// 5. ADMIN ROUTES (FULL CONTROL OVER USERS, BALANCES, TASKS, MIN PRICES)
// =========================================================================

// GET /api/admin/data
app.get('/api/admin/data', (req, res) => {
    const db = readDB();
    res.json(db);
});

// POST /api/admin/user/update -> Change balance (+/-/=), password, phone, active status
app.post('/api/admin/user/update', (req, res) => {
    const { id, phone, password, active, balanceMode, balanceAmount } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.id === id);
    if (!user) return res.status(404).json({ message: "Foydalanuvchi topilmadi!" });

    if (balanceMode && balanceAmount !== undefined) {
        const val = Number(balanceAmount);
        if (balanceMode === 'add') user.balance = Number(user.balance) + val;
        if (balanceMode === 'reduce') user.balance = Math.max(0, Number(user.balance) - val);
        if (balanceMode === 'set') user.balance = val;
    }

    if (phone) {
        user.phone = phone;
        user.cleanPhone = phone.replace(/\D/g, '').slice(-9);
    }
    if (password) user.password = password;
    if (active !== undefined) user.active = active;

    writeDB(db);
    res.json({ message: "Foydalanuvchi yangilandi!", db });
});

// DELETE /api/admin/user/:id
app.delete('/api/admin/user/:id', (req, res) => {
    const db = readDB();
    db.users = db.users.filter(u => u.id !== req.params.id);
    writeDB(db);
    res.json({ message: "Foydalanuvchi o'chirildi!", db });
});

// POST /api/admin/task/save -> Create or Edit any task
app.post('/api/admin/task/save', (req, res) => {
    const { id, platform, type, title, link, reward, doneCount, totalCount } = req.body;
    const db = readDB();

    if (id) {
        const idx = db.tasks.findIndex(t => t.id === id);
        if (idx > -1) {
            db.tasks[idx] = { ...db.tasks[idx], platform, type, title, link, reward: Number(reward), doneCount: Number(doneCount), totalCount: Number(totalCount) };
        }
    } else {
        db.tasks.unshift({
            id: "T-" + Math.floor(1000 + Math.random() * 9000),
            platform,
            type,
            title,
            link,
            reward: Number(reward),
            doneCount: Number(doneCount || 0),
            totalCount: Number(totalCount || 100),
            ownerId: "ADMIN",
            ownerPhone: "+998 94 990 34 24 (Admin)",
            status: "active",
            completedBy: [],
            createdAt: new Date().toISOString().slice(0, 10)
        });
    }

    writeDB(db);
    res.json({ message: "Vazifa saqlandi!", db });
});

// DELETE /api/admin/task/:id
app.delete('/api/admin/task/:id', (req, res) => {
    const db = readDB();
    db.tasks = db.tasks.filter(t => t.id !== req.params.id);
    writeDB(db);
    res.json({ message: "Vazifa o'chirildi!", db });
});

// POST /api/admin/min-prices -> Update minimum prices for Telegram, Instagram, YouTube
app.post('/api/admin/min-prices', (req, res) => {
    const db = readDB();
    db.minPrices = req.body.minPrices;
    writeDB(db);
    res.json({ message: "Minimal narxlar yangilandi!", db });
});

app.listen(PORT, () => {
    console.log(`✅ PulTop Backend Server ishga tushdi: http://localhost:${PORT}`);
});