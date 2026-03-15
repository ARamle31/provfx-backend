const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors({
    origin: ['https://aramle31.github.io', 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true
}));

// Keep-alive health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/cloud.db' : './cloud.db';
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password TEXT, token TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS projects (projectId TEXT PRIMARY KEY, userId INTEGER, stateData TEXT, createdAt INTEGER, updatedAt INTEGER)");
});

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, ''))
});
const upload = multer({ storage });

// Routes
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    const token = Buffer.from(email + ':' + Date.now()).toString('base64');
    db.run("INSERT INTO users (name, email, password, token) VALUES (?, ?, ?, ?)", [name, email, password, token], function (err) {
        if (err) return res.status(400).json({ error: 'Email already exists' });
        res.json({ user: { id: this.lastID, name, email }, token });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ user: { id: user.id, name: user.name, email: user.email }, token: user.token });
    });
});

app.get('/api/session', (req, res) => {
    const token = req.headers.authorization;
    db.get("SELECT * FROM users WHERE token = ?", [token], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid session' });
        res.json({ user: { id: user.id, name: user.name, email: user.email } });
    });
});

app.get('/api/projects', (req, res) => {
    const userId = req.query.userId;
    db.all("SELECT projectId, stateData, createdAt, updatedAt FROM projects WHERE userId = ? ORDER BY updatedAt DESC", [userId], (err, projects) => {
        if (err) return res.status(500).json({ error: err.message });
        const mapped = projects.map(p => {
            const state = JSON.parse(p.stateData);
            return {
                projectId: p.projectId,
                title: state.state.title || "Untitled",
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
            };
        });
        res.json(mapped);
    });
});

app.get('/api/projects/:id', (req, res) => {
    db.get("SELECT * FROM projects WHERE projectId = ?", [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Project not found' });
        const parsed = JSON.parse(row.stateData);
        res.json({ stateData: parsed.state, files: parsed.files });
    });
});

app.post('/api/projects/:id', upload.fields([{ name: 'video' }, { name: 'image' }, { name: 'audio' }, { name: 'overlay' }]), (req, res) => {
    const projectId = req.params.id;
    const { userId, stateData } = req.body;

    let parsedState = { state: {}, files: {} };
    if (stateData) {
        parsedState = JSON.parse(stateData);
    }

    if (req.files) {
        ['video', 'image', 'audio', 'overlay'].forEach(key => {
            if (req.files[key]) {
                parsedState.files[key] = {
                    url: `${process.env.BASE_URL || 'http://localhost:3000'}/uploads/${req.files[key][0].filename}`,
                    name: req.files[key][0].originalname,
                    type: req.files[key][0].mimetype
                };
            }
        });
    }

    db.get("SELECT createdAt FROM projects WHERE projectId = ?", [projectId], (err, row) => {
        const createdAt = row ? row.createdAt : Date.now();
        db.run("INSERT OR REPLACE INTO projects (projectId, userId, stateData, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
            [projectId, userId, JSON.stringify(parsedState), createdAt, Date.now()],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, projectId, files: parsedState.files });
            }
        );
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ProVFX Cloud Server running on port ${PORT}`));
