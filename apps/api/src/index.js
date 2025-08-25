const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connectDB } = require('./config');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));

app.get('/', (req, res) => res.json({ ok: true }));
app.use('/auth', require('./routes/auth'));
app.use('/seed', require('./routes/seed'));
app.use('/companies', require('./routes/companies'));

connectDB().then(() => {
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log('API on ' + port));
});
