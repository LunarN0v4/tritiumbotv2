import mongoose from 'mongoose';
import { parse as parseJsonc } from 'jsonc-parser';
import fs from 'fs';

let config = parseJsonc(fs.readFileSync('config.jsonc', 'utf8'));
const mongoosecon = config.mongoosecon;
config = undefined;

function exportmodels() {
    if (mongoose.connection.readyState === 0) {
        mongoose.connect(mongoosecon);
    }
    if (mongoose.models.User) {
        delete mongoose.models.User;
    }
    if (mongoose.models.Game) {
        delete mongoose.models.Game;
    }
    const userSchema = new mongoose.Schema({
        userid: String,
        accesslevel: Number,
        properties: Object,
    });
    const gameSchema = new mongoose.Schema({
        hostid: String,
        players: [Object],
        status: String,
        properties: Object,
    });
    mongoose.model('User', userSchema);
    mongoose.model('User').createIndexes({ userid: 1 }, { unique: true });
    mongoose.model('Game', gameSchema);
    mongoose.model('Game').createIndexes({ gameid: 1 }, { unique: true });
    mongoose.model('Game').createIndexes({ players: 1 });
    return mongoose;
};

export {
    exportmodels,
};