
const express = require('express');
const jwt = require('jsonwebtoken');
const xlsx = require('xlsx');
const cors = require('cors');
const db = require('./db');
const app = express();
const multer = require('multer');

app.use(cors());
app.use(express.json());


const upload = multer({ dest: 'uploads/' });
const secretKey = 'abcdmottamadi';


const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: 'Token required' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        req.user = decoded;
        next();
    });
};


const verifyAdmin = (req, res, next) => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
};


app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.query(
        'SELECT * FROM faculty WHERE email_id = ? AND mobile_number = ?',
        [email, password],
        (err, results) => {
            if (err || results.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
            const user = results[0];
            const token = jwt.sign({ faculty_id: user.faculty_id, is_admin: user.is_admin }, secretKey, { expiresIn: '1h' });
            res.json({ token });
        }
    );
});


app.post('/add-faculty', verifyToken, verifyAdmin, upload.single('file'), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = xlsx.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    const facultyData = data.map(row => [
        row.name,
        row.mobile_number,
        row.email_id,
        row.is_admin ? 1 : 0
    ]);

    db.query(
        'INSERT INTO faculty (name, mobile_number, email_id, is_admin) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name), mobile_number = VALUES(mobile_number), is_admin = VALUES(is_admin)',
        [facultyData],
        (err) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.send('Faculty added successfully');
        }
    );
});


app.post('/add-venues', verifyToken, verifyAdmin, upload.single('file'), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = xlsx.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);

    const venueData = data.map(row => [row['venue_id']]);

    db.query(
        'INSERT INTO venues (venue_id) VALUES ? ON DUPLICATE KEY UPDATE venue_id = VALUES(venue_id)',
        [venueData],
        (err) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.send('Venues added successfully');
        }
    );
});


app.post('/allocate', verifyToken, verifyAdmin, (req, res) => {
    db.query('SELECT faculty_id FROM faculty WHERE is_admin = 0', (err, faculties) => {
        if (err) return res.status(500).json({ error: 'Server error' });
        db.query('SELECT venue_id FROM venues', (err, venues) => {
            if (err) return res.status(500).json({ error: 'Server error' });

            const facultyIds = faculties.map(f => f.faculty_id);
            const venueIds = venues.map(v => v.venue_id);

            // Shuffle facultyIds
            for (let i = facultyIds.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [facultyIds[i], facultyIds[j]] = [facultyIds[j], facultyIds[i]];
            }

            const assignments = [];
            for (let i = 0; i < Math.min(facultyIds.length, venueIds.length); i++) {
                assignments.push([venueIds[i], facultyIds[i]]);
            }

            db.query('TRUNCATE TABLE allocations', (err) => {
                if (err) return res.status(500).json({ error: 'Server error' });
                if (assignments.length === 0) return res.send('No assignments possible');
                db.query(
                    'INSERT INTO allocations (venue_id, faculty_id) VALUES ?',
                    [assignments],
                    (err) => {
                        if (err) return res.status(500).json({ error: 'Server error' });
                        res.send('Allocation completed');
                    }
                );
            });
        });
    });
});


app.get('/assignment', verifyToken, (req, res) => {
    db.query(
        'SELECT venue_id FROM allocations WHERE faculty_id = ?',
        [req.user.faculty_id],
        (err, results) => {
            if (err) return res.status(500).json({ error: 'Server error' });
            res.json({ venue_id: results.length > 0 ? results[0].venue_id : null });
        }
    );
});

app.get('/download-allocation', verifyToken, verifyAdmin, (req, res) => {
    db.query(
        'SELECT v.venue_id, f.name, f.faculty_id FROM venues v LEFT JOIN allocations a ON v.venue_id = a.venue_id LEFT JOIN faculty f ON a.faculty_id = f.faculty_id',
        (err, results) => {
            if (err) return res.status(500).json({ error: 'Server error' });
            const data = results.map(row => ({
                'Venue': row.venue_id,
                'Faculty Name': row.name || 'Unassigned',
                'Faculty ID': row.faculty_id || ''
            }));
            const ws = xlsx.utils.json_to_sheet(data);
            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, 'Allocations');
            const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Disposition', 'attachment; filename=allocation.xlsx');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(buffer);
        }
    );
});

app.listen(5000, () => console.log('Server running on port 5000'));
