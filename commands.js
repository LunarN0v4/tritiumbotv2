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
const prefix = config.prefix;
const phonenumber = config.phonenumber;
const managedaccount = config.managedaccount;
config = undefined;

const guestcommands = {
    "register": {
        description: "Register your Signal account with TritiumBot",
        arguments: null,
        execute: async (envelope, message) => {
            const User = mongoose.model('User');
            try {
                const searchuser = await User.findOne({ userid: envelope.sourceUuid });
                if (searchuser) {
                    await sendresponse('You are already registered as a TritiumBot user $MENTIONUSER.', envelope, `${prefix}register`, true);
                    return;
                } else {
                    const user = new User({
                        userid: envelope.sourceUuid,
                        accesslevel: 0,
                        properties: {tags: []},
                    });
                    await user.save();
                    await sendresponse('You are now registered as a TritiumBot user $MENTIONUSER!', envelope, `${prefix}register`);
                    const contact = await getcontacts(phonenumber, envelope.sourceUuid);
                    if (!contact) {
                        await sendmessage(`Hiya user!\nIt seems you have registered for a TritiumBot account without sending me a DM first.\nThat's okay if so!\nPlease accept this message request so I can get to know you better.`, envelope.sourceUuid, phonenumber);
                        return;
                    }
                    const profile = contact.profile;
                    if (profile && profile.givenName != null && profile.givenName !== '') {
                        return;
                    } else {
                        await sendmessage(`Hiya user!\nIt seems you have registered for a TritiumBot account without sending me a DM first.\nThat's okay if so!\nPlease accept this message request so I can get to know you better.`, envelope.sourceUuid, phonenumber);
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
        description: "Delete all your data from TritiumBot",
        arguments: null,
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                await User.deleteOne({ userid: envelope.sourceUuid });
                await sendresponse('You are no longer registered as a TritiumBot user $MENTIONUSER.', envelope, `${prefix}unregister`);
            } catch (err) {
                await sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}unregister`, true);
            }
        }
    },
    "subscribe": {
        description: "Subscribe to TritiumBot broadcasts",
        arguments: ['true / false'],
        execute: async (envelope, message) => {
            try {
                const User = mongoose.model('User');
                const user = await User.findOne({ userid: envelope.sourceUuid });
                if (!user.properties) {
                    user.properties = {};
                }
                if (message === `${prefix}subscribe true`) {
                    user.properties.subscribed = true;
                    user.markModified('properties');
                    await user.save();
                    await sendresponse('You are now subscribed to TritiumBot broadcasts $MENTIONUSER!', envelope, `${prefix}subscribe true`, false);
                    return;
                }
                if (message === `${prefix}subscribe false`) {
                    user.properties.subscribed = false;
                    user.markModified('properties');
                    await user.save();
                    await sendresponse('You are now unsubscribed from TritiumBot broadcasts $MENTIONUSER!', envelope, `${prefix}subscribe false`, false);
                    return;
                }
                sendresponse('Invalid argument.\nUse "-subscribe true" or "-subscribe false" to subscribe or unsubscribe from TritiumBot broadcasts.', envelope, `${prefix}subscribe`, true);
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
                    if (Object.prototype.hasOwnProperty.call(properties, prop)) {
                        pm += `${prop}: ${fv(properties[prop])}\n`;
                    }
                }
                pm = pm.trim();
                await sendresponse(pm, envelope, `${prefix}getprops`, false);
            } catch (err) {
                await sendresponse('Failed to retrieve your properties. Please try again later.', envelope, `${prefix}getprops`, true);
            }
        }
    },
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
                const args = message.split(' ');
                if (args.length < 3) {
                    await sendresponse('Invalid arguments. Use "-give [user] [amount]" to give money to another user.', envelope, `${prefix}give`, true);
                    return;
                }
                const tui = args[1];
                const amount = parseInt(args[2]);
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
                const args = message.split(' ');
                if (args.length < 4) {
                    await sendresponse('Invalid arguments.\nUse "-proxymsg [signalid] [bot] [message]" to proxy a message to another user.', envelope, `${prefix}proxymsg`, true);
                    return;
                }
                const tui = args[1];
                const bot = args[2];
                const proxmsg = message.slice(message.indexOf(args[2]) + args[2].length).trim();
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
        arguments: ['userid', 'silent', 'tags'],
        execute: async (envelope, message) => {
            try {
                const match = message.match(/^[-/]?changetags\s+(\S+)\s+(true|false)\s+"([^"]+)"(?:\s+"([^"]+)")?/i);
                if (!match) {
                    await sendresponse('Invalid arguments.\nUse "-changetags [userid] [true/false] "[tags]" "[admin message (optional)]"" to set tags for a user.', envelope, `${prefix}changetags`, true);
                    return;
                }
                const tui = match[1];
                const silent = match[2];
                const nt = match[3].split(/\s+/).filter(Boolean);
                const adminmsg = match[4];
                const vt = ['L0', 'L1', 'L2', 'L3'];
                if (!nt.every(tag => vt.includes(tag))) {
                    await sendresponse('Invalid tag(s) specified. Valid tags are: L0, L1, L2, L3.', envelope, `${prefix}changetags`, true);
                    return;
                }
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
                const pt = Array.isArray(userobject.properties.tags) ? userobject.properties.tags : [];
                userobject.properties.tags = nt;
                userobject.markModified('properties');
                await userobject.save();
                if (silent === 'false') {
                    const tls = {
                        L0: "Layer 0 - Besties or higher",
                        L1: "Layer 1 - Trustable/Friend",
                        L2: "Layer 2 - Acquaintance",
                        L3: "Layer 3 - Default"
                    };
                    const tl = vt.map(tag => {
                        if (pt.includes(tag) && nt.includes(tag)) {
                            return `\\ ${tls[tag]}`;
                        } else if (!pt.includes(tag) && nt.includes(tag)) {
                            return `+ ${tls[tag]}`;
                        } else if (pt.includes(tag) && !nt.includes(tag)) {
                            return `- ${tls[tag]}`;
                        } else {
                            return `/ ${tls[tag]}`;
                        }
                    }).join('\n');
                    let an = '\n';
                    if (adminmsg) {
                        an = `\nAdmin note: "${adminmsg}"\n`;
                    }
                    const tum =
`Hiya $MENTIONUSER (Signal ID: ${tui}),

Your trust status has been updated and your new tags are:
${tl}

Legend:
/ - Unchanged (you don't have this tag)
\\ - Unchanged (you do have this tag)
+ - Added (you now have this tag)
- - Removed (you don't have this tag anymore)

These will apply to various Signal features, including stories, and if the owner of this bot has it set up, access to more TritiumBot features.${an}
Have a question about your trust status or want to manage your accounts with Arctic Systems all in one place?
Contact me at tritium.02 (you may need to ask nova.06 for access, otherwise I'll ignore your DMs)!
(I am a bot and this message was sent automagically, if you have any questions, please contact nova.06)
`;
                    await sendmessage(tum, tui, phonenumber);
                } else if (silent !== 'true') {
                    await sendresponse('Invalid value for silent. Use "true" or "false".', envelope, `${prefix}changetags`, true);
                    return;
                }
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
                    return {
                        userid: user.userid,
                        accesslevel: user.accesslevel,
                        tags: user.properties ? user.properties.tags : [], 
                        name: name ? name : 'Unknown'
                    };
                });
                let ul = 'Users:\n';
                ulm.forEach(user => {
                    ul += `- ${user.userid} (${user.name}) (Access Level: ${user.accesslevel}) (Tags: ${user.tags.join(', ')})\n`;
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
                const args = message.split(' ');
                if (args.length < 3) {
                    await sendresponse('Invalid arguments.\nUse "-broadcast [onlysubscribed] [message]" to send a message to all users.', envelope, `${prefix}broadcast`, true);
                    return;
                }
                const onlysubscribed = args[1];
                const bm = message.slice(message.indexOf(args[1]) + args[1].length).trim();
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
                const match = message.match(/^[-/]?delprop\s+(\S+)\s+(\S+)/i);
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
                const match = message.match(/^[-/]?nukeprop\s+(\S+)/i);
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
                const match = message.match(/^[-/]?peerprops\s+(\S+)/i);
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
        arguments: null,
        execute: async (envelope, message) => {
            try {
                let helpmessage = "Hiya $MENTIONUSER!\nHere are my available commands:\n";
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
                const user = await mongoose.model('User').findOne({ userid: envelope.sourceUuid });
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
                if (user) {
                    helpmessage += "  Eco commands:\n";
                    for (const cmd in ecocommands) {
                        if (Object.prototype.hasOwnProperty.call(ecocommands, cmd)) {
                            if (ecocommands[cmd].arguments) {
                                helpmessage += `    ${prefix}${cmd} [${ecocommands[cmd].arguments.join('] [')}] : ${ecocommands[cmd].description}\n`;
                            } else {
                                helpmessage += `    ${prefix}${cmd} : ${ecocommands[cmd].description}\n`;
                            }
                        }
                    }
                }
                if (user && user.accesslevel === 1) {
                    helpmessage += "  Nova-only commands:\n";
                    for (const cmd in adminonlycommands) {
                        if (Object.prototype.hasOwnProperty.call(adminonlycommands, cmd)) {
                            if (adminonlycommands[cmd].arguments) {
                                helpmessage += `    ${prefix}${cmd} [${adminonlycommands[cmd].arguments.join('] [')}] : ${adminonlycommands[cmd].description}\n`;
                            } else {
                                helpmessage += `    ${prefix}${cmd} : ${adminonlycommands[cmd].description}\n`;
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
                await sendresponse(`TritiumBot v${process.env.npm_package_version} running on ${os.type()} ${os.release()} (${os.arch()})\nBased on LunarN0v4/tritiumbotv2 (https://github.com/LunarN0v4/tritiumbotv2).`, envelope, `${prefix}info`, false);
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
                    await sendresponse(`User ID for $MENTIONUSER is ${mention.uuid} (TritiumBot doesn't know this user).`, envelope, `${prefix}resolveid`, false);
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

async function invokecommand(command, envelope) {
    const blacklist = parseJsonc(fs.readFileSync('config.jsonc', 'utf8')).blacklist;
    if (blacklist.includes(envelope.sourceUuid)) {
    await sendresponse('Hi $MENTIONUSER.\nYou are blacklisted from using TritiumBot.\nPlease contact @nova.66 for more information.', envelope, `${prefix}${command}`, true);
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
    if (propercommand === '') {
        await sendresponse('No command specified.\nUse "-help" for the full command list!', envelope, command, true);
    } else if (builtincommands[propercommand]) {
        await builtincommands[propercommand].execute(envelope, message);
    } else if (guestcommands[propercommand]) {
        if (!user) {
            await guestcommands[propercommand].execute(envelope, message);
        } else {
            await sendresponse('You are already registered as a TritiumBot user $MENTIONUSER.', envelope, command, true);
        }
    } else if (usercommands[propercommand]) {
        if (!user) {
            await sendresponse('You are not registered as a TritiumBot user $MENTIONUSER.\nUse "-register" to register!', envelope, command, true);
        } else {
            await usercommands[propercommand].execute(envelope, message);
        }
    } else if (ecocommands[propercommand]) {
        if (!user) {
            await sendresponse('You are not registered as a TritiumBot user $MENTIONUSER.\nUse "-register" to register!', envelope, command, true);
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
    const propercommand = command.startsWith(prefix) ? command.slice(prefix.length).split(' ')[0] : command.split(' ')[0];
    if (builtincommands[propercommand]) {
        await builtincommands[propercommand].execute(envelope, message);
    } else if (usercommands[propercommand]) {
        await usercommands[propercommand].execute(envelope, message);
    } else if (ecocommands[propercommand]) {
        const User = mongoose.model('User');
        const user = await User.findOne({ userid: envelope.sourceUuid });
        if (user && user.accesslevel >= 0) {
            await ecocommands[propercommand].execute(envelope, message);
        } else {
            await sendresponse('These commands are currently in development, $MENTIONUSER.\nSorry for the inconvenience.', envelope, command, true);
        }
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