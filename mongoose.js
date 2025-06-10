import mongoose from 'mongoose';
import { parse as parseJsonc } from 'jsonc-parser';
import fs from 'fs';

let config;
try {
    config = parseJsonc(fs.readFileSync('config.jsonc', 'utf8'));
} catch (error) {
    config = {};
}
const mongoosefcon = config.mongoosecon;
config = undefined;

function exportmodels(mongoosecon=mongoosefcon) {
    if (mongoose.connection.readyState === 0) {
        mongoose.connect(mongoosecon);
    }
    if (mongoose.models.User) {
        delete mongoose.models.User;
    }
    if (mongoose.models.Game) {
        delete mongoose.models.Game;
    }
    if (mongoose.models.Poll) {
        delete mongoose.models.Poll;
    }
    if (mongoose.models.FeatureReq) {
        delete mongoose.models.FeatureReq;
    }
    const userSchema = new mongoose.Schema({
        userid: String,
        username: String,
        accesslevel: Number,
        properties: Object,
    });
    const gameSchema = new mongoose.Schema({
        hostid: String,
        players: [Object],
        status: String,
        properties: Object,
    });
    const pollSchema = new mongoose.Schema({
        pollid: String,
        question: String,
        options: [String],
        votes: [Number],
    });
    const featurereqSchema = new mongoose.Schema({
        reqid: String,
        userid: String,
        feature: String,
    });
    mongoose.model('User', userSchema);
    mongoose.model('User').createIndexes({ userid: 1 }, { unique: true });
    mongoose.model('Game', gameSchema);
    mongoose.model('Game').createIndexes({ gameid: 1 }, { unique: true });
    mongoose.model('Game').createIndexes({ players: 1 });
    mongoose.model('Poll', pollSchema);
    mongoose.model('Poll').createIndexes({ pollid: 1 }, { unique: true });
    mongoose.model('FeatureReq', featurereqSchema);
    mongoose.model('FeatureReq').createIndexes({ reqid: 1 }, { unique: true });
    return mongoose;
};

export {
    exportmodels,
};