import fs from 'fs';
import { parse as parseJsonc } from 'jsonc-parser';
import os from 'os';
import net from 'net';
import axios from 'axios';

const mc = new Map();
const gt = () => Date.now();
async function hotreloadable(mod) {
    const timestamp = gt();
    const cm = mc.get(mod);
    const sr = !cm || (timestamp - cm.timestamp > 1000);
    if (sr) {
        try {
            const module = await import(`${mod}?t=${timestamp}`);
            mc.set(mod, { module, timestamp });
            return module;
        } catch (error) {
            const module = await import(mod);
            mc.set(mod, { module, timestamp });
            return module;
        }
    }
    return cm.module;
}

const signalhandler = await hotreloadable('./signalhandler.js');
const mongoosemodule = await hotreloadable('./mongoose.js');
const { sendresponse, sendmessage, getcontacts } = signalhandler;
const { exportmodels } = mongoosemodule;
const mongoose = exportmodels();

let config = parseJsonc(fs.readFileSync('config.jsonc', 'utf8'));
const prefix = config.prefix || '-';
const botname = config.botname || 'TritiumBot';
const phonenumber = config.phonenumber;
const managedaccount = config.managedaccount;
config = undefined;

function escapereg(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ic = /[\u00AD\u200B\u200C\u200D\u2060\uFEFF\uFE00-\uFE0F]/gu;

const guestcommands = {
    "register": {
        description: `Register your Signal account with ${botname}`,
        arguments: null,
        execute: async (envelope, message) => {
            const User = mongoose.model('User');
            try {
                const searchuser = await User.findOne({ userid: envelope.sourceUuid });
                if (searchuser) {
                    await sendresponse(`You are already registered as a ${botname} user $MENTIONUSER.`, envelope, `${prefix}register`, true);
                    return;
                } else {
                    const contact = await getcontacts(phonenumber, envelope.sourceUuid);
                    const profile = contact.profile;
                    let name;
                    if (profile && profile.givenName && profile.givenName !== null) {
                        name = profile.givenName;
                    } else {
                        name = 'Unknown';
                    }
                    const user = new User({
                        userid: envelope.sourceUuid,
                        username: name,
                        accesslevel: 0,
                        properties: {tags: []},
                    });
                    await user.save();
                    await sendresponse(`You are now registered as a ${botname} user $MENTIONUSER!`, envelope, `${prefix}register`);
                    if (!contact) {
                        await sendmessage(`Hiya user!\nIt seems you have registered for a ${botname} account without sending me a DM first.\nThat's okay if so!\nPlease accept this message request so I can get to know you better.`, envelope.sourceUuid, phonenumber);
                        return;
                    }
                    if (profile && profile.givenName != null && profile.givenName !== '') {
                        return;
                    } else {
                        await sendmessage(`Hiya user!\nIt seems you have registered for a ${botname} account without sending me a DM first.\nThat's okay if so!\nPlease accept this message request so I can get to know you better.`, envelope.sourceUuid, phonenumber);
                    }
                }
            } catch (err) {
                await sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}register`, true);
            }
        }
    }
};

const usercommands = {
    "unregister": {
        description: `Delete all your data from ${botname}`,
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                await User.deleteOne({ userid: envelope.sourceUuid });
                await sendresponse(`You are no longer registered as a ${botname} user $MENTIONUSER.`, envelope, `${prefix}unregister`);
            } catch (err) {
                await sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}unregister`, true);
            }
        }
    },
    "subscribe": {
        description: `Subscribe to ${botname} broadcasts`,
        arguments: ['true / false'],
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties) {
                    user.properties = {};
                }
                if (new RegExp(`^${escapereg(prefix)}subscribe\\s+true$`, 'i').test(message.trim())) {
                    user.properties.subscribed = true;
                    user.markModified('properties');
                    await user.save();
                    await sendresponse(`You are now subscribed to ${botname} broadcasts $MENTIONUSER!`, envelope, `${prefix}subscribe true`, false);
                    return;
                }
                if (new RegExp(`^${escapereg(prefix)}subscribe\\s+false$`, 'i').test(message.trim())) {
                    user.properties.subscribed = false;
                    user.markModified('properties');
                    await user.save();
                    await sendresponse(`You are now unsubscribed from ${botname} broadcasts $MENTIONUSER!`, envelope, `${prefix}subscribe false`, false);
                    return;
                }
                sendresponse(`Invalid argument.\nUse "-subscribe true" or "-subscribe false" to subscribe or unsubscribe from ${botname} broadcasts.`, envelope, `${prefix}subscribe`, true);
            } catch (err) {
                await sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}subscribe`, true);
            }
        }
    },
    "getprops": {
        description: "Get your properties from the database",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                const properties = user.properties || {};
                let pm = 'Your properties:\n';
                const fv = (value) => {
                    if (Array.isArray(value)) {
                        return value.map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
                    } else if (typeof value === 'object' && value !== null) {
                        return JSON.stringify(value);
                    }
                    return String(value);
                };

                for (const prop in properties) {
                    if (prop === 'authkey') {
                        pm += `authkey: [womp womp no key 4 u]\n`;
                    } else {
                        if (Object.prototype.hasOwnProperty.call(properties, prop)) {
                            pm += `${prop}: ${fv(properties[prop])}\n`;
                        }
                    }
                }
                pm = pm.trim();
                await sendresponse(pm, envelope, `${prefix}getprops`, false);
            } catch (err) {
                await sendresponse('Failed to retrieve your properties. Please try again later.', envelope, `${prefix}getprops`, true);
            }
        }
    },
    "nick": {
        description: `Set your nickname for ${botname}`,
        arguments: ['nickname'],
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties) {
                    user.properties = {};
                }
                const match = message.match(new RegExp(`^${escapereg(prefix)}nick\\s+(.+)$`, 'i'));
                if (!match || !match[1] || match[1].trim().length === 0) {
                    await sendresponse('Please provide a valid nickname.', envelope, `${prefix}nick`, true);
                    return;
                }
                const nickname = match[1].trim();
                user.properties.nickname = nickname;
                user.markModified('properties');
                await user.save();
                await sendresponse(`Your nickname has been set to "${nickname}" $MENTIONUSER!`, envelope, `${prefix}nick`, false);
            } catch (err) {
                await sendresponse('Failed to set your nickname. Please try again later.', envelope, `${prefix}nick`, true);
            }
        }
    },
    "authkey": {
        description: `Create an AuthKey for ${botname} services`,
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties) {
                    user.properties = user.properties || {};
                }
                const kbuf = new Uint8Array(128);
                for (let i = 0; i < 128; i++) {
                    kbuf[i] = Math.floor(Math.random() * 256);
                }
                user.properties.authkey = {
                    key: Array.from(kbuf),
                    createdat: Date.now()
                };
                user.markModified('properties');
                await user.save();
                const sidbuf = Buffer.from(envelope.sourceUuid, 'utf8');
                const akbuf = Buffer.from(user.properties.authkey.key);
                const cbuf = Buffer.concat([sidbuf, akbuf]);
                const token = cbuf.toString('base64');
                
                const am = `Hiya $MENTIONUSER!\nYour AuthKey is:\n${token}\n\nYou can use this key for sites like https://tritiumweb.zeusteam.dev/ that use ${botname} as an SSO provider`;
                
                if (envelope.dataMessage) {
                    const dataMessage = envelope.dataMessage;
                    const groupInfo = dataMessage.groupInfo;
                    if (groupInfo && groupInfo.groupId) {
                        await sendresponse(`Please check your DMs $MENTIONUSER for your AuthKey.`, envelope, `${prefix}authkey`, true);
                        await sendmessage(am, envelope.sourceUuid, phonenumber);
                    } else {
                        await sendresponse(am, envelope, `${prefix}authkey`, false);
                    }
                } else if (envelope.syncMessage) {
                    await sendresponse(`Please check your DMs $MENTIONUSER for your AuthKey.`, envelope, `${prefix}authkey`, true);
                    await sendmessage(am, envelope.sourceUuid, phonenumber);
                } else {
                    await sendresponse(am, envelope, `${prefix}authkey`, false);
                }
            } catch (err) {
                await sendresponse('Failed to create AuthKey. Please try again later.', envelope, `${prefix}authkey`, true);
            }
        },
    },
    "featurereq": {
        description: `Request a new feature for ${botname} (and related services)`,
        arguments: ['feature'],
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties) {
                    user.properties = {};
                }
                const match = message.match(new RegExp(`^${escapereg(prefix)}featurereq\\s+(.+)$`, 'i'));
                if (!match || !match[1] || match[1].trim().length === 0) {
                    await sendresponse('Please provide a valid feature request after the command.', envelope, `${prefix}featurereq`, true);
                    return;
                }
                const feature = match[1].trim();
                const FeatureReq = mongoose.model('FeatureReq');
                const reqid = `req-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                const featurereq = new FeatureReq({
                    reqid: reqid,
                    userid: envelope.sourceUuid,
                    feature: feature,
                });
                await featurereq.save();
                await sendresponse(`Your feature request has been submitted with ID ${reqid}.\nThank you!`, envelope, `${prefix}featurereq`, false);
                await sendmessage(`New feature request from ${user.username} (${envelope.sourceUuid}):\nRequest ID: ${reqid}\nFeature: ${feature}`, managedaccount, phonenumber);
            } catch (err) {
                await sendresponse('Failed to submit your feature request. Please try again later.', envelope, `${prefix}featurereq`, true);
            }
        }
    },
    "poll": {
        description: "View and vote on polls",
        arguments: ['pollid', 'optionid'],
        execute: async (envelope, message) => {
            try {
                const Poll = mongoose.model('Poll');
                const match = message.match(new RegExp(`^${escapereg(prefix)}poll(?:\\s+(\\S+)(?:\\s+(\\S+))?)?$`, 'i'));
                if (!match || !match[1]) {
                    const polls = await Poll.find({});
                    if (polls.length === 0) {
                        await sendresponse('No polls are currently running.', envelope, `${prefix}poll`, true);
                        return;
                    }
                    let pm = 'Running polls:\n';
                    polls.forEach(poll => {
                        pm += `- ID: ${poll.pollid}\n  Question: ${poll.question}\n\n`;
                    });
                    await sendresponse(pm.trim(), envelope, `${prefix}poll`, false);
                    return;
                }
                const pollid = match[1];
                const poll = await Poll.findOne({ pollid: pollid });
                if (!poll) {
                    await sendresponse(`Poll with ID ${pollid} not found.`, envelope, `${prefix}poll`, true);
                    return;
                }
                if (!match[2]) {
                    const uhv = poll.voters && poll.voters.includes(envelope.sourceUuid);
                    const tv = poll.votes ? poll.votes.reduce((sum, count) => sum + count, 0) : 0;
                    let pm = `Poll ID: ${poll.pollid}\nQuestion: ${poll.question}\nOptions:\n`;
                    if (uhv) {
                        poll.options.forEach((option, index) => {
                            const voteCount = poll.votes ? poll.votes[index] || 0 : 0;
                            pm += `${index + 1}. ${option} (${voteCount} votes)\n`;
                        });
                    }
                    if (!poll.votes || !Array.isArray(poll.votes)) {
                        return;
                    } else {
                        poll.options.forEach((option, index) => {
                            pm += `${index + 1}. ${option}\n`;
                        });
                    }
                    pm += `\nTotal votes: ${tv}`;
                    await sendresponse(pm.trim(), envelope, `${prefix}poll`, false);
                    return;
                }
                const vin = parseInt(match[2]) - 1;
                if (isNaN(vin) || vin < 0 || vin >= poll.options.length) {
                    await sendresponse('Invalid vote. Please provide a valid option number.', envelope, `${prefix}poll`, true);
                    return;
                }
                
                if (!poll.voters) {
                    poll.voters = [];
                }
                if (poll.voters.includes(envelope.sourceUuid)) {
                    await sendresponse('You have already voted on this poll.', envelope, `${prefix}poll`, true);
                    return;
                }
                
                if (!poll.votes || !Array.isArray(poll.votes)) {
                    poll.votes = Array(poll.options.length).fill(0);
                }
                poll.votes[vin]++;
                poll.voters.push(envelope.sourceUuid);
                await poll.save();
                await sendresponse(`Your vote for "${poll.options[vin]}" has been recorded.`, envelope, `${prefix}poll`, false);
            } catch (err) {
                await sendresponse('Failed to retrieve or vote on the poll. Please try again later.', envelope, `${prefix}poll`, true);
            }
        }
    },
    "module": {
        description: `Manage your ${botname} modules`,
        arguments: ['module', 'enable/disable'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}module(?:\\s+(\\S+)(?:\\s+(enable|disable))?)?$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments. Use "-module [module] [enable/disable]" to enable or disable a module.', envelope, `${prefix}module`, true);
                    return;
                }
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                const avamods = modules.filter(m => m.user && !m.admin);
                const enamods = user && user.properties && user.properties.tags ? user.properties.tags : [];
                if (!match[1]) {
                    if (avamods.length === 0) {
                        await sendresponse('No modules are available.', envelope, `${prefix}module`, true);
                        return;
                    }
                    const avamods2 = avamods.filter(m => !enamods.includes(m.section));
                    let modlist = '';
                    if (enamods.length > 0) {
                        modlist += 'Enabled modules:\n';
                        enamods.forEach(tag => {
                            const module = avamods.find(m => m.section === tag);
                            if (module) {
                                modlist += `- ${tag}\n`;
                            }
                        });
                        if (user.accesslevel === 1) {
                            modlist += '- admin (this is purely cosmetic, this cannot be disabled)\n';
                        }
                    }
                    if (avamods2.length > 0) {
                        modlist += 'Available modules:\n';
                        avamods2.forEach(module => {
                            modlist += `- ${module.section}\n`;
                        });
                    }
                    modlist += `\nUse "${prefix}module [module] [enable/disable]" to enable or disable a module.`;
                    modlist = modlist.trim();
                    await sendresponse(modlist, envelope, `${prefix}module`, false);
                    return;
                }
                if (!match[2]) {
                    await sendresponse('Invalid arguments. Use "-module [module] [enable/disable]" to enable or disable a module.', envelope, `${prefix}module`, true);
                    return;
                }
                const module = match[1].toLowerCase();
                const action = match[2].toLowerCase();
                if (!user.properties) {
                    user.properties = {};
                }
                if (!user.properties.tags) {
                    user.properties.tags = [];
                }
                if (!avamods.some(m => m.section === module)) {
                    await sendresponse(`Module "${module}" doesn't appear to exist.`, envelope, `${prefix}module`, true);
                    return;
                }
                if (action === 'enable') {
                    if (user.properties.tags.includes(module)) {
                        await sendresponse(`Module "${module}" is already enabled.`, envelope, `${prefix}module`, true);
                        return;
                    }
                    const mod = modules.find(m => m.section === module);
                    if (mod && mod.execute) {
                        await mod.execute(user);
                    }
                    user.properties.tags = [...(user.properties.tags || []), `${module}`];
                    await sendresponse(`Module "${module}" has been enabled.`, envelope, `${prefix}module`, false);
                } else if (action === 'disable') {
                    if (!user.properties.tags.includes(module)) {
                        await sendresponse(`Module "${module}" is not enabled.`, envelope, `${prefix}module`, true);
                        return;
                    }
                    user.properties.tags = user.properties.tags.filter(tag => tag !== module);
                    await sendresponse(`Module "${module}" has been disabled.`, envelope, `${prefix}module`, false);
                } else {
                    await sendresponse('Invalid action. Use "enable" or "disable".', envelope, `${prefix}module`, true);
                    return;
                }
                user.markModified('properties');
                await user.save();
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to manage modules. Please try again later.', envelope, `${prefix}module`, true);
            }
        }
    }
};

const ecocommands = {
    "wallet": {
        description: "Get your wallet balance",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties || !user.properties.eco) {
                    user.properties.eco = { balance: 0 };
                    user.markModified('properties');
                    await user.save();
                }
                let bal = user.properties.eco.balance || 0;
                if (typeof bal === 'number') {
                    bal = Math.floor(bal);
                    user.properties.eco.balance = bal;
                    user.markModified('properties');
                    await user.save();
                }
                await sendresponse(`Your wallet balance is: E${bal}`, envelope, `${prefix}wallet`, false);
            } catch (err) {
                await sendresponse('Failed to retrieve your wallet balance. Please try again later.', envelope, `${prefix}wallet`, true);
            }
        }
    },
    "daily": {
        description: "Claim your daily reward",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties || !user.properties.eco) {
                    user.properties.eco = { balance: 0, daily: 0 };
                    user.markModified('properties');
                    await user.save();
                }
                const ct = Date.now();
                const daily = user.properties.eco.daily || 0;
                const cd = 18 * 60 * 60 * 1000;
                if (ct - daily < cd) {
                    await sendresponse('You can only claim your daily reward once every 18 hours.', envelope, `${prefix}daily`, true);
                    return;
                }
                const reward = Math.floor(Math.random() * 400) + 100;
                user.properties.eco.balance += reward;
                user.properties.eco.balance = Math.floor(user.properties.eco.balance);
                user.properties.eco.daily = ct;
                user.markModified('properties');
                await user.save();
                await sendresponse(`You have claimed your daily reward of E${reward}! Your new balance is E${user.properties.eco.balance}.`, envelope, `${prefix}daily`, false);
            } catch (err) {
                await sendresponse('Failed to claim your daily reward. Please try again later.', envelope, `${prefix}daily`, true);
            }
        }
    },
    "work": {
        description: "Work to earn money",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties || !user.properties.eco) {
                    user.properties = user.properties || {};
                    user.properties.eco = { balance: 0 };
                    user.markModified('properties');
                    await user.save();
                }
                const cd = 60 * 60 * 1000;
                const ct = Date.now();
                const work = user.properties.eco.work || 0;
                if (ct - work < cd) {
                    await sendresponse('You can only work once every hour.', envelope, `${prefix}work`, true);
                    return;
                }
                const earnings = Math.floor(Math.random() * 200) + 50;
                user.properties.eco.balance += earnings;
                user.properties.eco.balance = Math.floor(user.properties.eco.balance);
                user.properties.eco.work = ct;
                user.markModified('properties');
                await user.save();
                await sendresponse(`You worked hard and earned E${earnings}! Your new balance is E${user.properties.eco.balance}.`, envelope, `${prefix}work`, false);
            } catch (err) {
                await sendresponse('Failed to work. Please try again later.', envelope, `${prefix}work`, true);
            }
        }
    },
    "give": {
        description: "Give money to another user",
        arguments: ['user', 'amount'],
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const match = message.match(new RegExp(`^${escapereg(prefix)}give\\s+(\\S+)\\s+(\\S+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments. Use "-give [user] [amount]" to give money to another user.', envelope, `${prefix}give`, true);
                    return;
                }
                const tui = match[1];
                const amount = parseInt(match[2]);
                if (isNaN(amount) || amount <= 0) {
                    await sendresponse('Please specify a valid amount to give.', envelope, `${prefix}give`, true);
                    return;
                }
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user || !user.properties || !user.properties.eco || user.properties.eco.balance < amount) {
                    await sendresponse('You do not have enough balance to give this amount.', envelope, `${prefix}give`, true);
                    return;
                }
                const tu = await User.findOne({ userid: tui });
                if (!tu) {
                    await sendresponse('User not found.', envelope, `${prefix}give`, true);
                    return;
                }
                if (!tu.properties || !tu.properties.eco) {
                    tu.properties = tu.properties || {};
                    tu.properties.eco = { balance: 0 };
                }
                user.properties.eco.balance -= amount;
                tu.properties.eco.balance += amount;
                user.markModified('properties');
                tu.markModified('properties');
                await user.save();
                await tu.save();
                await sendmessage(`You have received E${amount} from ${user.userid}. Your new balance is E${tu.properties.eco.balance}.`, tui, phonenumber);
                await sendresponse(`You have given E${amount} to ${tui}. Your new balance is E${user.properties.eco.balance}.`, envelope, `${prefix}give`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to give money. Please try again later.', envelope, `${prefix}give`, true);
            }
        }
    }
};

const adminonlycommands = {
    "proxymsg": {
        description: "Proxy a message to another user",
        arguments: ['signalid', 'bot', 'message'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}proxymsg\\s+(\\S+)\\s+(\\S+)\\s+(.+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-proxymsg [signalid] [bot] [message]" to proxy a message to another user.', envelope, `${prefix}proxymsg`, true);
                    return;
                }
                const tui = match[1];
                const bot = match[2];
                const proxmsg = match[3];
                if (!tui || !proxmsg) {
                    await sendresponse('Invalid arguments.\nUse "-proxymsg [signalid] [bot] [message]" to proxy a message to another user.', envelope, `${prefix}proxymsg`, true);
                    return;
                }
                await sendmessage(proxmsg, tui, (bot === 'true') ? phonenumber : managedaccount);
                await sendresponse(`Message successfully proxied to ${tui}.\nMessage: ${proxmsg}`, envelope, `${prefix}proxymsg`, false);
            } catch (err) {
                await sendresponse('Somehow this command failed. Please try again later.', envelope, `${prefix}proxymsg`, true);
            }
        }
    },
    "changetags": {
        description: "Change the tags of a user by their userid",
        arguments: ['userid', 'tags'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}changetags\\s+(\\S+)\\s+"([^"]+)"$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-changetags [userid] "[tags]"" to set tags for a user.', envelope, `${prefix}changetags`, true);
                    return;
                }
                const tui = match[1];
                const nt = match[2].split(/\s+/).filter(Boolean);
                const User = mongoose.model('User');
                let userobject = await User.findOne({ userid: tui });
                if (!userobject) {
                    const nu = new User({
                        userid: tui,
                        accesslevel: 0,
                        properties: { tags: [] },
                    });
                    await nu.save();
                    const cu = await User.findOne({ userid: tui });
                    userobject = cu;
                }
                if (!userobject.properties) userobject.properties = {};
                userobject.properties.tags = nt;
                userobject.markModified('properties');
                await userobject.save();
                await sendresponse(`Tags for user ${tui} have been updated to: ${nt.join(', ')}`, envelope, `${prefix}changetags`, false);
            } catch (err) {
                await sendresponse('Failed to change tags. Please try again later.', envelope, `${prefix}changetags`, true);
            }
        }
    },
    "getusers": {
        description: "Get a list of users from the database",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const users = await User.find({});
                if (users.length === 0) {
                    await sendresponse('No users found in the database.', envelope, `${prefix}getusers`, true);
                    return;
                }
                let contacts;
                try {
                    contacts = await getcontacts();
                } catch (err) {
                    console.error('Failed to retrieve contacts:', err);
                    await sendresponse('Failed to retrieve contacts. Please check the logs for more information.', envelope, `${prefix}getusers`, true);
                    return;
                }
                if (!Array.isArray(contacts)) {
                    console.error('Contacts is not an array:', typeof contacts, contacts);
                    await sendresponse('Invalid contacts data received. Please check the logs for more information.', envelope, `${prefix}getusers`, true);
                    return;
                }
                const ulm = users.map(user => {
                    let contact;
                    if (Array.isArray(contacts)) {
                        contact = contacts.find(c => c.uuid === user.userid);
                    }
                    const profile = contact ? contact.profile : {};
                    const name = profile.givenName + (profile.familyName ? ` ${profile.familyName}` : '');
                    if (profile.givenName && (!user.username || user.username !== profile.givenName)) {
                        user.username = profile.givenName;
                        user.save().catch(err => console.error('Failed to save username:', err));
                    }
                    return {
                        userid: user.userid,
                        accesslevel: user.accesslevel,
                        tags: user.properties ? user.properties.tags : [], 
                        name: name ? name : 'Unknown'
                    };
                });
                let ul = 'Users:\n';
                ulm.forEach(user => {
                    ul += `- ${user.userid} (${user.name}) (Is Admin: ${user.accesslevel === 1 ? 'true' : 'false'})${user.tags.length > 0 ? ` (Tags: ${user.tags.join(', ')})` : ''}\n`;
                });
                await sendresponse(ul.trim(), envelope, `${prefix}getusers`, false);
            } catch (err) {
                await sendresponse('Failed to retrieve users. Please try again later.', envelope, `${prefix}getusers`, true);
            }
        }
    },
    "broadcast": {
        description: "Send a message to all users",
        arguments: ['onlysubscribed', 'message'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}broadcast\\s+(\\S+)\\s+([\\s\\S]+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-broadcast [onlysubscribed] [message]" to send a message to all users.', envelope, `${prefix}broadcast`, true);
                    return;
                }
                const onlysubscribed = match[1];
                const bm = match[2];
                if (!bm) {
                    await sendresponse('Invalid arguments.\nUse "-broadcast [onlysubscribed] [message]" to send a message to all users.', envelope, `${prefix}broadcast`, true);
                    return;
                }
                if (onlysubscribed !== 'true' && onlysubscribed !== 'false') {
                    await sendresponse('Invalid value for onlysubscribed. Use "true" or "false".', envelope, `${prefix}broadcast`, true);
                    return;
                }
                const User = mongoose.model('User');
                const users = await User.find({});
                if (users.length === 0) {
                    await sendresponse('No users found in the database.', envelope, `${prefix}broadcast`, true);
                    return;
                }
                let sc = 0;
                for (const user of users) {
                    if (onlysubscribed === 'true' && (!user.properties || !user.properties.subscribed)) {
                        continue;
                    }
                    try {
                        await sendmessage(bm, user.userid, phonenumber);
                        await new Promise(resolve => setTimeout(resolve, 100));
                        sc++;
                    } catch (err) {
                        console.error(`Failed to send message to user ${user.userid}:`, err);
                    }
                }
                await sendresponse(`Broadcast message sent to ${sc} users.`, envelope, `${prefix}broadcast`, false);
            } catch (err) {
                console.log('Failed to execute broadcast command:', err);
                await sendresponse('Somehow this command failed. Please try again later.', envelope, `${prefix}broadcast`, true);
            }
        }
    },
    "delprop": {
        description: "Delete a property from a user",
        arguments: ['userid', 'property'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}delprop\\s+(\\S+)\\s+(\\S+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-delprop [userid] [property]" to delete a property from a user.', envelope, `${prefix}delprop`, true);
                    return;
                }
                const tui = match[1];
                const property = match[2];
                const User = mongoose.model('User');
                let userobject = await User.findOne({ userid: tui });
                if (!userobject) {
                    await sendresponse(`User ${tui} not found.`, envelope, `${prefix}delprop`, true);
                    return;
                }
                if (!userobject.properties || !userobject.properties.hasOwnProperty(property)) {
                    await sendresponse(`Property "${property}" not found for user ${tui}.`, envelope, `${prefix}delprop`, true);
                    return;
                }
                delete userobject.properties[property];
                userobject.markModified('properties');
                await userobject.save();
                await sendresponse(`Property "${property}" deleted for user ${tui}.`, envelope, `${prefix}delprop`, false);
            } catch (err) {
                await sendresponse('Failed to delete property. Please try again later.', envelope, `${prefix}delprop`, true);
            }
        }
    },
    "nukeprop": {
        description: "Delete property from all users",
        arguments: ['property'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}nukeprop\\s+(\\S+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-nukeprop [property]" to delete a property from all users.', envelope, `${prefix}nukeprop`, true);
                    return;
                }
                const property = match[1];
                const User = mongoose.model('User');
                const users = await User.find({});
                if (users.length === 0) {
                    await sendresponse('No users found in the database.', envelope, `${prefix}nukeprop`, true);
                    return;
                }
                let dc = 0;
                for (const user of users) {
                    if (user.properties && user.properties.hasOwnProperty(property)) {
                        delete user.properties[property];
                        user.markModified('properties');
                        await user.save();
                        dc++;
                    }
                }
                await sendresponse(`Property "${property}" deleted from ${dc} users.`, envelope, `${prefix}nukeprop`, false);
            } catch (err) {
                await sendresponse('Failed to delete property from all users. Please try again later.', envelope, `${prefix}nukeprop`, true);
            }
        }
    },
    "peerprops": {
        description: "Get properties of a user by their Signal ID",
        arguments: ['userid'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}peerprops\\s+(\\S+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-peerprops [userid]" to get properties of a user.', envelope, `${prefix}peerprops`, true);
                    return;
                }
                const tui = match[1];
                const User = mongoose.model('User');
                let userobject = await User.findOne({ userid: tui });
                if (!userobject) {
                    await sendresponse(`User ${tui} not found.`, envelope, `${prefix}peerprops`, true);
                    return;
                }
                if (!userobject.properties) {
                    await sendresponse(`No properties found for user ${tui}.`, envelope, `${prefix}peerprops`, true);
                    return;
                }
                let props = '';
                for (const prop in userobject.properties) {
                    if (Object.prototype.hasOwnProperty.call(userobject.properties, prop)) {
                        props += `${prop}: ${JSON.stringify(userobject.properties[prop])}\n`;
                    }
                }
                if (props === '') {
                    await sendresponse(`No properties found for user ${tui}.`, envelope, `${prefix}peerprops`, true);
                    return;
                }
                await sendresponse(`Properties for user ${tui}:\n${props.trim()}`, envelope, `${prefix}peerprops`, false);
            } catch (err) {
                await sendresponse('Failed to retrieve properties. Please try again later.', envelope, `${prefix}peerprops`, true);
            }
        }
    },
    "jitsi": {
        description: "Generate a CTC Jitsi link",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                const code = Array.from({length: 128}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
                const l = `https://meet.chadthundercock.com/${code}`;
                await sendresponse(`${l}`, envelope, `${prefix}jitsi`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to generate Jitsi link. Please try again later.', envelope, `${prefix}jitsi`, true);
            }
        }
    },
    "listfrs": {
        description: "List all feature requests",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const FeatureReq = mongoose.model('FeatureReq');
                const frs = await FeatureReq.find({});
                if (frs.length === 0) {
                    await sendresponse('No feature requests found.', envelope, `${prefix}listfrs`, true);
                    return;
                }
                let frl = 'Feature Requests:\n';
                frs.forEach(req => {
                    frl += `- ID: ${req.reqid}\n  User: ${req.userid}\n  Feature: ${req.feature}\n`;
                });
                await sendresponse(frl.trim(), envelope, `${prefix}listfrs`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to retrieve feature requests. Please try again later.', envelope, `${prefix}listfrs`, true);
            }
        }
    },
    "delfr": {
        description: "Delete a feature request by its ID",
        arguments: ['reqid', 'reason'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}delfr\\s+(\\S+)(?:\\s+(.+))?$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-delfr [reqid]" to delete a feature request by its ID.', envelope, `${prefix}delfr`, true);
                    return;
                }
                const reqid = match[1];
                const reason = match[2] || 'No reason provided';
                const FeatureReq = mongoose.model('FeatureReq');
                const featurereq = await FeatureReq.findOne({ reqid: reqid });
                if (!featurereq) {
                    await sendresponse(`Feature request with ID ${reqid} not found.`, envelope, `${prefix}delfr`, true);
                    return;
                }
                await sendmessage(`Your feature request with ID ${reqid} has been closed.\nReason: ${reason}`, featurereq.userid, phonenumber);
                await featurereq.deleteOne();
                await sendresponse(`Feature request with ID ${reqid} has been deleted.`, envelope, `${prefix}delfr`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to delete feature request. Please try again later.', envelope, `${prefix}delfr`, true);
            }
        }
    },
    "mkpoll": {
        description: "Create a poll",
        arguments: ['"question"', '"option1"', '"option2"', '...'],
        execute: async (envelope, message) => {
            try {
                const matches = [...message.matchAll(/"([^"]*)"/g)];
                if (matches.length < 3) {
                    await sendresponse('Invalid arguments.\nUse "-mkpoll "question" "option1" "option2" ..." to create a poll.', envelope, `${prefix}mkpoll`, true);
                    return;
                }
                const question = matches[0][1];
                const options = matches.slice(1).map(match => match[1]);
                if (options.length < 2) {
                    await sendresponse('Please provide at least two options for the poll.', envelope, `${prefix}mkpoll`, true);
                    return;
                }
                const Poll = mongoose.model('Poll');
                const pollid = `poll-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
                const votes = new Array(options.length).fill(0);
                const poll = new Poll({
                    pollid: pollid,
                    question: question,
                    options: options,
                    votes: votes
                });
                await poll.save();
                const pm = `Poll created with ID: ${pollid}\nQuestion: ${question}\nOptions:\n${options.map((opt, idx) => `${idx+1}. ${opt}`).join('\n')}`;
                await sendresponse(pm, envelope, `${prefix}mkpoll`, false);
                const User = mongoose.model('User');
                const users = await User.find({});
                if (users.length === 0) {
                    await sendresponse('No users found in the database.', envelope, `${prefix}broadcast`, true);
                    return;
                }
                for (const user of users) {
                    try {
                        await sendmessage(`New poll created: ${pollid}\nQuestion: ${question}\n\nView the options with "-poll ${pollid}"\nVote an option with "-poll ${pollid} [optionid]"`, user.userid, phonenumber);
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (err) {
                        console.error(`Failed to send message to user ${user.userid}:`, err);
                    }
                }
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to create poll. Please try again later.', envelope, `${prefix}mkpoll`, true);
            }
        }
    },
    "closepoll": {
        description: "Close a poll by its ID",
        arguments: ['pollid'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}closepoll\\s+(\\S+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-closepoll [pollid]" to close a poll by its ID.', envelope, `${prefix}closepoll`, true);
                    return;
                }
                const pollid = match[1];
                const Poll = mongoose.model('Poll');
                const poll = await Poll.findOne({ pollid: pollid });
                if (!poll) {
                    await sendresponse(`Poll with ID ${pollid} not found.`, envelope, `${prefix}closepoll`, true);
                    return;
                }
                let rm = `Poll Results for "${poll.question}":\n\n`;
                const tv = poll.votes.reduce((sum, count) => sum + count, 0);
                poll.options.forEach((option, index) => {
                    const vc = poll.votes[index];
                    const per = tv > 0 ? Math.round((vc / tv) * 100) : 0;
                    rm += `${index + 1}. ${option}: ${vc} votes (${per}%)\n`;
                });
                if (tv === 0) {
                    rm += "\nNo votes were cast in this poll.";
                } else {
                    rm += `\nTotal votes: ${tv}`;
                }
                const User = mongoose.model('User');
                const users = await User.find({});
                for (const user of users) {
                    try {
                        await sendmessage(`Poll "${pollid}" has been closed.\n\n${rm}`, user.userid, phonenumber);
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (err) {
                        console.error(`Failed to send poll results to user ${user.userid}:`, err);
                    }
                }
                await poll.deleteOne();
                await sendresponse(`Poll with ID ${pollid} has been closed and deleted.\n\n${rm}`, envelope, `${prefix}closepoll`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to close poll. Please try again later.', envelope, `${prefix}closepoll`, true);
            }
        }
    },
    "killuser": {
        description: "Forcefully unregisters a user",
        arguments: ['userid'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}killuser\\s+(\\S+)$`, 'i'));
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-killuser [userid]" to unregister a user.', envelope, `${prefix}killuser`, true);
                    return;
                }
                const tui = match[1];
                const User = mongoose.model('User');
                const userobject = await User.findOne({ userid: tui });
                if (!userobject) {
                    await sendresponse(`User ${tui} not found.`, envelope, `${prefix}killuser`, true);
                    return;
                }
                await userobject.deleteOne();
                await sendresponse(`User ${tui} has been forcefully unregistered.`, envelope, `${prefix}killuser`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to unregister user. Please try again later.', envelope, `${prefix}killuser`, true);
            }
        }
    },
    "migration": {
        description: "Perform a database migration (set up the migration in this commands execute section first)",
        arguments: null,
        execute: async (envelope, message) => {
            sendresponse('A migration isn\'t set up yet, please set one up in this commands execute section.', envelope, `${prefix}migration`, true); return;
            try {
                const User = mongoose.model('User');
                const users = await User.find({});
                if (users.length === 0) {
                    await sendresponse('No users found in the database.', envelope, `${prefix}migration`, true);
                    return;
                }
                let uc = 0;
                for (const user of users) {
                    if (user.properties.eco) {
                        user.properties.tags = ['eco'];
                        user.markModified('properties');
                        await user.save();
                        uc++;
                    } else {
                        user.properties.tags = [];
                        user.markModified('properties');
                        await user.save();
                        uc++;
                    }
                }
                await sendresponse(`Migration completed. Updated ${uc} users.`, envelope, `${prefix}migration`, false);
            } catch (err) {
                console.error(err);
                await sendresponse('Failed to perform migration. Please try again later.', envelope, `${prefix}migration`, true);
            }
        }
    }
};

const builtincommands = {
    "ping": {
        description: "Respond with 'pong', used for testing uptime",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                await sendresponse('pong', envelope, `${prefix}ping`, false);
            } catch (err) {
                console.error(err);
            }
        }
        },
        "help": {
        description: "Display this help message",
        arguments: ['optional: section'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(new RegExp(`^${escapereg(prefix)}help(?:\\s+(\\S+))?$`, 'i'));
                const section = match && match[1] ? match[1].toLowerCase() : null;
                let helpmessage = "Hiya $MENTIONUSER!\n";
                const user = await mongoose.model('User').findOne({ userid: envelope.sourceUuid });
                if (!section) {
                    helpmessage += "Here are my available commands:\n";
                    helpmessage += "  Built-in commands:\n";
                    for (const cmd in builtincommands) {
                        if (Object.prototype.hasOwnProperty.call(builtincommands, cmd)) {
                            if (builtincommands[cmd].arguments) {
                                helpmessage += `    ${prefix}${cmd} [${builtincommands[cmd].arguments.join('] [')}] : ${builtincommands[cmd].description}\n`;
                            } else {
                                helpmessage += `    ${prefix}${cmd} : ${builtincommands[cmd].description}\n`;
                            }
                        }
                    }
                    const commands = user ? usercommands : guestcommands;
                    helpmessage += "  User commands:\n";
                    for (const cmd in commands) {
                        if (Object.prototype.hasOwnProperty.call(commands, cmd)) {
                            if (commands[cmd].arguments) {
                                helpmessage += `    ${prefix}${cmd} [${commands[cmd].arguments.join('] [')}] : ${commands[cmd].description}\n`;
                            } else {
                                helpmessage += `    ${prefix}${cmd} : ${commands[cmd].description}\n`;
                            }
                        }
                    }
                    const as = modules.filter(s => {
                        if (s.admin && (!user || user.accesslevel !== 1)) return false;
                        if (s.user && !user) return false;
                        return true;
                    });
                    if (as.length > 0) {
                        const sect = as.filter(s => {
                            if (!user.properties || !user.properties.tags) return false;
                            return user.properties.tags.includes(s.section);
                        });
                        if (user.accesslevel === 1) {
                            const adminmod = modules.find(m => m.section === "admin");
                            if (adminmod) {
                                sect.push(adminmod);
                            }
                        }
                        if (sect.length === 0) {
                            helpmessage += `You don't have any modules enabled. Add some with "${prefix}module"!`;
                        } else {
                            helpmessage += `\nYou have the following modules enabled (use "-help <module>" to see the available commands):\n`;
                            for (const s of sect) {
                                helpmessage += `  - ${s.section}\n`;
                            }
                        }
                    }
                } else {
                    const so = modules.find(s => s.section === section);
                    if (!so) {
                        const as = modules.filter(s => {
                            if (s.admin && (!user || user.accesslevel !== 1)) return false;
                            if (s.user && !user) return false;
                            return true;
                        });
                        helpmessage += `Unknown help module "${section}". Available modules: ${as.map(s => s.section).join(', ')}`;
                    } else if (so.admin && (!user || user.accesslevel !== 1)) {
                        const as = modules.filter(s => {
                            if (s.admin && (!user || user.accesslevel !== 1)) return false;
                            if (s.user && !user) return false;
                            return true;
                        });
                        helpmessage += `Unknown help module "${section}". Available modules: ${as.map(s => s.section).join(', ')}`;
                    } else if (so.user && !user) {
                        helpmessage += `You are not registered as a ${botname} user $MENTIONUSER.\nUse "-register" to register!`;
                    } else {
                        helpmessage += `${so.section.charAt(0).toUpperCase() + so.section.slice(1)} commands:\n`;
                        for (const cmd in so.commands) {
                            if (Object.prototype.hasOwnProperty.call(so.commands, cmd)) {
                                if (so.commands[cmd].arguments) {
                                    helpmessage += `    ${prefix}${cmd} [${so.commands[cmd].arguments.join('] [')}] : ${so.commands[cmd].description}\n`;
                                } else {
                                    helpmessage += `    ${prefix}${cmd} : ${so.commands[cmd].description}\n`;
                                }
                            }
                        }
                    }
                }
                helpmessage = helpmessage.trim();
                if (envelope.dataMessage) {
                    const dataMessage = envelope.dataMessage;
                    const groupInfo = dataMessage.groupInfo
                    if (groupInfo && groupInfo.groupId) {
                        await sendresponse(`Please check your DMs $MENTIONUSER for the help message.`, envelope, `${prefix}help`, true);
                        await sendmessage(helpmessage, envelope.sourceUuid, phonenumber);
                    } else {
                        await sendresponse(helpmessage, envelope, `${prefix}help`, false);
                    }
                } else {
                    await sendresponse(helpmessage, envelope, `${prefix}help`, false);
                }
            } catch (err) {
                console.error(err);
            }
        }
    },
    "info": {
        description: 'Display bot information',
        arguments: null,
        execute: async (envelope, message) => {
            try {
                await sendresponse(`${botname} v${process.env.npm_package_version} running on ${os.type()} ${os.release()} (${os.arch()})\nBased on LunarN0v4/tritiumbotv2 (https://github.com/LunarN0v4/tritiumbotv2).`, envelope, `${prefix}info`, false);
            } catch (err) {
                console.error(err);
            }
        }
    },
    "myid": {
        description: "Display your Signal ID",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                await sendresponse(`Your Signal ID is: ${envelope.sourceUuid}`, envelope, `${prefix}myid`, false);
            } catch (err) {
                console.error(err);
            }
        }
    },
    "resolveid": {
        description: "Resolve a Signal ID by mentioning a user",
        arguments: ['mention'],
        execute: async (envelope, message) => {
            try {
                const dataMessage = envelope.dataMessage;
                let mention = dataMessage?.mentions?.[0];
                if (!mention) {
                    try {
                        const syncMessage = envelope.syncMessage;
                        const sentMessage = syncMessage.sentMessage;
                        if (sentMessage && sentMessage.mentions && sentMessage.mentions.length > 0) {
                            mention = sentMessage.mentions[0];
                        }
                    } catch (err) {
                        sendresponse('Invalid arguments.\nUse "-resolveid <@mention>" to resolve a Signal ID.', envelope, `${prefix}resolveid`, true);
                        return;
                    }
                }
                if (!mention) {
                    await sendresponse('Invalid arguments.\nUse "-resolveid <@mention>" to resolve a Signal ID.', envelope, `${prefix}resolveid`, true);
                    return;
                }
                if (!mention.uuid) {
                    await sendresponse('Invalid mention. Please mention a user.', envelope, `${prefix}resolveid`, true);
                    return;
                }
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: mention.uuid });
                envelope.sourceUuid = mention.uuid;
                if (!user) {
                    await sendresponse(`User ID for $MENTIONUSER is ${mention.uuid} (${botname} doesn't know this user).`, envelope, `${prefix}resolveid`, false);
                    return;
                } else {
                    await sendresponse(`User ID for $MENTIONUSER is ${mention.uuid}.`, envelope, `${prefix}resolveid`, false);
                    return;
                }
            } catch (err) {
                console.error(err);
            }
        }
    }
};

const modules = [
    {
        section: "eco",
        commands: ecocommands,
        user: true,
        admin: false,
        execute: async (user) => {
            if (!user.properties.eco) {
                user.properties.eco = {};
            }
            if (!user.properties.eco.balance) {
                user.properties.eco.balance = 0;
            }
            user.markModified('properties');
            await user.save();
        }
    },
    {
        section: "admin",
        commands: adminonlycommands,
        user: true,
        admin: true,
        execute: async (user) => {
            return;
        }
    }
];

async function invokecommand(command, envelope) {
    const blacklist = parseJsonc(fs.readFileSync('config.jsonc', 'utf8')).blacklist;
    if (blacklist.includes(envelope.sourceUuid)) {
    await sendresponse(`Hi $MENTIONUSER.\nYou are blacklisted from using ${botname}.\nPlease contact @nova.06 for more information.`, envelope, `${prefix}${command}`, true);
        return;
    }
    const propercommand = command.startsWith(prefix) ? command.slice(prefix.length).split(' ')[0] : command.split(' ')[0];
    const User = mongoose.model('User');
    const user = await User.findOne({ userid: envelope.sourceUuid });
    const dataMessage = envelope.dataMessage;
    let message
    if (dataMessage && dataMessage.message) {
        message = dataMessage.message.trim();
    } else {
        const syncMessage = envelope.syncMessage;
        if (syncMessage && syncMessage.sentMessage && syncMessage.sentMessage.message) {
            message = syncMessage.sentMessage.message.trim();
        } else {
            message = '';
        }
    }
    message = message.trim();
    message = message.replace(ic, '');
    if (propercommand === '') {
        if (envelope.dataMessage && !envelope.dataMessage.groupInfo) {
            await sendresponse('No command specified.\nUse "-help" for the full command list!', envelope, command, true);
        }
    } else if (builtincommands[propercommand]) {
        await builtincommands[propercommand].execute(envelope, message);
    } else if (guestcommands[propercommand]) {
        if (!user) {
            await guestcommands[propercommand].execute(envelope, message);
        } else {
            await sendresponse(`You are already registered as a ${botname} user $MENTIONUSER.`, envelope, command, true);
        }
    } else if (usercommands[propercommand]) {
        if (!user) {
            await sendresponse(`You are not registered as a ${botname} user $MENTIONUSER.\nUse "-register" to register!`, envelope, command, true);
        } else {
            await usercommands[propercommand].execute(envelope, message);
        }
    } else if (ecocommands[propercommand]) {
        if (!user) {
            await sendresponse(`You are not registered as a ${botname} user $MENTIONUSER.\nUse "-register" to register!`, envelope, command, true);
        //} else if (!user.accesslevel || user.accesslevel < 0) {
        //    await sendresponse('These commands are currently in development, $MENTIONUSER.\nSorry for the inconvenience.', envelope, command, true);
        } else {
            await ecocommands[propercommand].execute(envelope, message);
        }
    } else if (adminonlycommands[propercommand]) {
        if (user && user.accesslevel === 1) {
            await adminonlycommands[propercommand].execute(envelope, message);
        } else {
            await sendresponse(`Unknown command: ${command}`, envelope, command, true);
        }
    } else {
        await sendresponse(`Unknown command: ${command}`, envelope, command, true);
    }
};

async function invokeselfcommand(command, envelope) {
    const dataMessage = envelope.dataMessage;
    let message
    if (dataMessage && dataMessage.message) {
        message = dataMessage.message.trim();
    } else {
        const syncMessage = envelope.syncMessage;
        if (syncMessage && syncMessage.sentMessage && syncMessage.sentMessage.message) {
            message = syncMessage.sentMessage.message.trim();
        } else {
            message = '';
        }
    }
    message = message.trim();
    message = message.replace(ic, '');
    const propercommand = command.startsWith(prefix) ? command.slice(prefix.length).split(' ')[0] : command.split(' ')[0];
    if (builtincommands[propercommand]) {
        await builtincommands[propercommand].execute(envelope, message);
    } else if (usercommands[propercommand]) {
        await usercommands[propercommand].execute(envelope, message);
    } else if (ecocommands[propercommand]) {
        await ecocommands[propercommand].execute(envelope, message);
    } else if (adminonlycommands[propercommand]) {
        const User = mongoose.model('User');
        const user = await User.findOne({ userid: envelope.sourceUuid });
        if (user && user.accesslevel === 1) {
            await adminonlycommands[propercommand].execute(envelope, message);
        } else {
            await sendresponse(`Unknown command: ${command}`, envelope, command, true);
        }
    } else {
        await sendresponse(`Unknown command: ${command}`, envelope, command, true);
    }
}

export {
    invokecommand,
    invokeselfcommand,
};