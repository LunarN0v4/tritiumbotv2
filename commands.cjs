const fs = require('fs');
const jsonc = require('jsonc-parser');
delete require.cache[require.resolve('./signalhandler.cjs')];
const sendresponse = require('./signalhandler.cjs').sendresponse;
const uname = require('node-uname').uname();
delete require.cache[require.resolve('./mongoose.cjs')];
const mongoose = require('./mongoose.cjs').exportmodels();
//const axios = require('axios');
delete require.cache[require.resolve('./signalhandler.cjs')];
const sendtypingindicator = require('./signalhandler.cjs').sendtypingindicator;

let config = jsonc.parse(fs.readFileSync('config.jsonc', 'utf8'));
const prefix = config.prefix;
config = undefined;

const guestcommands = {
    "register": {
        description: "Register your Signal account with TritiumBot",
        arguments: null,
        execute: async (envelope) => {
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
                        properties: {},
                    });
                    await user.save();
                    await sendresponse('You are now registered as a TritiumBot user $MENTIONUSER!', envelope, `${prefix}register`);
                }
            } catch (err) {
                sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}register`, true);
            }
        }
    }
};

const usercommands = {
    "unregister": {
        description: "Delete all your data from TritiumBot",
        arguments: null,
        execute: async (envelope) => {
            try {
                const User = mongoose.model('User');
                await User.deleteOne({ userid: envelope.sourceUuid });
                await sendresponse('You are no longer registered as a TritiumBot user $MENTIONUSER.', envelope, `${prefix}unregister`);
            } catch (err) {
                sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}unregister`, true);
            }
        }
    },
    "debug": {
        description: "Enable or disable debug tools",
        arguments: ['true / false'],
        execute: async (envelope) => {
            const User = mongoose.model('User');
            try {
                await User.findOne({ userid: envelope.sourceUuid }).then((user) => {
                    const dataMessage = envelope.dataMessage;
                    const message = dataMessage.message.trim();
                    if (!user.properties) {
                        user.properties = {};
                    }
                    if (user.properties.debug === undefined) {
                        user.properties.debug = false;
                        user.markModified('properties');
                        user.save();
                        sendresponse('Debug tools are currently disabled for you $MENTIONUSER.', envelope, `${prefix}debug`);
                        return;
                    }
                    if (message === `${prefix}debug`) {
                        sendresponse(`Debug tools are currently ${user.properties.debug ? 'enabled' : 'disabled'} for you $MENTIONUSER.`, envelope, `${prefix}debug`);
                        return;
                    }
                    if (message === `${prefix}debug true`) {
                        user.properties.debug = true;
                        user.markModified('properties');
                        user.save();
                        setTimeout(() => {
                            sendresponse('Debug tools are now enabled for you $MENTIONUSER.', envelope, `${prefix}debug true`);
                        }, 100);
                        return;
                    }
                    if (message === `${prefix}debug false`) {
                        user.properties.debug = false;
                        user.markModified('properties');
                        user.save();
                        setTimeout(() => {
                            sendresponse('Debug tools are now disabled for you $MENTIONUSER.', envelope, `${prefix}debug false`);
                        }, 100);
                        return;
                    }
                    sendresponse('Invalid argument.\nUse "-debug true" or "-debug false" to enable or disable debug tools.', envelope, `${prefix}debug`, true);
                });
            } catch (err) {
                sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}debug`, true);
            }
        }
    }
};

const builtincommands = {
    "ping": {
        description: "Respond with 'pong', used for testing uptime",
        arguments: null,
        execute: async (envelope) => {
            try {
                await sendresponse('pong', envelope, `${prefix}ping`);
            } catch (err) {
                sendresponse('Somehow this command failed. Please try again later.', envelope, `${prefix}ping`, true);
            }
        }
    },
    "help": {
        description: "Display this help message",
        arguments: null,
        execute: async (envelope) => {
            try {
                let helpmessage = "Hiya $MENTIONUSER!\nHere are my available commands:\n";
                for (const cmd in builtincommands) {
                    if (Object.prototype.hasOwnProperty.call(builtincommands, cmd)) {
                        if (builtincommands[cmd].arguments) {
                            helpmessage += `${prefix}${cmd} [${builtincommands[cmd].arguments.join('] [')}] : ${builtincommands[cmd].description}\n`;
                        } else {
                            helpmessage += `${prefix}${cmd} : ${builtincommands[cmd].description}\n`;
                        }
                    }
                }
                const user = await mongoose.model('User').findOne({ userid: envelope.sourceUuid });
                const commands = user ? usercommands : guestcommands;
                for (const cmd in commands) {
                    if (Object.prototype.hasOwnProperty.call(commands, cmd)) {
                        if (commands[cmd].arguments) {
                            helpmessage += `${prefix}${cmd} [${commands[cmd].arguments.join('] [')}] : ${commands[cmd].description}\n`;
                        } else {
                            helpmessage += `${prefix}${cmd} : ${commands[cmd].description}\n`;
                        }
                    }
                }
                helpmessage = helpmessage.trim();
                await sendresponse(helpmessage, envelope, `${prefix}help`);
            } catch (err) {
                sendresponse('Unable to connect to database, is MongoDB running?', envelope, `${prefix}help`, true);
            }
        }
    },
    "info": {
        description: 'Display bot information',
        arguments: null,
        execute: async (envelope) => {
            try {
                await sendresponse(`Hiya $MENTIONUSER!\nI'm TritiumBot, a simple high performance Signal bot by Nova (github.com/LunarN0v4)!\nHere's my package and system info:\nTritiumBot v${process.env.npm_package_version} running on ${uname.sysname} ${uname.release} (${uname.machine})`, envelope, `${prefix}info`);
            } catch (err) {
                sendresponse('Failed to get uname, are all the project dependencies installed?', envelope, `${prefix}info`, true);
            }
        }
    }
};

async function invokecommand(command, envelope) {
    sendtypingindicator(envelope.sourceUuid);
    const blacklist = jsonc.parse(fs.readFileSync('config.jsonc', 'utf8')).blacklist;
    if (blacklist.includes(envelope.sourceUuid)) {
        await sendresponse('Hi $MENTIONUSER.\nYou are blacklisted from using TritiumBot.\nPlease contact @nova.66 for more information.', envelope, `${prefix}${command}`, true);
        return;
    }
    const propercommand = command.startsWith(prefix) ? command.slice(prefix.length).split(' ')[0] : command.split(' ')[0];
    const User = mongoose.model('User');
    const user = await User.findOne({ userid: envelope.sourceUuid });
    if (propercommand === '') {
        await sendresponse('No command specified.\nUse "-help" for the full command list!', envelope, command, true);
    } else if (builtincommands[propercommand]) {
        await builtincommands[propercommand].execute(envelope);
    } else if (guestcommands[propercommand]) {
        if (!user) {
            await guestcommands[propercommand].execute(envelope);
        } else {
            await sendresponse('You are already registered as a TritiumBot user $MENTIONUSER.', envelope, command, true);
        }
    } else if (usercommands[propercommand]) {
        if (!user) {
            await sendresponse('You are not registered as a TritiumBot user $MENTIONUSER.\nUse "-register" to register!', envelope, command, true);
        } else {
            await usercommands[propercommand].execute(envelope);
        }
    } else {
        await sendresponse(`Unknown command: ${command}`, envelope, command, true);
    }
};

module.exports = {
    invokecommand,
};