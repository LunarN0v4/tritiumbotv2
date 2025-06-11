import fs from 'fs';
import net from 'net';
import { parse } from 'jsonc-parser';
import { Axiom } from '@axiomhq/js';

const mongoosemodule = await import('./mongoose.js');
const mongoose = mongoosemodule.exportmodels();

let config = parse(fs.readFileSync('config.jsonc', 'utf8'));
const socketpath = config.socketpath;
const axiomtoken = config.axiomtoken;
const phonenumber = config.phonenumber;
const prefix = config.prefix || '-';
const managedaccount = config.managedaccount;
let axiom;
if (!axiomtoken || axiomtoken === '' || axiomtoken === null || axiomtoken === undefined) {
    axiom = undefined;
} else {
    axiom = new Axiom({
        token: axiomtoken,
    });
};
config = undefined;

let client = null;
let ic = false;
let pendingcbs = [];

function startconn(client, callback) {
    if (socketpath.includes(':')) {
        const [host, port] = socketpath.split(':');
        client.connect(parseInt(port), host, callback);
    } else {
        client.connect(socketpath, callback);
    }
}

function persistentconn(callback) {
    if (client && !client.destroyed && client.readyState === 'open') {
        callback();
        return;
    }
    if (ic) {
        pendingcbs.push(callback);
        return;
    }
    ic = true;
    pendingcbs.push(callback);
    client = new net.Socket();
    client.setMaxListeners(50);
    client.on('error', (error) => {
        console.error('Handler connection had a major skill issue:', error);
        client.removeAllListeners();
        client = null;
        ic = false;
        pendingcbs = [];
    });
    client.on('close', () => {
        console.log('Handler connection closed');
        if (client) {
            client.removeAllListeners();
        }
        client = null;
        ic = false;
    });
    startconn(client, () => {
        ic = false;
        const callbacks = [...pendingcbs];
        pendingcbs = [];
        callbacks.forEach(cb => cb());
    });
}

function sendreadreceipt(recipient, timestamp) {
    if (!client || client.destroyed || client.readyState !== 'open') {
        console.error('No handler connection available for read receipt');
        return;
    }
    const tid = Math.floor(Math.random() * 1024) + 1;
    const id = tid.toString();
    let json = {
        jsonrpc: '2.0',
        id,
        method: 'sendReceipt',
        params: {
            account: phonenumber,
            recipient: `${recipient}`,
            targetTimestamp: timestamp,
        },
    };
    json = JSON.stringify(json);
    client.write(json + '\n');
};

function sendtypingindicator(recipient, stop, sender=undefined, props={}) {
    persistentconn(() => {
        if (!client || client.destroyed || client.readyState !== 'open') {
            console.error('No handler connection available for typing indicator');
            return;
        }
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'sendTyping',
            params: {
                account: sender !== undefined ? sender : phonenumber,
                stop,
            },
        };
        if (props.groupid) {
            json.params.groupId = `${props.groupid}`;
        } else {
            json.params.recipient = `${recipient}`;
        }
        json = JSON.stringify(json);
        client.write(json + '\n');
    });
};

function sendmessage(message, recipient, sender=undefined, props={}) {
    sendtypingindicator(props.isselfcommand ? props.selfcommandsendto : recipient, false, sender !== undefined ? sender : phonenumber, props);
    persistentconn(() => {
        if (!client || client.destroyed || client.readyState !== 'open') {
            console.error('No handler connection available for sending message');
            return;
        }
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'send',
            params: {
                account: sender && sender !== undefined ? sender : phonenumber,
            },
        };
        if (props.groupid) {
            json.params.groupId = `${props.groupid}`;
        } else {
            json.params.recipient = `${props.isselfcommand ? props.selfcommandsendto : recipient}`;
        }
        if (message) {
            json.params.message = message;
            if (message.includes('$MENTIONUSER')) {
                const startofmention = message.indexOf('$MENTIONUSER');
                json.params.mention = `${startofmention}:${"$MENTIONUSER".length}:${recipient}`
            }
        } else {
            json.params.message = '';
        }
        if (props.image) {
            // This is because jpeg loves being a SPECIAL FUCKING SNOWFLAKE
            json.params.attachments = [`data:${props.mime};filename=image.${props.imageext};base64,${props.image}`];
        }
        if (props.file) {
            json.params.attachments = [`${props.file}`];
        }
        json = JSON.stringify(json);
        client.write(json + '\n');
        const responsehandler = async (data) => {
            const content = data.toString();
            if (content == null || content === '' || content === undefined || content === '\n') {
                return;
            }
            try {
                const pj = JSON.parse(content);
                if (pj.id === id) {
                    client.removeListener('data', responsehandler);
                    if (pj.error) {
                        console.error('Error sending message:', pj.error);
                        if (pj.error.data) {
                            console.error(pj.error.data);
                        }
                        return;
                    }
                    const result = pj.result;
                    const results = result.results;
                    if (results[0].type === 'SUCCESS') {
                        setTimeout(() => {
                            sendtypingindicator(props.isselfcommand ? props.selfcommandsendto : recipient, true, sender !== null ? sender : phonenumber, props);
                        }, 100);
                    }
                }
            } catch (error) {
                return;
            }
        };
        client.on('data', responsehandler);
        const timeid = setTimeout(() => {
            client.removeListener('data', responsehandler);
        }, 10000);
        responsehandler.timeid = timeid;
    });
};

async function interpretmessage(json) {
    if (json == null || json === '' || json === undefined || json === '\n') {
        return;
    } else {
        try {
            let pj;
            try {
                pj = JSON.parse(json);
            } catch (error) {
                return;
            }
            const params = pj.params;
            const envelope = params.envelope;
            if (params.account === '' || params.account === null || params.account === undefined || params.account !== phonenumber && params.account !== managedaccount) {
                return;
            }
            if (envelope.dataMessage) {
                const dataMessage = envelope.dataMessage;
                if (params.account === managedaccount) {
                    return;
                }
                const message = dataMessage.message;
                if (message === '' || message === null || message === undefined) {
                    return;
                }
                if (message.startsWith(prefix)) {
                    persistentconn(async () => {
                        sendreadreceipt(envelope.sourceUuid, dataMessage.timestamp);
                        const cm = await import(`./commands.js?t=${Date.now()}`);
                        const { invokecommand } = cm;
                        invokecommand(message, envelope);
                    });
                }
            } else if (envelope.syncMessage && envelope.sourceNumber === managedaccount) {
                const syncMessage = envelope.syncMessage;
                const sentMessage = syncMessage.sentMessage;
                if (sentMessage && sentMessage.message) {
                    const message = sentMessage.message;
                    if (message === '' || message === null || message === undefined) {
                        return;
                    }
                    if (message.startsWith(prefix)) {
                        persistentconn(async () => {
                            if (sentMessage.groupInfo && sentMessage.groupInfo.groupId) {
                                const tid = Math.floor(Math.random() * 1024) + 1;
                                const id = tid.toString();
                                let json = {
                                    jsonrpc: '2.0',
                                    id,
                                    method: 'listGroups',
                                    params: {
                                        account: phonenumber,
                                    },
                                }
                                client.write(JSON.stringify(json) + '\n');
                                let buffer = '';
                                const responsehandler = async (data) => {
                                    buffer += data.toString();
                                    const lines = buffer.split('\n');
                                    buffer = lines.pop();
                                    for (const line of lines) {
                                        const content = line.trim();
                                        if (content == null || content === '' || content === undefined) {
                                            continue;
                                        }
                                        try {
                                            const pj = JSON.parse(content);
                                            if (pj.id === id) {
                                                client.removeListener('data', responsehandler);
                                                if (pj.error) {
                                                    console.error('Error listing groups:', pj.error);
                                                    return;
                                                }
                                                const result = pj.result;
                                                if (result && result.length > 0) {
                                                    const g = result.find(group => group.id === sentMessage.groupInfo.groupId);
                                                    if (g) {
                                                        return;
                                                    } else {
                                                        envelope.isselfcommand = true;
                                                        const cm = await import(`./commands.js?t=${Date.now()}`);
                                                        const { invokeselfcommand } = cm;
                                                        invokeselfcommand(message, envelope);
                                                    }
                                                }
                                                return;
                                            }
                                        } catch (error) {
                                            console.error('Error parsing JSON:', error);
                                        }
                                    }
                                };
                                client.on('data', responsehandler);
                                setTimeout(() => {
                                    client.removeListener('data', responsehandler);
                                }, 5000);
                            } else if (sentMessage.destinationNumber != phonenumber && sentMessage.destinationNumber !== managedaccount && sentMessage.destinationUuid !== '7dc7c561-7c9b-4ccd-b38d-f6b4ace559ee') {
                                envelope.isselfcommand = true;
                                const cm = await import(`./commands.js?t=${Date.now()}`);
                                const { invokeselfcommand } = cm;
                                invokeselfcommand(message, envelope);
                            }
                        });
                    }
                }
            } else {
                return;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    };
};

function getcontacts(account=phonenumber, recipient=undefined) {
    return new Promise((resolve, reject) => {
        persistentconn(() => {
            if (!client || client.destroyed || client.readyState !== 'open') {
                console.error('No handler connection available for getting contacts');
                reject(new Error('No handler connection available'));
                return;
            }
            const tid = Math.floor(Math.random() * 1024) + 1;
            const id = tid.toString();
            let json = {
                jsonrpc: '2.0',
                id,
                method: 'listContacts',
                params: {
                    all: true,
                    account: account,
                },
            };
            if (recipient) {
                json.params.recipient = `${recipient}`;
            }
            json = JSON.stringify(json);
            client.write(json + '\n');
            let buffer = '';
            const responsehandler = (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const content = line.trim();
                    if (content == null || content === '' || content === undefined) {
                        continue;
                    }
                    try {
                        const pj = JSON.parse(content);
                        if (pj.id === id) {
                            client.removeListener('data', responsehandler);
                            if (pj.error) {
                                console.error('Error getting contacts:', pj.error);
                                reject(new Error('Error getting contacts: ' + JSON.stringify(pj.error)));
                                return;
                            }
                            const result = pj.result;
                            resolve(result);
                            return;
                        }
                    } catch (error) {
                        console.error('Error parsing JSON:', error);
                    }
                }
            };

            client.on('data', responsehandler);
            const timeid = setTimeout(() => {
                client.removeListener('data', responsehandler);
                reject(new Error('Timeout waiting for contacts response'));
            }, 5000);
            const or = resolve;
            const ore = reject;
            resolve = (...args) => {
                clearTimeout(timeid);
                client.removeListener('data', responsehandler);
                or(...args);
            };
            reject = (...args) => {
                clearTimeout(timeid);
                client.removeListener('data', responsehandler);
                ore(...args);
            };
        });
    });
}

function sendresponse(message, envelope, command, failed=false, props={}) {
    const recipient = envelope.sourceUuid;
    const dataMessage = envelope.dataMessage;
    const syncMessage = envelope.syncMessage;
    const sentMessage = syncMessage ? syncMessage.sentMessage : null;
    if (dataMessage && dataMessage.groupInfo) {
        const groupInfo = dataMessage.groupInfo;
        props.groupid = groupInfo.groupId;
    } else if (syncMessage && sentMessage.groupInfo) {
        const groupInfo = sentMessage.groupInfo;
        props.groupid = groupInfo.groupId;
    }
    let sender;
    if (envelope.isselfcommand) {
        sender = managedaccount;
        props.selfcommandsendto = sentMessage.destinationUuid;
        props.isselfcommand = true;
    } else {
        sender = phonenumber;
    }
    sendmessage(message, recipient, sender, props);
    if (axiom !== undefined && command !== undefined) {
        axiom.ingest('botlogs', [{ timestamp: Date.now(), command, executor: recipient, failed }]);
    }
};

export {
    interpretmessage,
    sendmessage,
    sendresponse,
    sendtypingindicator,
    getcontacts,
};