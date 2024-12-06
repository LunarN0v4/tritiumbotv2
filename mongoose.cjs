const mongoose = require('mongoose');
const jsonc = require('jsonc-parser');
const fs = require('fs');

let config = jsonc.parse(fs.readFileSync('config.jsonc', 'utf8'));
const mongoosecon = config.mongoosecon;
config = undefined;

function exportmodels() {
    if (mongoose.connection.readyState === 0) {
        mongoose.connect(mongoosecon);
    }
    if (mongoose.models.User) {
        delete mongoose.models.User;
    }
    const userSchema = new mongoose.Schema({
        userid: String,
        accesslevel: Number,
        properties: Object,
    });
    mongoose.model('User', userSchema);
    mongoose.model('User').createIndexes({ userid: 1 }, { unique: true });
    return mongoose;
};

module.exports = {
    exportmodels,
};