const fs = require('fs');
const net = require('net');
const { parse } = require('jsonc-parser');
const { Axiom } = require('@axiomhq/js');
delete require.cache[require.resolve('./mongoose.cjs')];
const mongoose = require('./mongoose.cjs').exportmodels();

let config = parse(fs.readFileSync('config.jsonc', 'utf8'));
const socketpath = config.socketpath;
const axiomtoken = config.axiomtoken;
const phonenumber = config.phonenumber;
let axiom; // skipcq: JS-0119
if (!axiomtoken || axiomtoken === '' || axiomtoken === null || axiomtoken === undefined) {
    axiom = undefined;
} else {
    axiom = new Axiom({
        token: axiomtoken,
    });
};
config = undefined;

function sendreadreceipt(recipient, timestamp) {
    const client = new net.Socket();
    client.connect(socketpath, () => {
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
        client.write(json);
        client.on('data', (data) => {
            const content = data.toString();
            if (content == null || content === '' || content === undefined || content === '\n') {
                return;
            } else {
                try {
                    const parsedJson = JSON.parse(content);
                    if (parsedJson.id !== null && parsedJson.id === id) {
                        if (parsedJson.error) {
                            console.error('Error sending read receipt:', parsedJson.error);
                            return;
                        }
                        const result = parsedJson.result;
                        const results = result.results;
                        if (results[0].type === 'SUCCESS') {
                            client.end();
                            return;
                        }
                    } else {
                        client.end();
                        return;
                    }
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                }
            };
        });
        setTimeout(() => {
            if (!client.destroyed) {
                client.end();
            }
        }, 5000);
    });
    client.on('error', (error) => {
        console.error('Error sending read receipt via Signal CLI:', error);
    });
};

function sendtypingindicator(recipient, stop) {
    const client = new net.Socket();
    client.connect(socketpath, () => {
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'sendTyping',
            params: {
                account: phonenumber,
                recipient: `${recipient}`,
                stop,
            },
        };
        json = JSON.stringify(json);
        client.write(json);
        client.on('data', (data) => {
            const content = data.toString();
            if (content == null || content === '' || content === undefined || content === '\n') {
                return;
            } else {
                try {
                    const parsedJson = JSON.parse(content);
                    if (parsedJson.id === id) {
                        if (parsedJson.error) {
                            console.error('Error sending typing indicator:', parsedJson.error);
                            return;
                        }
                        const result = parsedJson.result;
                        const results = result.results;
                        if (results[0].type === 'SUCCESS') {
                            client.end();
                            return;
                        }
                    } else {
                        client.end();
                        return;
                    }
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                }
            };
        });
        setTimeout(() => {
            if (!client.destroyed) {
                client.end();
            }
        }, 5000);
    });
    client.on('error', (error) => {
        console.error('Error sending typing indicator via Signal CLI:', error);
    });
};

function sendmessage(message, recipient, timestamp, image=null, mime=null, imageext=null, file=null) {
    sendtypingindicator(recipient, false);
    const client = new net.Socket();
    client.connect(socketpath, async () => {
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'send',
            params: {
                //quoteTimestamp: timestamp,
                account: phonenumber,
                recipient: `${recipient}`,
            },
        };
        if (message !== null) {
            json.params.message = message;
            if (message.includes('$MENTIONUSER')) {
                const startofmention = message.indexOf('$MENTIONUSER');
                json.params.mention = `${startofmention}:${"$MENTIONUSER".length}:${recipient}`
            }
        } else {
            json.params.message = '';
        }
        if (image !== null) {
            // This is because jpeg loves being a SPECIAL FUCKING SNOWFLAKE
            json.params.attachments = [`data:${mime};filename=image.${imageext};base64,${image}`];
        }
        if (file !== null) {
            json.params.attachments = [`${file}`];
        }
        json = JSON.stringify(json);
        await client.write(json);
        client.on('data', async (data) => {
            const content = data.toString();
            if (content == null || content === '' || content === undefined || content === '\n') {
                return;
            } else {
                try {
                    const parsedJson = JSON.parse(content);
                    if (parsedJson.id === id) {
                        if (parsedJson.error) {
                            console.error('Error sending message:', parsedJson.error);
                            if (parsedJson.error.data) {
                                console.error(parsedJson.error.data);
                            }
                            client.end();
                            return;
                        }
                        const result = parsedJson.result;
                        const results = result.results;
                        if (results[0].type === 'SUCCESS') {
                            client.end();
                            setTimeout(() => {
                                sendtypingindicator(recipient, true);
                            }, 100);
                            const User = mongoose.model('User');
                            User.findOne({ userid: recipient }).then(searchuser => {
                                const properties = searchuser.properties;
                                if (properties && properties.debug && properties.debug === true) {
                                    const msgtimestamp = result.timestamp; // skipcq: JS-0123
                                    addtimestamp(message, recipient, msgtimestamp, timestamp, image, mime, imageext);
                                }
                            }).catch(err => {
                                return;
                            });
                        }
                    } else {
                        client.end();
                        return;
                    }
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    client.end();
                }
            };
        });
        setTimeout(() => {
            if (!client.destroyed) {
                client.end();
            }
        }, 5000);
    });
    client.on('error', (error) => {
        console.error('Error sending message via Signal CLI:', error);
    });
};

function addtimestamp(message, recipient, timestamp, _quotetimestamp, image=null, mime=null, imageext=null, file=null) {
    const client = new net.Socket();
    client.connect(socketpath, () => {
        const tid = Math.floor(Math.random() * 1024) + 1;
        const id = tid.toString();
        let json = {
            jsonrpc: '2.0',
            id,
            method: 'send',
            params: {
                //quoteTimestamp: quotetimestamp,
                account: phonenumber,
                recipient: `${recipient}`,
                editTimestamp: timestamp,
            },
        };
        if (message !== null) {
            json.params.message = `${message}\n\nMessage timestamp: ${timestamp}`
            if (message.includes('$MENTIONUSER')) {
                const startofmention = message.indexOf('$MENTIONUSER');
                json.params.mention = `${startofmention}:${"$MENTIONUSER".length}:${recipient}`
            }
        } else {
            json.params.message = `Message timestamp: ${timestamp}`;
        }
        if (image !== null) {
            json.params.attachments = [`data:${mime};filename=file.${imageext};base64,${image}`];
        }
        if (file !== null) {
            json.params.attachments = [`./${file}`];
        }
        json = JSON.stringify(json);
        client.write(json);
        client.on('data', (data) => {
            const content = data.toString();
            if (content == null || content === '' || content === undefined || content === '\n') {
                return;
            } else {
                try {
                    const parsedJson = JSON.parse(content);
                    if (parsedJson.id === id) {
                        const result = parsedJson.result;
                        const results = result.results;
                        if (results[0].type === 'SUCCESS') {
                            client.end();
                            return;
                        } else {
                            console.error('Error sending message:', results[0].type);
                            client.end();
                            return;
                        }
                    } else {
                        return;
                    }
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    client.end();
                }
            };
        });
        setTimeout(() => {
            if (!client.destroyed) {
                client.end();
            }
        }, 5000);
    });
};

function interpretmessage(json) {
    if (json == null || json === '' || json === undefined || json === '\n') {
        return;
    } else {
        try {
            const parsedJson = JSON.parse(json);
            const params = parsedJson.params;
            const envelope = params.envelope;
            if (params.account === '' || params.account === null || params.account === undefined || params.account !== phonenumber) {
                return;
            }
            if (envelope.dataMessage) {
                const dataMessage = envelope.dataMessage;
                const message = dataMessage.message;
                if (message === '' || message === null || message === undefined) {
                    return;
                }
                /*if (envelope.sourceName === '' || envelope.sourceName === null || envelope.sourceName === undefined) {
                    console.log(`Received "${message}" from ${envelope.sourceUuid} at ${dataMessage.timestamp}`);
                } else {
                    console.log(`Received "${message}" from ${envelope.sourceUuid} (${envelope.sourceName}) at ${dataMessage.timestamp}`);
                }*/
                if (message.startsWith('-')) {
                    sendreadreceipt(envelope.sourceUuid, dataMessage.timestamp);
                    const invokecommand = require('./commands.cjs').invokecommand;
                    invokecommand(message, envelope, dataMessage);
                    delete require.cache[require.resolve('./commands.cjs')];
                }
            } else {
                return;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    };
};

function sendresponse(message, envelope, command, failed=false, image=null, mime=null, imageext=null, file=null) {
    const recipient = envelope.sourceUuid;
    const dataMessage = envelope.dataMessage;
    const timestamp = dataMessage.timestamp;
    sendmessage(message, recipient, timestamp, image, mime, imageext, file);
    if (axiom !== undefined) {
        axiom.ingest('botlogs', [{ timestamp, command, executor: recipient, failed }]);
    }
};

module.exports = {
    interpretmessage,
    sendresponse,
    sendtypingindicator,
};