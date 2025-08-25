const dotenv = require('dotenv');
dotenv.config();
const mongoose = require('mongoose');

function connectDB() {
  return mongoose.connect(process.env.MONGO_URL, { dbName: 'hrms_monorepo' });
}

module.exports = { connectDB };
